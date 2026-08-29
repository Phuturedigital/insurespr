#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASELINE = path.join(PROJECT_ROOT, 'RELEASE-MONITOR-BASELINE.json');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'production-monitor-report.json');
const ALLOWED_STATUSES = new Set(['pass', 'warn', 'fail']);
const ALLOWED_KINDS = new Set(['technical', 'readiness']);

function fail(message) {
  const error = new Error(message);
  error.isOperatorError = true;
  throw error;
}

function parseArguments(argv) {
  const options = {
    baseline: DEFAULT_BASELINE,
    output: DEFAULT_OUTPUT,
    audit: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!['--baseline', '--output', '--audit'].includes(token)) {
      fail(`Unknown option: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${token}`);
    options[token.slice(2)] = path.resolve(value);
    index += 1;
  }
  return options;
}

function stringArray(payload, key, problems) {
  const value = payload?.[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    problems.push(`${key} must be an array of non-empty strings`);
    return [];
  }
  if (new Set(value).size !== value.length) problems.push(`${key} contains duplicates`);
  return value;
}

export function validateBaseline(payload) {
  const problems = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Release monitor baseline must be a JSON object');
  }
  if (payload.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (payload.site !== 'https://www.insuresprhealth.co.za') {
    problems.push('site must be the exact canonical production origin');
  }
  const requiredChecks = stringArray(payload, 'requiredChecks', problems);
  const requiredPasses = stringArray(payload, 'requiredPasses', problems);
  const allowedFailures = stringArray(payload, 'allowedReadinessFailures', problems);
  const allowedWarnings = stringArray(payload, 'allowedReadinessWarnings', problems);
  const requiredSet = new Set(requiredChecks);
  for (const id of [...requiredPasses, ...allowedFailures, ...allowedWarnings]) {
    if (!requiredSet.has(id)) problems.push(`${id} is classified but not required`);
  }
  for (const id of requiredPasses) {
    if (allowedFailures.includes(id) || allowedWarnings.includes(id)) {
      problems.push(`${id} cannot be both required-pass and allowed-open`);
    }
  }
  for (const id of allowedFailures) {
    if (allowedWarnings.includes(id)) problems.push(`${id} has two allowed-open classifications`);
  }
  const expectedPolicy = {
    allowKnownBlockerImprovement: true,
    failOnNewReadinessIssue: true,
    failOnTechnicalWarningOrFailure: true,
    failWhenRequiredCheckDisappears: true,
  };
  for (const [key, value] of Object.entries(expectedPolicy)) {
    if (payload.policy?.[key] !== value) problems.push(`policy.${key} must be ${value}`);
  }
  if (problems.length) fail(`Release monitor baseline contract failed: ${problems.join('; ')}`);
  return {
    ...payload,
    requiredChecks,
    requiredPasses,
    allowedReadinessFailures: allowedFailures,
    allowedReadinessWarnings: allowedWarnings,
  };
}

function validateAudit(audit, regressions) {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    regressions.push('release audit output is not an object');
    return [];
  }
  if (audit.readOnly !== true) regressions.push('release audit did not identify itself as read-only');
  if (audit.mode !== 'release') regressions.push('release audit did not run in release mode');
  if (audit.base !== 'https://www.insuresprhealth.co.za') {
    regressions.push('release audit did not target the canonical production origin');
  }
  if (Number.isNaN(Date.parse(audit.generatedAt ?? ''))) regressions.push('release audit timestamp is invalid');
  if (!Array.isArray(audit.results)) {
    regressions.push('release audit results are missing');
    return [];
  }
  const ids = new Set();
  for (const result of audit.results) {
    if (!result || typeof result !== 'object' || typeof result.id !== 'string' || !result.id) {
      regressions.push('release audit contains a result without an id');
      continue;
    }
    if (ids.has(result.id)) regressions.push(`release audit contains duplicate check ${result.id}`);
    ids.add(result.id);
    if (!ALLOWED_STATUSES.has(result.status)) regressions.push(`${result.id} has invalid status`);
    if (!ALLOWED_KINDS.has(result.kind)) regressions.push(`${result.id} has invalid kind`);
  }
  const computed = { pass: 0, warn: 0, fail: 0 };
  for (const result of audit.results) {
    if (ALLOWED_STATUSES.has(result?.status)) computed[result.status] += 1;
  }
  for (const status of ['pass', 'warn', 'fail']) {
    if (audit.summary?.[status] !== computed[status]) {
      regressions.push(`release audit ${status} summary does not match its results`);
    }
  }
  return audit.results;
}

export function evaluateAudit(auditInput, baselineInput) {
  const baseline = validateBaseline(baselineInput);
  const regressions = [];
  const results = validateAudit(auditInput, regressions);
  const byId = new Map(results.filter((result) => typeof result?.id === 'string')
    .map((result) => [result.id, result]));

  for (const id of baseline.requiredChecks) {
    if (!byId.has(id)) regressions.push(`required release check disappeared: ${id}`);
  }
  for (const id of baseline.requiredPasses) {
    const result = byId.get(id);
    if (result && result.status !== 'pass') regressions.push(`required pass regressed: ${id} is ${result.status}`);
  }

  for (const result of results) {
    if (result.status === 'pass') continue;
    if (result.kind === 'technical') {
      regressions.push(`technical ${result.status}: ${result.id}`);
      continue;
    }
    if (result.status === 'fail' && !baseline.allowedReadinessFailures.includes(result.id)) {
      regressions.push(`new or worsened readiness failure: ${result.id}`);
    }
    if (
      result.status === 'warn'
      && !baseline.allowedReadinessWarnings.includes(result.id)
      && !baseline.allowedReadinessFailures.includes(result.id)
    ) {
      regressions.push(`new readiness warning: ${result.id}`);
    }
  }

  const open = results.filter((result) => result.status !== 'pass').map((result) => ({
    id: result.id,
    status: result.status,
    kind: result.kind,
    message: result.message,
  }));
  return {
    schemaVersion: 1,
    monitorStatus: regressions.length ? 'regression' : 'pass',
    evaluatedAt: new Date().toISOString(),
    auditGeneratedAt: auditInput?.generatedAt ?? null,
    site: baseline.site,
    summary: auditInput?.summary ?? null,
    regressions: [...new Set(regressions)],
    open,
    audit: auditInput,
  };
}

async function loadJson(filename, label) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch {
    fail(`${label} is missing or invalid JSON: ${filename}`);
  }
}

async function runLiveAudit() {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(PROJECT_ROOT, 'tools', 'release-audit.mjs'),
    '--report-only',
    '--json',
  ], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    fail('Live release audit did not return valid JSON');
  }
}

function markdownSummary(report) {
  const status = report.monitorStatus === 'pass' ? 'PASS' : 'REGRESSION';
  const lines = [
    '# InsureSPR production monitor',
    '',
    `**Status:** ${status}`,
    '',
    `Audit: ${report.summary?.pass ?? 0} pass, ${report.summary?.warn ?? 0} warning, ${report.summary?.fail ?? 0} fail.`,
    '',
  ];
  if (report.regressions.length) {
    lines.push('## Regressions', '', ...report.regressions.map((item) => `- ${item}`), '');
  } else {
    lines.push('No new regression was detected. Known readiness blockers remain visible in the attached report.', '');
  }
  lines.push('## Open readiness items', '', ...report.open.map((item) => `- ${item.id}: ${item.status}`), '');
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const options = parseArguments(argv);
  const baseline = await loadJson(options.baseline, 'Release monitor baseline');
  const audit = options.audit ? await loadJson(options.audit, 'Release audit input') : await runLiveAudit();
  const report = evaluateAudit(audit, baseline);
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  const summary = markdownSummary(report);
  if (environment.GITHUB_STEP_SUMMARY) {
    await appendFile(environment.GITHUB_STEP_SUMMARY, summary, { encoding: 'utf8' });
  }
  process.stdout.write(`Production monitor ${report.monitorStatus.toUpperCase()}: ${report.summary?.pass ?? 0} pass, ${report.summary?.warn ?? 0} warning, ${report.summary?.fail ?? 0} fail; ${report.regressions.length} regression(s).\n`);
  if (report.regressions.length) process.exitCode = 1;
  return report;
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`Production monitor failed: ${error.isOperatorError ? error.message : 'unexpected internal error'}\n`);
    process.exitCode = 1;
  });
}
