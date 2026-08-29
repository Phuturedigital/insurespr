import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateAudit, validateBaseline } from './release-monitor.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = validateBaseline(JSON.parse(await readFile(
  path.join(projectRoot, 'RELEASE-MONITOR-BASELINE.json'),
  'utf8',
)));

function result(id, status, kind = 'readiness') {
  return { id, title: id, status, kind, message: `${id} ${status}` };
}

function currentAudit(overrides = new Map()) {
  const results = baseline.requiredChecks.map((id) => {
    if (overrides.has(id)) return overrides.get(id);
    if (baseline.requiredPasses.includes(id)) return result(id, 'pass', 'technical');
    if (baseline.allowedReadinessWarnings.includes(id)) return result(id, 'warn');
    return result(id, 'fail');
  });
  return {
    generatedAt: '2026-08-29T03:00:00.000Z',
    readOnly: true,
    mode: 'release',
    base: baseline.site,
    summary: {
      pass: results.filter((item) => item.status === 'pass').length,
      warn: results.filter((item) => item.status === 'warn').length,
      fail: results.filter((item) => item.status === 'fail').length,
    },
    results,
  };
}

test('current known blockers pass the production regression monitor', () => {
  const report = evaluateAudit(currentAudit(), baseline);
  assert.equal(report.monitorStatus, 'pass');
  assert.deepEqual(report.regressions, []);
  assert.equal(report.open.length, 11);
  assert(baseline.requiredPasses.includes('email-dmarc'));
  assert(!baseline.allowedReadinessFailures.includes('email-dmarc'));
});

test('known readiness improvements are accepted without weakening the baseline', () => {
  const audit = currentAudit(new Map([
    ['privacy-version', result('privacy-version', 'pass')],
    ['email-sender-mx', result('email-sender-mx', 'pass')],
  ]));
  const report = evaluateAudit(audit, baseline);
  assert.equal(report.monitorStatus, 'pass');
  assert.equal(report.open.some((item) => item.id === 'privacy-version'), false);
  assert.equal(report.open.some((item) => item.id === 'email-sender-mx'), false);
});

test('technical regressions and required-pass regressions fail', () => {
  const audit = currentAudit(new Map([
    ['robots', result('robots', 'fail', 'technical')],
    ['email-dmarc', result('email-dmarc', 'fail')],
  ]));
  const report = evaluateAudit(audit, baseline);
  assert.equal(report.monitorStatus, 'regression');
  assert.match(report.regressions.join('\n'), /required pass regressed: robots/);
  assert.match(report.regressions.join('\n'), /required pass regressed: email-dmarc/);
  assert.match(report.regressions.join('\n'), /technical fail: robots/);
});

test('new and worsened readiness issues fail', () => {
  const audit = currentAudit(new Map([
    ['email-sender-mx', result('email-sender-mx', 'fail')],
  ]));
  audit.results.push(result('new-provider-check', 'warn'));
  audit.summary.warn += 1;
  const report = evaluateAudit(audit, baseline);
  assert.equal(report.monitorStatus, 'regression');
  assert.match(report.regressions.join('\n'), /new or worsened readiness failure: email-sender-mx/);
  assert.match(report.regressions.join('\n'), /new readiness warning: new-provider-check/);
});

test('missing checks, duplicate ids, and inconsistent summaries fail closed', () => {
  const audit = currentAudit();
  audit.results = audit.results.filter((item) => item.id !== 'sitemap');
  audit.results.push({ ...audit.results[0] });
  audit.summary.pass = 999;
  const report = evaluateAudit(audit, baseline);
  assert.equal(report.monitorStatus, 'regression');
  assert.match(report.regressions.join('\n'), /required release check disappeared: sitemap/);
  assert.match(report.regressions.join('\n'), /duplicate check robots/);
  assert.match(report.regressions.join('\n'), /pass summary does not match/);
});

test('baseline cannot silently reclassify or omit a monitored check', () => {
  const invalid = structuredClone(baseline);
  invalid.requiredChecks = invalid.requiredChecks.filter((id) => id !== 'privacy-version');
  assert.throws(() => validateBaseline(invalid), /privacy-version is classified but not required/);
});

test('scheduled workflow is read-only, retains evidence, and requires no secret', async () => {
  const [workflow, ignored, publicIgnored] = await Promise.all([
    readFile(path.join(projectRoot, '.github', 'workflows', 'production-monitor.yml'), 'utf8'),
    readFile(path.join(projectRoot, '.gitignore'), 'utf8'),
    readFile(path.join(projectRoot, '.vercelignore'), 'utf8'),
  ]);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /release-monitor\.mjs --output artifacts\/production-monitor-report\.json/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /retention-days: 30/);
  assert.doesNotMatch(workflow, /secrets\.|permissions:\s*[\s\S]*write|supabase db|notification/i);
  assert.match(ignored, /^production-monitor-report\.json$/m);
  assert.match(ignored, /^artifacts\/$/m);
  assert.match(publicIgnored, /^RELEASE-MONITOR-BASELINE\.json$/m);
});
