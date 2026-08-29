#!/usr/bin/env node

/**
 * Read-only production preflight for InsureSPR.
 *
 * Network behaviour is deliberately limited to public GET requests, public DNS
 * lookups and six invalid empty-object form probes. The invalid probes contain
 * no PII and cannot satisfy the API's validation contract, so they cannot create
 * records.
 */

import assert from 'node:assert/strict';
import { Resolver } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE = 'https://www.insuresprhealth.co.za';
const DEFAULT_API = 'https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-api';
const DEFAULT_NOTIFICATIONS = 'https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-notifications';
const DEFAULT_EMAIL_REPLY_TO = 'motselisi@bonevc.co.za';
const DNS_RESOLVERS = [
  { name: 'Cloudflare', server: '1.1.1.1' },
  { name: 'Google', server: '8.8.8.8' },
];
const DEFAULT_REQUIRED_SERVICES = [
  'dxa-bone-density',
  'dxa-body-composition',
  'osteoporosis-care',
  'primary-healthcare-x-ray',
  'musculoskeletal-x-ray',
  'chest-x-ray',
  'orthopaedic-follow-up-x-ray',
  'visa-chest-x-ray',
  'workplace-medicals',
  'workplace-chest-x-ray',
  'runner-athlete-bone-health',
  'menopause-bone-health',
  'treatment-related-bone-health',
  'post-fracture-bone-health',
  'body-composition-progress',
  'long-term-condition-bone-health',
];
const FORM_ENDPOINTS = ['bookings', 'employer-leads', 'contact-enquiries'];
const USER_AGENT = 'InsureSPR-Release-Audit/1.0';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

function help() {
  return `InsureSPR read-only production preflight

Usage:
  node tools/release-audit.mjs [options]

Options:
  --base <url>                  Public site origin (default: ${DEFAULT_BASE})
  --api <url>                   Public API base (default: ${DEFAULT_API})
  --notifications <url>         Notification worker URL
  --notification-url <url>      Alias for --notifications
  --email-reply-to <address>    Approved receiving mailbox (default: ${DEFAULT_EMAIL_REPLY_TO})
  --dkim-host <hostname>        Exact sender DKIM hostname (default: resend._domainkey.<site domain>)
  --return-path-host <hostname> Exact provider Return-Path host (default: send.<site domain>)
  --mode <release|preview>      Release is strict; preview downgrades readiness blockers
  --required-services <csv>     Required public service slugs
  --legacy-manifest <path>      Optional JSON redirect manifest to validate
  --recovery-manifest <path>    Optional JSON backup/recovery evidence manifest
  --timeout-ms <milliseconds>   Per-request timeout (default: 15000)
  --json                        Emit machine-readable JSON
  --report-only                 Always exit zero after producing the report
  --self-test                   Run deterministic offline fixture tests
  --help                        Show this help

The audit performs no stateful writes. Form checks send only an invalid empty
JSON object with no personal information to the direct API and same-origin
verification bridge. Notification readiness is checked by
unauthenticated GET only; the worker is never invoked with scheduler secrets.`;
}

function parseArgs(argv) {
  const config = {
    base: DEFAULT_BASE,
    api: DEFAULT_API,
    notifications: DEFAULT_NOTIFICATIONS,
    emailReplyTo: DEFAULT_EMAIL_REPLY_TO,
    dkimHost: null,
    returnPathHost: null,
    mode: 'release',
    requiredServices: [...DEFAULT_REQUIRED_SERVICES],
    legacyManifest: null,
    recoveryManifest: null,
    timeoutMs: 15_000,
    json: false,
    reportOnly: false,
    selfTest: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    switch (arg) {
      case '--base':
        config.base = takeValue();
        break;
      case '--api':
        config.api = takeValue();
        break;
      case '--notifications':
      case '--notification-url':
        config.notifications = takeValue();
        break;
      case '--email-reply-to':
        config.emailReplyTo = takeValue();
        break;
      case '--dkim-host':
        config.dkimHost = takeValue();
        break;
      case '--return-path-host':
        config.returnPathHost = takeValue();
        break;
      case '--mode':
        config.mode = takeValue();
        break;
      case '--required-services':
        config.requiredServices = takeValue().split(',').map((value) => value.trim()).filter(Boolean);
        break;
      case '--legacy-manifest':
        config.legacyManifest = takeValue();
        break;
      case '--recovery-manifest':
        config.recoveryManifest = takeValue();
        break;
      case '--timeout-ms':
        config.timeoutMs = Number.parseInt(takeValue(), 10);
        break;
      case '--json':
        config.json = true;
        break;
      case '--report-only':
        config.reportOnly = true;
        break;
      case '--self-test':
        config.selfTest = true;
        break;
      case '--help':
      case '-h':
        config.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['release', 'preview'].includes(config.mode)) {
    throw new Error('--mode must be release or preview');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 120_000) {
    throw new Error('--timeout-ms must be an integer from 1000 through 120000');
  }
  if (config.requiredServices.length === 0) {
    throw new Error('--required-services must contain at least one slug');
  }

  config.base = normalizeOrigin(config.base, '--base');
  config.api = normalizeEndpoint(config.api, '--api');
  config.notifications = normalizeEndpoint(config.notifications, '--notifications');
  config.emailReplyTo = normalizeEmail(config.emailReplyTo, '--email-reply-to');
  const mailDomain = new URL(config.base).hostname.replace(/^www\./i, '');
  config.dkimHost = normalizeHostname(
    config.dkimHost || `resend._domainkey.${mailDomain}`,
    '--dkim-host',
  );
  config.returnPathHost = normalizeHostname(
    config.returnPathHost || `send.${mailDomain}`,
    '--return-path-host',
  );
  return config;
}

function normalizeOrigin(value, flag) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${flag} must be an HTTP(S) origin without credentials`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${flag} must contain only an origin (no path, query or fragment)`);
  }
  return url.origin;
}

function normalizeEndpoint(value, flag) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`${flag} must be an HTTP(S) URL without credentials or a fragment`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

function normalizeEmail(value, flag) {
  const email = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${flag} must be a valid email address`);
  }
  return email;
}

function normalizeHostname(value, flag) {
  const hostname = String(value).trim().toLowerCase().replace(/\.$/, '');
  if (
    hostname.length > 253 ||
    !hostname.includes('.') ||
    hostname.split('.').some((label) =>
      !label || label.length > 63 || !/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/.test(label))
  ) {
    throw new Error(`${flag} must be a valid DNS hostname`);
  }
  return hostname;
}

function result(id, title, status, message, evidence = null, kind = 'technical') {
  return { id, title, status, kind, message, ...(evidence == null ? {} : { evidence }) };
}

function pass(id, title, message, evidence = null) {
  return result(id, title, 'pass', message, evidence);
}

function issue(config, id, title, kind, message, evidence = null) {
  const status = kind === 'readiness' && config.mode === 'preview' ? 'warn' : 'fail';
  return result(id, title, status, message, evidence, kind);
}

function warning(id, title, message, evidence = null, kind = 'readiness') {
  return result(id, title, 'warn', message, evidence, kind);
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchPublic(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      ...options,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        ...(options?.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = options?.method === 'HEAD' ? '' : await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(tag)) !== null) {
    const name = match[1].toLowerCase();
    if (name === 'link' || name === 'meta' || name === 'script') continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => ({
    raw: match[0],
    attributes: parseAttributes(match[0]),
  }));
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function parseSitemap(xml) {
  return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter(Boolean);
}

function inspectRobots(text, base) {
  const expectedSitemap = `${base}/sitemap.xml`;
  const sitemapLines = [...text.matchAll(/^\s*Sitemap\s*:\s*(\S+)\s*$/gim)].map((match) => match[1]);
  const blocksEverything = /^\s*Disallow\s*:\s*\/\s*$/im.test(text);
  return {
    ok: sitemapLines.includes(expectedSitemap) && !blocksEverything,
    expectedSitemap,
    sitemapLines,
    blocksEverything,
  };
}

function extractJsonLd(html) {
  const blocks = [];
  const errors = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = parseAttributes(`<script ${match[1]}>`);
    if ((attributes.type ?? '').toLowerCase() !== 'application/ld+json') continue;
    try {
      blocks.push(JSON.parse(match[2].trim()));
    } catch (error) {
      errors.push(safeMessage(error));
    }
  }
  return { blocks, errors };
}

function collectUrls(value, output = []) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) collectUrls(nested, output);
  }
  return output;
}

function comparableUrl(value, relativeTo) {
  const url = new URL(value, relativeTo);
  url.hash = '';
  return url.href;
}

function inspectHtml(html, expectedUrl, base) {
  const expected = comparableUrl(expectedUrl, base);
  const canonicalTag = tags(html, 'link').find(({ attributes }) =>
    (attributes.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'));
  const ogTag = tags(html, 'meta').find(({ attributes }) =>
    (attributes.property ?? '').toLowerCase() === 'og:url');
  const robotsTag = tags(html, 'meta').find(({ attributes }) =>
    (attributes.name ?? '').toLowerCase() === 'robots');
  const jsonLd = extractJsonLd(html);
  const rootHost = new URL(base).hostname.replace(/^www\./i, '');
  const internalWrongOrigins = [];

  for (const raw of collectUrls(jsonLd.blocks)) {
    try {
      const url = new URL(raw);
      if ((url.hostname === rootHost || url.hostname.endsWith(`.${rootHost}`)) && url.origin !== base) {
        internalWrongOrigins.push(raw);
      }
    } catch {
      // Invalid JSON-LD URLs are handled by their consumers; only origin consistency is in scope here.
    }
  }

  let canonical = null;
  let ogUrl = null;
  try {
    if (canonicalTag?.attributes.href) canonical = comparableUrl(canonicalTag.attributes.href, expected);
  } catch {
    canonical = canonicalTag?.attributes.href ?? null;
  }
  try {
    if (ogTag?.attributes.content) ogUrl = comparableUrl(ogTag.attributes.content, expected);
  } catch {
    ogUrl = ogTag?.attributes.content ?? null;
  }

  const robots = robotsTag?.attributes.content?.toLowerCase() ?? '';
  const problems = [];
  if (canonical !== expected) problems.push(`canonical is ${canonical ?? 'missing'}; expected ${expected}`);
  if (ogUrl !== expected) problems.push(`og:url is ${ogUrl ?? 'missing'}; expected ${expected}`);
  if (jsonLd.blocks.length === 0) problems.push('JSON-LD is missing');
  if (jsonLd.errors.length > 0) problems.push(`JSON-LD parse error: ${jsonLd.errors.join('; ')}`);
  if (internalWrongOrigins.length > 0) problems.push(`JSON-LD uses another InsureSPR origin: ${[...new Set(internalWrongOrigins)].join(', ')}`);
  if (/(^|[,\s])noindex([,\s]|$)/i.test(robots)) problems.push('page is marked noindex');

  return { ok: problems.length === 0, problems, canonical, ogUrl, jsonLdCount: jsonLd.blocks.length };
}

function inspectSecurityHeaders(headers) {
  const hsts = headers.get('strict-transport-security') ?? '';
  const csp = headers.get('content-security-policy') ?? '';
  const nosniff = headers.get('x-content-type-options') ?? '';
  const frame = headers.get('x-frame-options') ?? '';
  const referrer = headers.get('referrer-policy') ?? '';
  const permissions = headers.get('permissions-policy') ?? '';
  const problems = [];

  if (!/max-age\s*=\s*\d+/i.test(hsts)) problems.push('Strict-Transport-Security with max-age is missing');
  if (!/\bdefault-src\b/i.test(csp)) problems.push('CSP default-src is missing');
  if (!/\bobject-src\s+'none'/i.test(csp)) problems.push("CSP object-src 'none' is missing");
  if (!/\bframe-ancestors\b/i.test(csp)) problems.push('CSP frame-ancestors is missing');
  if (nosniff.toLowerCase() !== 'nosniff') problems.push('X-Content-Type-Options is not nosniff');
  if (!referrer) problems.push('Referrer-Policy is missing');
  if (!permissions) problems.push('Permissions-Policy is missing');
  if (!/^(deny|sameorigin)$/i.test(frame) && !/\bframe-ancestors\b/i.test(csp)) {
    problems.push('clickjacking protection is missing');
  }
  return { ok: problems.length === 0, problems };
}

function validateServices(payload, requiredSlugs) {
  const problems = [];
  const practice = payload?.practice;
  const services = Array.isArray(payload?.services) ? payload.services : [];
  const privacyVersion = typeof practice?.privacy_notice_version === 'string'
    ? practice.privacy_notice_version.trim()
    : '';
  const turnstileKey = typeof payload?.turnstile_site_key === 'string'
    ? payload.turnstile_site_key.trim()
    : '';

  if (!privacyVersion || /pending|draft|placeholder|tbc|todo/i.test(privacyVersion)) {
    problems.push({ code: 'privacy', message: `privacy notice version is ${privacyVersion || 'missing'}` });
  }
  if (!turnstileKey) {
    problems.push({ code: 'turnstile', message: 'Turnstile site key is missing' });
  }

  const bySlug = new Map(services.map((service) => [service?.slug, service]));
  for (const slug of requiredSlugs) {
    const service = bySlug.get(slug);
    if (!service) {
      problems.push({ code: 'service-missing', slug, message: `${slug} is missing` });
      continue;
    }
    if (service.verification_status !== 'verified') {
      problems.push({
        code: 'service-unverified',
        slug,
        message: `${slug} verification_status is ${service.verification_status ?? 'missing'}`,
      });
    }
  }

  const appointmentServices = services.filter((service) =>
    requiredSlugs.includes(service?.slug) && service?.booking_mode === 'appointment');
  return {
    ok: problems.length === 0,
    problems,
    services,
    appointmentServices,
    privacyVersion,
    turnstileKey,
  };
}

function parseApiError(text) {
  try {
    const payload = JSON.parse(text);
    const code = payload?.error?.code ?? payload?.code ?? null;
    const message = payload?.error?.message ?? payload?.message ?? null;
    return { code, message, payload };
  } catch {
    return { code: null, message: text.trim().slice(0, 240) || null, payload: null };
  }
}

function inspectSameOriginBridge(directPayload, bridgePayload, headers) {
  const problems = [];
  const expectedKeys = ['categories', 'practice', 'services', 'turnstile_site_key'];
  const actualKeys = bridgePayload && typeof bridgePayload === 'object' && !Array.isArray(bridgePayload)
    ? Object.keys(bridgePayload).sort()
    : [];
  if (!isDeepStrictEqual(actualKeys, expectedKeys)) {
    problems.push(`response keys are ${actualKeys.join(', ') || 'missing'}`);
  }
  for (const key of ['practice', 'categories', 'services']) {
    if (!isDeepStrictEqual(bridgePayload?.[key], directPayload?.[key])) {
      problems.push(`${key} differs from the authoritative Supabase response`);
    }
  }
  const siteKey = bridgePayload?.turnstile_site_key;
  if (siteKey !== null && (typeof siteKey !== 'string' || !siteKey.trim())) {
    problems.push('turnstile_site_key must be null or a non-empty string');
  }
  if (/TURNSTILE_SECRET_KEY|INSURESPR_PROXY_PRIVATE_KEY_B64|secret-key/i.test(JSON.stringify(bridgePayload))) {
    problems.push('response contains a server-secret marker');
  }
  const cacheControl = headers.get('cache-control') ?? '';
  if (!/\bno-store\b/i.test(cacheControl)) {
    problems.push(`Cache-Control must include no-store; received ${cacheControl || 'missing'}`);
  }
  const vercelId = headers.get('x-vercel-id') ?? '';
  if (!/::fra1::/i.test(vercelId)) {
    problems.push(`x-vercel-id does not prove the configured fra1 execution region: ${vercelId || 'missing'}`);
  }
  const security = inspectSecurityHeaders(headers);
  for (const problem of security.problems) problems.push(`security header: ${problem}`);
  return { ok: problems.length === 0, problems, vercelId };
}

function inventoryExpectedCount(markdown) {
  const match = markdown.match(/contains\s+\*\*(\d+)\s+unique sitemap-listed URLs\*\*/i)
    ?? markdown.match(/\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function validateLegacyManifest(payload, expectedCount = null) {
  const redirects = Array.isArray(payload) ? payload : (payload?.redirects ?? payload?.entries);
  const problems = [];
  if (!Array.isArray(redirects)) {
    return { ok: false, redirects: [], problems: ['manifest must be an array or contain a redirects array'] };
  }
  const sources = new Set();
  const terminalStatuses = new Set(['redirect', 'preserve', 'gone', '410']);
  const pendingStatuses = new Set(['hold', 'needs_review', 'pending', 'unresolved']);
  const holdApproval = !Array.isArray(payload) && payload?.holdApproval;
  const approvedGlobalHold = !Array.isArray(payload) &&
    payload?.status === 'approved-hold-no-routing' &&
    payload?.activationAuthorized === false &&
    holdApproval?.status === 'approved' &&
    typeof holdApproval?.approvedBy === 'string' &&
    holdApproval.approvedBy.trim().length >= 2 &&
    typeof holdApproval?.approvedAt === 'string' &&
    !Number.isNaN(Date.parse(holdApproval.approvedAt));

  if (!Array.isArray(payload) && payload?.status === 'approved-hold-no-routing' && !approvedGlobalHold) {
    problems.push('approved hold requires inactive routing, a named approver and a valid approval timestamp');
  }

  for (const [index, entry] of redirects.entries()) {
    const source = entry?.source ?? entry?.from ?? entry?.url;
    const destination = entry?.destination ?? entry?.to ?? null;
    const status = String(entry?.status ?? entry?.state ?? (destination ? 'redirect' : '')).toLowerCase();
    if (!source) {
      problems.push(`entry ${index + 1} has no source`);
      continue;
    }
    if (sources.has(source)) problems.push(`duplicate source: ${source}`);
    sources.add(source);
    if (!terminalStatuses.has(status) && !(status === 'hold' && approvedGlobalHold)) {
      const detail = pendingStatuses.has(status) ? 'is unresolved' : `has unsupported status ${status || 'missing'}`;
      problems.push(`${source} ${detail}`);
    }
    if (status === 'redirect' && !destination) problems.push(`${source} is a redirect without a destination`);
    if (destination) {
      try {
        new URL(destination);
      } catch {
        problems.push(`${source} has an invalid absolute destination: ${destination}`);
      }
    }
  }
  if (expectedCount != null && redirects.length !== expectedCount) {
    problems.push(`manifest has ${redirects.length} entries; inventory has ${expectedCount}`);
  }
  return { ok: problems.length === 0, redirects, problems };
}

function validateRecoveryManifest(payload) {
  const contractProblems = [];
  const readinessProblems = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      contractProblems: ['recovery manifest must be a JSON object'],
      readinessProblems,
    };
  }

  const secretLikeKeys = [];
  const inspectKeys = (value, trail = []) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      const nextTrail = [...trail, key];
      if (/(?:password|secret|api.?key|database.?url|connection.?string)/i.test(key)) {
        secretLikeKeys.push(nextTrail.join('.'));
      }
      inspectKeys(nested, nextTrail);
    }
  };
  inspectKeys(payload);
  if (secretLikeKeys.length > 0) {
    contractProblems.push(`manifest contains forbidden secret-like field names: ${secretLikeKeys.join(', ')}`);
  }

  if (payload.schemaVersion !== 1) contractProblems.push('schemaVersion must be 1');
  if (payload.provider !== 'supabase') contractProblems.push('provider must be supabase');
  if (!/^[a-z]{20}$/.test(payload.projectRef ?? '')) contractProblems.push('projectRef must be a Supabase project reference');
  if (typeof payload.projectStatus !== 'string' || !payload.projectStatus) contractProblems.push('projectStatus is required');
  if (!/^[a-z]{2}-[a-z]+-[0-9]+$/.test(payload.region ?? '')) contractProblems.push('region must be a Supabase region');
  if (typeof payload.databaseVersion !== 'string' || !payload.databaseVersion) contractProblems.push('databaseVersion is required');
  if (typeof payload.organizationPlan !== 'string' || !payload.organizationPlan) contractProblems.push('organizationPlan is required');
  if (Number.isNaN(Date.parse(payload.observedAt ?? ''))) contractProblems.push('observedAt must be an ISO timestamp');
  if (!['blocked', 'ready'].includes(payload.status)) contractProblems.push('status must be blocked or ready');
  if (typeof payload.activationAuthorized !== 'boolean') contractProblems.push('activationAuthorized must be boolean');
  if (!payload.managedDailyBackups || typeof payload.managedDailyBackups !== 'object') {
    contractProblems.push('managedDailyBackups object is required');
  }
  if (!payload.pointInTimeRecovery || typeof payload.pointInTimeRecovery !== 'object') {
    contractProblems.push('pointInTimeRecovery object is required');
  }
  if (!payload.offsiteLogicalBackup || typeof payload.offsiteLogicalBackup !== 'object') {
    contractProblems.push('offsiteLogicalBackup object is required');
  }
  if (!payload.recoveryApproval || typeof payload.recoveryApproval !== 'object') {
    contractProblems.push('recoveryApproval object is required');
  }
  if (payload.evidence?.backupDocumentation !== 'https://supabase.com/docs/guides/platform/backups') {
    contractProblems.push('official Supabase backup documentation reference is required');
  }

  if (contractProblems.length > 0) return { ok: false, contractProblems, readinessProblems };

  const managedReady = payload.managedDailyBackups.included === true &&
    payload.managedDailyBackups.verifiedRestorePoints === true;
  const offsiteReady = payload.offsiteLogicalBackup.implemented === true &&
    payload.offsiteLogicalBackup.encrypted === true &&
    typeof payload.offsiteLogicalBackup.custodian === 'string' &&
    payload.offsiteLogicalBackup.custodian.trim().length >= 2 &&
    !Number.isNaN(Date.parse(payload.offsiteLogicalBackup.verifiedAt ?? ''));
  const recovery = payload.recoveryApproval;

  if (payload.status !== 'ready') readinessProblems.push('recovery status is blocked');
  if (payload.activationAuthorized !== true) readinessProblems.push('recovery activation is not authorized');
  if (!managedReady && !offsiteReady) {
    readinessProblems.push('neither verified managed restore points nor an encrypted verified off-site logical backup is available');
  }
  if (payload.organizationPlan.toLowerCase() === 'free' && !offsiteReady) {
    readinessProblems.push('the verified Free plan has no approved off-site backup substitute');
  }
  if (!Number.isInteger(recovery.rpoMinutes) || recovery.rpoMinutes <= 0) readinessProblems.push('RPO is not approved');
  if (!Number.isInteger(recovery.rtoMinutes) || recovery.rtoMinutes <= 0) readinessProblems.push('RTO is not approved');
  if (typeof recovery.owner !== 'string' || recovery.owner.trim().length < 2) readinessProblems.push('recovery owner is not assigned');
  if (Number.isNaN(Date.parse(recovery.lastSuccessfulRestoreDrillAt ?? ''))) readinessProblems.push('no successful restore drill is recorded');
  if (Number.isNaN(Date.parse(recovery.approvedAt ?? '')) || typeof recovery.approvedBy !== 'string' || recovery.approvedBy.trim().length < 2) {
    readinessProblems.push('recovery approval is incomplete');
  }

  return { ok: readinessProblems.length === 0, contractProblems, readinessProblems };
}

async function auditPublicSite(config, results) {
  let robots;
  try {
    robots = await fetchPublic(`${config.base}/robots.txt`, {}, config.timeoutMs);
    if (robots.response.status !== 200) {
      results.push(issue(config, 'robots-status', 'Robots', 'technical',
        `robots.txt returned HTTP ${robots.response.status}`));
    } else {
      const inspection = inspectRobots(robots.text, config.base);
      if (inspection.ok) {
        results.push(pass('robots', 'Robots', 'robots.txt publishes the expected www sitemap and does not block all crawling'));
      } else {
        results.push(issue(config, 'robots', 'Robots', 'technical',
          'robots.txt is inconsistent with the configured public origin', inspection));
      }
    }
  } catch (error) {
    results.push(issue(config, 'robots-network', 'Robots', 'technical', safeMessage(error)));
  }

  let sitemapUrls = [];
  try {
    const sitemap = await fetchPublic(`${config.base}/sitemap.xml`, {}, config.timeoutMs);
    if (sitemap.response.status !== 200) {
      results.push(issue(config, 'sitemap-status', 'Sitemap', 'technical',
        `sitemap.xml returned HTTP ${sitemap.response.status}`));
    } else {
      sitemapUrls = parseSitemap(sitemap.text);
      const duplicates = sitemapUrls.filter((url, index) => sitemapUrls.indexOf(url) !== index);
      const foreign = sitemapUrls.filter((url) => {
        try {
          return new URL(url).origin !== config.base;
        } catch {
          return true;
        }
      });
      if (sitemapUrls.length === 0 || duplicates.length > 0 || foreign.length > 0) {
        results.push(issue(config, 'sitemap-content', 'Sitemap', 'technical',
          'sitemap.xml is empty, duplicated, invalid, or contains another origin', {
            count: sitemapUrls.length,
            duplicates: [...new Set(duplicates)],
            foreign,
          }));
      } else {
        results.push(pass('sitemap', 'Sitemap',
          `${sitemapUrls.length} unique sitemap URLs consistently use ${config.base}`));
      }
    }
  } catch (error) {
    results.push(issue(config, 'sitemap-network', 'Sitemap', 'technical', safeMessage(error)));
  }

  const pageProblems = [];
  for (const url of sitemapUrls) {
    try {
      const fetched = await fetchPublic(url, { headers: { Accept: 'text/html' } }, config.timeoutMs);
      if (fetched.response.status !== 200) {
        pageProblems.push(`${url}: HTTP ${fetched.response.status}`);
        continue;
      }
      const location = fetched.response.headers.get('location');
      if (location) pageProblems.push(`${url}: unexpected redirect to ${location}`);
      const contentType = fetched.response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('text/html')) {
        pageProblems.push(`${url}: content-type is ${contentType || 'missing'}`);
      }
      const htmlInspection = inspectHtml(fetched.text, url, config.base);
      for (const problem of htmlInspection.problems) pageProblems.push(`${url}: ${problem}`);
      const headerInspection = inspectSecurityHeaders(fetched.response.headers);
      for (const problem of headerInspection.problems) pageProblems.push(`${url}: ${problem}`);
    } catch (error) {
      pageProblems.push(`${url}: ${safeMessage(error)}`);
    }
  }
  if (sitemapUrls.length > 0 && pageProblems.length === 0) {
    results.push(pass('public-pages', 'Public page metadata and headers',
      `All ${sitemapUrls.length} sitemap pages returned canonical HTML with matching OG/JSON-LD and security headers`));
  } else if (pageProblems.length > 0) {
    results.push(issue(config, 'public-pages', 'Public page metadata and headers', 'technical',
      `${pageProblems.length} public page problem(s) found`, pageProblems));
  }

  if (new URL(config.base).protocol === 'https:') {
    const insecure = new URL(config.base);
    insecure.protocol = 'http:';
    try {
      const fetched = await fetchPublic(insecure.href, {}, config.timeoutMs);
      const location = fetched.response.headers.get('location');
      const destination = location ? new URL(location, insecure).origin : null;
      if ([301, 308].includes(fetched.response.status) && destination === config.base) {
        results.push(pass('http-redirect', 'HTTP to HTTPS redirect',
          `${insecure.origin} permanently redirects to ${config.base}`));
      } else {
        results.push(issue(config, 'http-redirect', 'HTTP to HTTPS redirect', 'technical',
          `Expected a permanent redirect to ${config.base}`, {
            status: fetched.response.status,
            location,
          }));
      }
    } catch (error) {
      results.push(issue(config, 'http-redirect-network', 'HTTP to HTTPS redirect', 'technical', safeMessage(error)));
    }
  }

  const baseUrl = new URL(config.base);
  if (baseUrl.hostname.startsWith('www.')) {
    const apex = new URL(config.base);
    apex.hostname = apex.hostname.replace(/^www\./, '');
    try {
      const fetched = await fetchPublic(apex.href, {}, config.timeoutMs);
      const location = fetched.response.headers.get('location');
      const destination = location ? new URL(location, apex).origin : null;
      if ([301, 308].includes(fetched.response.status) && destination === config.base) {
        results.push(pass('apex-redirect', 'Apex canonical redirect',
          `${apex.origin} permanently redirects to ${config.base}`));
      } else {
        results.push(issue(config, 'apex-redirect', 'Apex canonical redirect', 'readiness',
          `The apex origin must permanently redirect to ${config.base} before cutover`, {
            apex: apex.origin,
            status: fetched.response.status,
            location,
          }));
      }
    } catch (error) {
      results.push(issue(config, 'apex-redirect-network', 'Apex canonical redirect', 'readiness', safeMessage(error)));
    }
  }
}

async function auditServices(config, results) {
  let payload;
  try {
    const fetched = await fetchPublic(`${config.api}/services`, {
      headers: {
        Accept: 'application/json',
        Origin: config.base,
      },
    }, config.timeoutMs);
    const cors = fetched.response.headers.get('access-control-allow-origin');
    const cacheControl = fetched.response.headers.get('cache-control') ?? '';
    if (fetched.response.status !== 200) {
      results.push(issue(config, 'services-status', 'Public services API', 'technical',
        `/services returned HTTP ${fetched.response.status}`, parseApiError(fetched.text)));
      return;
    }
    try {
      payload = JSON.parse(fetched.text);
    } catch (error) {
      results.push(issue(config, 'services-json', 'Public services API', 'technical',
        `Invalid JSON: ${safeMessage(error)}`));
      return;
    }
    if (cors !== config.base) {
      results.push(issue(config, 'services-cors', 'Public services API CORS', 'technical',
        `Access-Control-Allow-Origin is ${cors ?? 'missing'}; expected ${config.base}`));
    } else {
      results.push(pass('services-cors', 'Public services API CORS', `CORS allows only the configured public origin`));
    }
    if (!/\bno-store\b/i.test(cacheControl)) {
      results.push(issue(config, 'services-cache', 'Public services API cache policy', 'technical',
        `Cache-Control must include no-store; received ${cacheControl || 'missing'}`));
    } else {
      results.push(pass('services-cache', 'Public services API cache policy', '/services is marked no-store'));
    }
  } catch (error) {
    results.push(issue(config, 'services-network', 'Public services API', 'technical', safeMessage(error)));
    return;
  }

  const validation = validateServices(payload, config.requiredServices);
  const privacyProblems = validation.problems.filter(({ code }) => code === 'privacy');
  const turnstileProblems = validation.problems.filter(({ code }) => code === 'turnstile');
  const missingServiceProblems = validation.problems.filter(({ code }) => code === 'service-missing');
  const unverifiedServiceProblems = validation.problems.filter(({ code }) => code === 'service-unverified');

  if (privacyProblems.length === 0) {
    results.push(pass('privacy-version', 'Privacy notice readiness',
      `Published privacy notice version: ${validation.privacyVersion}`));
  } else {
    results.push(issue(config, 'privacy-version', 'Privacy notice readiness', 'readiness',
      privacyProblems.map(({ message }) => message).join('; ')));
  }
  if (turnstileProblems.length === 0) {
    results.push(pass('turnstile-key', 'Turnstile readiness', 'A public Turnstile site key is published'));
  } else {
    results.push(issue(config, 'turnstile-key', 'Turnstile readiness', 'readiness',
      turnstileProblems.map(({ message }) => message).join('; ')));
  }
  if (missingServiceProblems.length > 0) {
    results.push(issue(config, 'required-services-contract', 'Required services API contract', 'technical',
      missingServiceProblems.map(({ message }) => message).join('; ')));
  }
  if (missingServiceProblems.length === 0 && unverifiedServiceProblems.length === 0) {
    results.push(pass('required-services', 'Required service verification',
      `All ${config.requiredServices.length} required services are present and verified`));
  } else if (unverifiedServiceProblems.length > 0) {
    results.push(issue(config, 'required-services', 'Required service verification', 'readiness',
      unverifiedServiceProblems.map(({ message }) => message).join('; ')));
  }

  const availabilityReadinessProblems = [];
  const availabilityTechnicalProblems = [];
  const now = new Date();
  const until = new Date(now.valueOf() + (44 * 86_400_000));
  for (const service of validation.appointmentServices) {
    const query = new URLSearchParams({
      service_id: service.id,
      from: now.toISOString(),
      until: until.toISOString(),
    });
    try {
      const fetched = await fetchPublic(`${config.api}/availability?${query}`, {
        headers: { Accept: 'application/json', Origin: config.base },
      }, config.timeoutMs);
      let responsePayload;
      try {
        responsePayload = JSON.parse(fetched.text);
      } catch {
        responsePayload = null;
      }
      const slots = Array.isArray(responsePayload?.slots) ? responsePayload.slots : [];
      if (fetched.response.status !== 200) {
        availabilityTechnicalProblems.push(`${service.slug}: HTTP ${fetched.response.status}`);
      } else if (!responsePayload || !Array.isArray(responsePayload.slots)) {
        availabilityTechnicalProblems.push(`${service.slug}: response has no slots array`);
      } else if (slots.length === 0) {
        availabilityReadinessProblems.push(`${service.slug}: no published slots in the next 44 days`);
      }
    } catch (error) {
      availabilityTechnicalProblems.push(`${service.slug}: ${safeMessage(error)}`);
    }
  }
  if (validation.appointmentServices.length === 0) {
    results.push(warning('availability-none', 'Appointment availability',
      'No required service currently uses appointment booking, so no slot readiness check was applicable'));
  } else if (availabilityReadinessProblems.length === 0 && availabilityTechnicalProblems.length === 0) {
    results.push(pass('availability', 'Appointment availability',
      `All ${validation.appointmentServices.length} appointment services have a published slot in the next 44 days`));
  } else {
    if (availabilityTechnicalProblems.length > 0) {
      results.push(issue(config, 'availability-contract', 'Appointment availability API contract', 'technical',
        availabilityTechnicalProblems.join('; ')));
    }
    if (availabilityReadinessProblems.length > 0) {
    results.push(issue(config, 'availability', 'Appointment availability', 'readiness',
        availabilityReadinessProblems.join('; ')));
    }
  }
  return payload;
}

async function auditSameOriginBridge(config, results, directPayload) {
  const problems = [];
  const safeResponses = [];
  const endpoint = `${config.base}/api/insurespr?route=services`;
  try {
    const fetched = await fetchPublic(endpoint, {
      headers: { Accept: 'application/json' },
    }, config.timeoutMs);
    let bridgePayload = null;
    try {
      bridgePayload = JSON.parse(fetched.text);
    } catch {
      problems.push('services response is not valid JSON');
    }
    if (fetched.response.status !== 200) {
      const parsed = parseApiError(fetched.text);
      problems.push(`services returned HTTP ${fetched.response.status} ${parsed.code ?? parsed.message ?? ''}`.trim());
    } else if (!directPayload) {
      problems.push('authoritative direct services response is unavailable for comparison');
    } else if (bridgePayload) {
      const inspection = inspectSameOriginBridge(directPayload, bridgePayload, fetched.response.headers);
      problems.push(...inspection.problems);
    }
  } catch (error) {
    problems.push(`services request failed: ${safeMessage(error)}`);
  }

  const acceptedSafeCodes = new Set(['BOT_CHECK_UNAVAILABLE', 'BOT_CHECK_REQUIRED']);
  for (const formEndpoint of FORM_ENDPOINTS) {
    try {
      const fetched = await fetchPublic(
        `${config.base}/api/insurespr?route=${encodeURIComponent(formEndpoint)}`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Origin: config.base,
          },
          body: '{}',
        },
        config.timeoutMs,
      );
      const parsed = parseApiError(fetched.text);
      if (fetched.response.status >= 200 && fetched.response.status < 300) {
        problems.push(`${formEndpoint}: unsafe ${fetched.response.status}; an empty payload was accepted`);
      } else if (!acceptedSafeCodes.has(parsed.code) || ![422, 503].includes(fetched.response.status)) {
        problems.push(
          `${formEndpoint}: HTTP ${fetched.response.status} ${parsed.code ?? parsed.message ?? 'unknown response'}`,
        );
      } else {
        safeResponses.push(`${formEndpoint}: ${parsed.code}`);
      }
    } catch (error) {
      problems.push(`${formEndpoint}: ${safeMessage(error)}`);
    }
  }

  if (problems.length > 0) {
    results.push(issue(
      config,
      'same-origin-bridge',
      'Same-origin verification bridge',
      'technical',
      problems.join('; '),
      { endpoint, safeResponses },
    ));
  } else {
    results.push(pass(
      'same-origin-bridge',
      'Same-origin verification bridge',
      'Official-domain services match Supabase, execute in fra1, expose no secret and all protected routes reject empty probes',
      { endpoint, safeResponses },
    ));
  }
}

async function auditForms(config, results) {
  const acceptedSafeCodes = new Set(['BOT_CHECK_REQUIRED', 'VALIDATION_ERROR', 'INVALID_REQUEST']);
  const readinessProblems = [];
  const technicalProblems = [];
  const successes = [];
  for (const endpoint of FORM_ENDPOINTS) {
    try {
      const fetched = await fetchPublic(`${config.api}/${endpoint}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: config.base,
        },
        body: '{}',
      }, config.timeoutMs);
      const cors = fetched.response.headers.get('access-control-allow-origin');
      const parsed = parseApiError(fetched.text);
      if (fetched.response.status >= 200 && fetched.response.status < 300) {
        technicalProblems.push(`${endpoint}: unsafe ${fetched.response.status}; an empty payload was accepted`);
      } else if (cors !== config.base) {
        technicalProblems.push(`${endpoint}: CORS is ${cors ?? 'missing'}; expected ${config.base}`);
      } else if (parsed.code === 'PRIVACY_NOTICE_NOT_READY') {
        readinessProblems.push(`${endpoint}: privacy notice is not ready`);
      } else if (parsed.code === 'BOT_CHECK_UNAVAILABLE') {
        readinessProblems.push(`${endpoint}: Turnstile server configuration is not ready`);
      } else if (fetched.response.status === 403) {
        technicalProblems.push(`${endpoint}: official origin was rejected`);
      } else if (acceptedSafeCodes.has(parsed.code) && [400, 422].includes(fetched.response.status)) {
        successes.push(`${endpoint}: ${parsed.code}`);
      } else {
        technicalProblems.push(`${endpoint}: HTTP ${fetched.response.status} ${parsed.code ?? parsed.message ?? 'unknown response'}`);
      }
    } catch (error) {
      technicalProblems.push(`${endpoint}: ${safeMessage(error)}`);
    }
  }

  if (technicalProblems.length > 0) {
    results.push(issue(config, 'form-integrity', 'Official-origin form API integrity', 'technical',
      technicalProblems.join('; '), { safeResponses: successes }));
  }
  if (readinessProblems.length > 0) {
    results.push(issue(config, 'form-gates', 'Official-origin form privacy and validation gates', 'readiness',
      readinessProblems.join('; '), { safeResponses: successes }));
  }
  if (technicalProblems.length === 0 && readinessProblems.length === 0) {
    results.push(pass('form-gates', 'Official-origin form privacy and validation gates',
      'All form endpoints rejected empty, PII-free payloads after passing origin/privacy readiness checks', successes));
  }
}

async function auditNotifications(config, results) {
  try {
    const fetched = await fetchPublic(config.notifications, {
      headers: { Accept: 'application/json' },
    }, config.timeoutMs);
    let payload = null;
    try {
      payload = JSON.parse(fetched.text);
    } catch {
      // A non-JSON response cannot be treated as a machine-readable readiness signal.
    }
    const headerReady = fetched.response.headers.get('x-insurespr-ready')?.toLowerCase() === 'true';
    const bodyReady = payload?.ready === true || (payload?.ok === true && payload?.readiness === 'ready');
    if (fetched.response.status === 200 && (headerReady || bodyReady)) {
      results.push(pass('notifications', 'Notification readiness',
        'The unauthenticated read-only readiness signal reports ready'));
    } else {
      results.push(issue(config, 'notifications', 'Notification readiness', 'readiness',
        'Notification delivery readiness is not externally verifiable without invoking the worker; no scheduler secret or PII was sent', {
          status: fetched.response.status,
          readinessSignal: headerReady || bodyReady,
        }));
    }
  } catch (error) {
    results.push(issue(config, 'notifications-network', 'Notification readiness', 'readiness',
      `Read-only readiness probe failed: ${safeMessage(error)}`));
  }
}

const DNS_ABSENCE_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME', 'ENOENT']);

async function resolveDnsRecord(resolver, hostname, type) {
  try {
    const records = type === 'MX'
      ? await resolver.resolveMx(hostname)
      : await resolver.resolveTxt(hostname);
    return {
      records: type === 'TXT'
        ? records.map((segments) => segments.join(''))
        : records,
      error: null,
    };
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'DNS_ERROR';
    if (DNS_ABSENCE_CODES.has(code)) return { records: [], error: null };
    return { records: [], error: `${code}: ${safeMessage(error)}` };
  }
}

async function collectEmailDns(config) {
  const senderDomain = new URL(config.base).hostname.replace(/^www\./i, '');
  const replyDomain = config.emailReplyTo.split('@')[1];
  const queryDefinitions = [
    ['senderMx', senderDomain, 'MX'],
    ['returnPathMx', config.returnPathHost, 'MX'],
    ['returnPathTxt', config.returnPathHost, 'TXT'],
    ['dmarcTxt', `_dmarc.${senderDomain}`, 'TXT'],
    ['dkimTxt', config.dkimHost, 'TXT'],
    ['replyMx', replyDomain, 'MX'],
  ];

  const resolverResults = await Promise.all(DNS_RESOLVERS.map(async ({ name, server }) => {
    const resolver = new Resolver({ timeout: Math.min(config.timeoutMs, 10_000), tries: 1 });
    resolver.setServers([server]);
    const entries = await Promise.all(queryDefinitions.map(async ([key, hostname, type]) => [
      key,
      await resolveDnsRecord(resolver, hostname, type),
    ]));
    return [name, Object.fromEntries(entries)];
  }));

  return {
    senderDomain,
    replyDomain,
    dkimHost: config.dkimHost,
    returnPathHost: config.returnPathHost,
    resolvers: Object.fromEntries(resolverResults),
  };
}

function resolverNamesMissing(snapshot, predicate) {
  return Object.entries(snapshot.resolvers)
    .filter(([, records]) => !predicate(records))
    .map(([name]) => name);
}

function evaluateEmailDns(snapshot) {
  const checks = [
    {
      id: 'email-spf',
      title: 'Transactional email SPF',
      message: `SPF is published at ${snapshot.returnPathHost} on both public resolvers`,
      missingMessage: `No Resend-compatible SPF record is published at ${snapshot.returnPathHost}`,
      predicate: (records) => records.returnPathTxt.records.some((value) => /^v=spf1\b/i.test(value.trim())),
    },
    {
      id: 'email-return-path-mx',
      title: 'Transactional email Return-Path MX',
      message: `The provider Return-Path ${snapshot.returnPathHost} has an MX record on both public resolvers`,
      missingMessage: `The provider Return-Path ${snapshot.returnPathHost} has no MX record`,
      predicate: (records) => records.returnPathMx.records.length > 0,
    },
    {
      id: 'email-dkim',
      title: 'Transactional email DKIM',
      message: `DKIM is published at ${snapshot.dkimHost} on both public resolvers`,
      missingMessage: `No DKIM public key is published at ${snapshot.dkimHost}`,
      predicate: (records) => records.dkimTxt.records.some((value) => /(?:^|;)\s*p\s*=\s*[^;\s]+/i.test(value)),
    },
    {
      id: 'email-dmarc',
      title: 'Transactional email DMARC',
      message: `DMARC is published for ${snapshot.senderDomain} on both public resolvers`,
      missingMessage: `No DMARC policy is published at _dmarc.${snapshot.senderDomain}`,
      predicate: (records) => records.dmarcTxt.records.some((value) => /^v=DMARC1\b/i.test(value.trim())),
    },
    {
      id: 'email-reply-mx',
      title: 'Approved reply mailbox DNS',
      message: `The approved reply domain ${snapshot.replyDomain} has an MX record on both public resolvers`,
      missingMessage: `The approved reply domain ${snapshot.replyDomain} has no MX record`,
      predicate: (records) => records.replyMx.records.length > 0,
    },
  ];

  return checks.map((check) => ({
    ...check,
    missingResolvers: resolverNamesMissing(snapshot, check.predicate),
  }));
}

async function auditEmailDns(config, results) {
  let snapshot;
  try {
    snapshot = await collectEmailDns(config);
  } catch (error) {
    results.push(issue(config, 'email-dns-network', 'Transactional email DNS', 'technical',
      `DNS readiness audit failed: ${safeMessage(error)}`));
    return;
  }

  const dnsErrors = [];
  for (const [resolverName, records] of Object.entries(snapshot.resolvers)) {
    for (const [queryName, query] of Object.entries(records)) {
      if (query.error) dnsErrors.push(`${resolverName} ${queryName}: ${query.error}`);
    }
  }
  if (dnsErrors.length > 0) {
    results.push(issue(config, 'email-dns-network', 'Transactional email DNS', 'technical',
      'One or more authoritative DNS checks could not be completed', dnsErrors));
    return;
  }

  for (const check of evaluateEmailDns(snapshot)) {
    if (check.missingResolvers.length === 0) {
      results.push(pass(check.id, check.title, check.message));
    } else {
      results.push(issue(config, check.id, check.title, 'readiness', check.missingMessage, {
        checkedResolvers: DNS_RESOLVERS.map(({ name }) => name),
        missingOn: check.missingResolvers,
      }));
    }
  }

  const senderMxMissing = resolverNamesMissing(snapshot, (records) => records.senderMx.records.length > 0);
  if (senderMxMissing.length === 0) {
    results.push(pass('email-sender-mx', 'Official-domain mailbox DNS',
      `${snapshot.senderDomain} has an inbound MX route on both public resolvers`));
  } else {
    results.push(warning('email-sender-mx', 'Official-domain mailbox DNS',
      `${snapshot.senderDomain} has no inbound MX route; keep Reply-To on ${config.emailReplyTo} and do not publish an @${snapshot.senderDomain} receiving address`, {
        checkedResolvers: DNS_RESOLVERS.map(({ name }) => name),
        missingOn: senderMxMissing,
      }));
  }
}

async function auditLegacyManifest(config, results) {
  const inventoryPath = path.join(PROJECT_ROOT, 'LEGACY-SEO-URL-INVENTORY.md');
  let expectedCount = null;
  if (existsSync(inventoryPath)) {
    try {
      expectedCount = inventoryExpectedCount(await readFile(inventoryPath, 'utf8'));
    } catch {
      // The explicit manifest validation below remains useful without the count.
    }
  }

  const candidates = config.legacyManifest
    ? [path.resolve(process.cwd(), config.legacyManifest)]
    : [
        path.join(PROJECT_ROOT, 'legacy-redirects.json'),
        path.join(PROJECT_ROOT, 'LEGACY-REDIRECT-MANIFEST.json'),
      ];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));
  if (!manifestPath) {
    results.push(issue(config, 'legacy-manifest', 'Legacy redirect manifest', 'readiness',
      expectedCount == null
        ? 'No machine-readable legacy redirect manifest is available'
        : `No machine-readable redirect manifest accounts for the ${expectedCount}-URL legacy inventory`, {
          searched: candidates.map((candidate) => path.relative(PROJECT_ROOT, candidate)),
        }));
    return;
  }

  try {
    const payload = JSON.parse(await readFile(manifestPath, 'utf8'));
    const validation = validateLegacyManifest(payload, expectedCount);
    if (validation.ok) {
      results.push(pass('legacy-manifest', 'Legacy redirect manifest',
        `${validation.redirects.length} legacy URLs have terminal, machine-readable dispositions`,
        path.relative(PROJECT_ROOT, manifestPath)));
    } else {
      results.push(issue(config, 'legacy-manifest', 'Legacy redirect manifest', 'readiness',
        `${validation.problems.length} manifest problem(s) found`, validation.problems));
    }
  } catch (error) {
    results.push(issue(config, 'legacy-manifest-json', 'Legacy redirect manifest', 'technical',
      `Manifest cannot be read as JSON: ${safeMessage(error)}`));
  }
}

async function auditRecoveryManifest(config, results) {
  const manifestPath = config.recoveryManifest
    ? path.resolve(process.cwd(), config.recoveryManifest)
    : path.join(PROJECT_ROOT, 'RECOVERY-READINESS.json');
  if (!existsSync(manifestPath)) {
    results.push(issue(config, 'recovery-readiness', 'Backup and recovery readiness', 'readiness',
      'No machine-readable backup/recovery evidence manifest is available'));
    return;
  }

  try {
    const payload = JSON.parse(await readFile(manifestPath, 'utf8'));
    const validation = validateRecoveryManifest(payload);
    if (validation.contractProblems.length > 0) {
      results.push(issue(config, 'recovery-contract', 'Backup and recovery evidence contract', 'technical',
        `${validation.contractProblems.length} recovery manifest contract problem(s) found`, validation.contractProblems));
    } else if (!validation.ok) {
      results.push(issue(config, 'recovery-readiness', 'Backup and recovery readiness', 'readiness',
        `${validation.readinessProblems.length} recovery requirement(s) remain open`, validation.readinessProblems));
    } else {
      results.push(pass('recovery-readiness', 'Backup and recovery readiness',
        'A funded backup route, approved RPO/RTO, named owner and successful restore drill are verified'));
    }
  } catch (error) {
    results.push(issue(config, 'recovery-manifest-json', 'Backup and recovery evidence contract', 'technical',
      `Recovery manifest cannot be read as JSON: ${safeMessage(error)}`));
  }
}

function summaryFor(results) {
  return results.reduce((summary, item) => {
    summary[item.status] += 1;
    return summary;
  }, { pass: 0, warn: 0, fail: 0 });
}

function printHuman(config, results, summary) {
  console.log('InsureSPR read-only production preflight');
  console.log(`Mode: ${config.mode} | Site: ${config.base} | API: ${config.api}`);
  console.log('Safety: public GET and DNS probes plus invalid empty form payloads only; no PII, secrets or stateful writes.');
  console.log('');
  for (const item of results) {
    const marker = item.status === 'pass' ? 'PASS' : item.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${item.title}: ${item.message}`);
    if (item.evidence && item.status !== 'pass') {
      const formatted = typeof item.evidence === 'string'
        ? item.evidence
        : JSON.stringify(item.evidence, null, 2);
      for (const line of formatted.split('\n')) console.log(`       ${line}`);
    }
  }
  console.log('');
  console.log(`Summary: ${summary.pass} passed, ${summary.warn} warning(s), ${summary.fail} blocker(s).`);
  if (config.mode === 'preview') {
    console.log('Preview mode downgrades practice-owned readiness blockers only; technical integrity remains strict.');
  }
}

async function runSelfTest() {
  const base = DEFAULT_BASE;
  const page = `${base}/dxa-bone-density`;
  const validHtml = `<!doctype html><html><head>
    <link rel="canonical" href="${page}">
    <meta property="og:url" content="${page}">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","url":"${page}"}</script>
  </head><body></body></html>`;
  assert.equal(inspectHtml(validHtml, page, base).ok, true);
  const wrongLd = validHtml.replace(`"url":"${page}"`, '"url":"https://insuresprhealth.co.za/dxa-bone-density"');
  assert.equal(inspectHtml(wrongLd, page, base).ok, false);

  const robots = inspectRobots(`User-agent: *\nDisallow:\nSitemap: ${base}/sitemap.xml\n`, base);
  assert.equal(robots.ok, true);
  assert.equal(inspectRobots(`User-agent: *\nDisallow: /\nSitemap: ${base}/sitemap.xml`, base).ok, false);
  assert.deepEqual(parseSitemap(`<urlset><url><loc>${base}/</loc></url><url><loc>${base}/spr</loc></url></urlset>`), [
    `${base}/`, `${base}/spr`,
  ]);

  const readyServices = {
    practice: { privacy_notice_version: '2026-08-13' },
    turnstile_site_key: '0x4AAAA-test',
    services: DEFAULT_REQUIRED_SERVICES.map((slug, index) => ({
      id: `service-${index}`,
      slug,
      verification_status: 'verified',
      booking_mode: index < 2 ? 'appointment' : 'request',
    })),
  };
  assert.equal(validateServices(readyServices, DEFAULT_REQUIRED_SERVICES).ok, true);
  const pendingServices = structuredClone(readyServices);
  pendingServices.practice.privacy_notice_version = 'pending-approval';
  pendingServices.turnstile_site_key = null;
  pendingServices.services[0].verification_status = 'needs_confirmation';
  assert.deepEqual(
    validateServices(pendingServices, DEFAULT_REQUIRED_SERVICES).problems.map(({ code }) => code),
    ['privacy', 'turnstile', 'service-unverified'],
  );

  const parsedDefaults = parseArgs([]);
  assert.equal(parsedDefaults.emailReplyTo, DEFAULT_EMAIL_REPLY_TO);
  assert.equal(parsedDefaults.dkimHost, 'resend._domainkey.insuresprhealth.co.za');
  assert.equal(parsedDefaults.returnPathHost, 'send.insuresprhealth.co.za');
  const readyDnsRecords = {
    senderMx: { records: [], error: null },
    returnPathMx: { records: [{ exchange: 'feedback-smtp.example', priority: 10 }], error: null },
    returnPathTxt: { records: ['v=spf1 include:amazonses.com ~all'], error: null },
    dmarcTxt: { records: ['v=DMARC1; p=none'], error: null },
    dkimTxt: { records: ['v=DKIM1; p=TESTKEY'], error: null },
    replyMx: { records: [{ exchange: 'mx.example', priority: 10 }], error: null },
  };
  const readyDnsSnapshot = {
    senderDomain: 'insuresprhealth.co.za',
    replyDomain: 'bonevc.co.za',
    dkimHost: 'resend._domainkey.insuresprhealth.co.za',
    returnPathHost: 'send.insuresprhealth.co.za',
    resolvers: {
      Cloudflare: structuredClone(readyDnsRecords),
      Google: structuredClone(readyDnsRecords),
    },
  };
  assert.equal(evaluateEmailDns(readyDnsSnapshot).length, 5);
  assert.equal(evaluateEmailDns(readyDnsSnapshot).every((check) => check.missingResolvers.length === 0), true);
  const missingDnsSnapshot = structuredClone(readyDnsSnapshot);
  missingDnsSnapshot.resolvers.Google.returnPathTxt.records = [];
  missingDnsSnapshot.resolvers.Google.returnPathMx.records = [];
  missingDnsSnapshot.resolvers.Google.dmarcTxt.records = [];
  missingDnsSnapshot.resolvers.Google.dkimTxt.records = [];
  missingDnsSnapshot.resolvers.Google.replyMx.records = [];
  assert.deepEqual(
    evaluateEmailDns(missingDnsSnapshot).map((check) => [check.id, check.missingResolvers]),
    [
      ['email-spf', ['Google']],
      ['email-return-path-mx', ['Google']],
      ['email-dkim', ['Google']],
      ['email-dmarc', ['Google']],
      ['email-reply-mx', ['Google']],
    ],
  );
  assert.throws(() => normalizeEmail('not-an-email', '--email-reply-to'));
  assert.throws(() => normalizeHostname('bad host', '--dkim-host'));

  const manifest = DEFAULT_REQUIRED_SERVICES.map((slug) => ({
    source: `https://legacy.example/${slug}`,
    destination: `${base}/${slug}`,
    status: 'redirect',
  }));
  assert.equal(validateLegacyManifest({ redirects: manifest }, manifest.length).ok, true);
  manifest[0].status = 'needs_review';
  assert.equal(validateLegacyManifest({ redirects: manifest }, manifest.length).ok, false);
  const approvedHold = {
    status: 'approved-hold-no-routing',
    activationAuthorized: false,
    holdApproval: {
      status: 'approved',
      approvedBy: 'Test Owner',
      approvedAt: '2026-08-21T00:00:00.000Z',
    },
    entries: manifest.map((entry) => ({ source: entry.source, state: 'hold', destination: null })),
  };
  assert.equal(validateLegacyManifest(approvedHold, manifest.length).ok, true);
  approvedHold.activationAuthorized = true;
  assert.equal(validateLegacyManifest(approvedHold, manifest.length).ok, false);
  approvedHold.activationAuthorized = false;
  delete approvedHold.holdApproval.approvedBy;
  assert.equal(validateLegacyManifest(approvedHold, manifest.length).ok, false);
  assert.equal(inventoryExpectedCount('contains **153 unique sitemap-listed URLs** across two sites'), 153);

  const readyRecovery = {
    schemaVersion: 1,
    status: 'ready',
    activationAuthorized: true,
    observedAt: '2026-08-29T00:23:00.000Z',
    provider: 'supabase',
    projectRef: 'ffdmmxffzewqiacsuvhr',
    projectStatus: 'ACTIVE_HEALTHY',
    region: 'eu-central-1',
    databaseVersion: '17.6.1.155',
    organizationPlan: 'pro',
    managedDailyBackups: { included: true, verifiedRestorePoints: true },
    pointInTimeRecovery: { included: false, verifiedRecoveryWindow: false },
    offsiteLogicalBackup: { implemented: false, encrypted: false, verifiedAt: null, custodian: null },
    recoveryApproval: {
      owner: 'Recovery Owner',
      rpoMinutes: 1440,
      rtoMinutes: 240,
      lastSuccessfulRestoreDrillAt: '2026-08-28T12:00:00.000Z',
      approvedAt: '2026-08-29T00:00:00.000Z',
      approvedBy: 'Practice Owner',
    },
    evidence: {
      platformState: 'Supabase Management API',
      backupDocumentation: 'https://supabase.com/docs/guides/platform/backups',
    },
  };
  assert.equal(validateRecoveryManifest(readyRecovery).ok, true);
  const blockedRecovery = structuredClone(readyRecovery);
  blockedRecovery.status = 'blocked';
  blockedRecovery.activationAuthorized = false;
  blockedRecovery.organizationPlan = 'free';
  blockedRecovery.managedDailyBackups = { included: false, verifiedRestorePoints: false };
  blockedRecovery.recoveryApproval = {
    owner: null,
    rpoMinutes: null,
    rtoMinutes: null,
    lastSuccessfulRestoreDrillAt: null,
    approvedAt: null,
    approvedBy: null,
  };
  assert.equal(validateRecoveryManifest(blockedRecovery).ok, false);
  assert.equal(validateRecoveryManifest(blockedRecovery).contractProblems.length, 0);
  const unsafeRecovery = structuredClone(readyRecovery);
  unsafeRecovery.databasePassword = 'must-never-appear';
  assert.match(validateRecoveryManifest(unsafeRecovery).contractProblems.join(' '), /forbidden secret-like field/);

  const headers = new Headers({
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=()',
  });
  assert.equal(inspectSecurityHeaders(headers).ok, true);
  const directServices = {
    practice: { privacy_notice_version: 'pending-approval' },
    categories: [{ id: 'category' }],
    services: [{ id: 'service' }],
    turnstile_site_key: null,
  };
  const bridgedServices = structuredClone(directServices);
  const bridgeHeaders = new Headers({
    'cache-control': 'no-store',
    'x-vercel-id': 'cpt1::fra1::test-id',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=()',
  });
  assert.equal(inspectSameOriginBridge(directServices, bridgedServices, bridgeHeaders).ok, true);
  bridgedServices.services[0].id = 'changed';
  assert.equal(inspectSameOriginBridge(directServices, bridgedServices, bridgeHeaders).ok, false);
  console.log('release-audit offline self-test: PASS (28 assertions)');
}

async function main() {
  let config;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Configuration error: ${safeMessage(error)}\n`);
    console.error(help());
    process.exitCode = 2;
    return;
  }
  if (config.help) {
    console.log(help());
    return;
  }
  if (config.selfTest) {
    await runSelfTest();
    return;
  }

  const results = [];
  await auditPublicSite(config, results);
  const servicesPayload = await auditServices(config, results);
  await auditSameOriginBridge(config, results, servicesPayload);
  await auditForms(config, results);
  await auditNotifications(config, results);
  await auditEmailDns(config, results);
  await auditRecoveryManifest(config, results);
  await auditLegacyManifest(config, results);
  const summary = summaryFor(results);
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    mode: config.mode,
    base: config.base,
    api: config.api,
    notifications: config.notifications,
    emailReplyTo: config.emailReplyTo,
    dkimHost: config.dkimHost,
    returnPathHost: config.returnPathHost,
    summary,
    results,
  };

  if (config.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(config, results, summary);
  if (!config.reportOnly && summary.fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Release audit crashed: ${safeMessage(error)}`);
  process.exitCode = 2;
});
