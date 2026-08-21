#!/usr/bin/env node

/**
 * Read-only production preflight for InsureSPR.
 *
 * Network behaviour is deliberately limited to public GET requests and three
 * invalid empty-object form probes. The invalid probes contain no PII and
 * cannot satisfy the API's validation contract, so they cannot create records.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE = 'https://www.insuresprhealth.co.za';
const DEFAULT_API = 'https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-api';
const DEFAULT_NOTIFICATIONS = 'https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-notifications';
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
  --mode <release|preview>      Release is strict; preview downgrades readiness blockers
  --required-services <csv>     Required public service slugs
  --legacy-manifest <path>      Optional JSON redirect manifest to validate
  --timeout-ms <milliseconds>   Per-request timeout (default: 15000)
  --json                        Emit machine-readable JSON
  --report-only                 Always exit zero after producing the report
  --self-test                   Run deterministic offline fixture tests
  --help                        Show this help

The audit performs no stateful writes. Form checks send only an invalid empty
JSON object with no personal information. Notification readiness is checked by
unauthenticated GET only; the worker is never invoked with scheduler secrets.`;
}

function parseArgs(argv) {
  const config = {
    base: DEFAULT_BASE,
    api: DEFAULT_API,
    notifications: DEFAULT_NOTIFICATIONS,
    mode: 'release',
    requiredServices: [...DEFAULT_REQUIRED_SERVICES],
    legacyManifest: null,
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
      case '--mode':
        config.mode = takeValue();
        break;
      case '--required-services':
        config.requiredServices = takeValue().split(',').map((value) => value.trim()).filter(Boolean);
        break;
      case '--legacy-manifest':
        config.legacyManifest = takeValue();
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
    if (!terminalStatuses.has(status)) {
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

function summaryFor(results) {
  return results.reduce((summary, item) => {
    summary[item.status] += 1;
    return summary;
  }, { pass: 0, warn: 0, fail: 0 });
}

function printHuman(config, results, summary) {
  console.log('InsureSPR read-only production preflight');
  console.log(`Mode: ${config.mode} | Site: ${config.base} | API: ${config.api}`);
  console.log('Safety: public GET probes plus invalid empty form payloads only; no PII, secrets or stateful writes.');
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

  const manifest = DEFAULT_REQUIRED_SERVICES.map((slug) => ({
    source: `https://legacy.example/${slug}`,
    destination: `${base}/${slug}`,
    status: 'redirect',
  }));
  assert.equal(validateLegacyManifest({ redirects: manifest }, manifest.length).ok, true);
  manifest[0].status = 'needs_review';
  assert.equal(validateLegacyManifest({ redirects: manifest }, manifest.length).ok, false);
  assert.equal(inventoryExpectedCount('contains **153 unique sitemap-listed URLs** across two sites'), 153);

  const headers = new Headers({
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=()',
  });
  assert.equal(inspectSecurityHeaders(headers).ok, true);
  console.log('release-audit offline self-test: PASS (12 assertions)');
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
  await auditServices(config, results);
  await auditForms(config, results);
  await auditNotifications(config, results);
  await auditLegacyManifest(config, results);
  const summary = summaryFor(results);
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    mode: config.mode,
    base: config.base,
    api: config.api,
    notifications: config.notifications,
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
