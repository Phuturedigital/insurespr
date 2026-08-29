/**
 * Deterministic static-site performance regression audit.
 *
 * This is intentionally read-only: it starts an ephemeral loopback server,
 * opens isolated Chromium contexts, prints measurements, and writes nothing.
 * It measures browser lab CWV entries where Chromium exposes them and labels
 * local-only proxies separately. External fonts/API calls are stubbed so CI is
 * repeatable; their request count remains visible, but their production bytes
 * and latency are not represented by this audit.
 *
 * Usage:
 *   node tools/performance-audit.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const { chromium } = loadPlaywright();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROUTES = [
  { name: 'home', path: '/index.html' },
  { name: 'x-ray', path: '/xray.html' },
  { name: 'booking', path: '/book.html' },
  { name: 'workforce', path: '/workforce.html' },
];

const PROFILES = [
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    context: { isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
    maxViewportScreens: 20,
  },
  {
    name: 'desktop',
    viewport: { width: 1440, height: 900 },
    context: { isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
    maxViewportScreens: 14,
  },
];

// These are release gates, not targets fitted to the current output. They are
// deliberately close to common CWV and lean static-site expectations.
const BUDGET = Object.freeze({
  initialFirstPartyEncodedBytes: 900 * 1024,
  fullFirstPartyEncodedBytes: 1800 * 1024,
  fullImageEncodedBytes: 1500 * 1024,
  fullCssEncodedBytes: 40 * 1024,
  fullJsEncodedBytes: 40 * 1024,
  largestFirstPartyResponseBytes: 250 * 1024,
  initialRequests: 18,
  fullRequests: 30,
  thirdPartyRequests: 4,
  fcpMs: 1800,
  lcpMs: 2500,
  cls: 0.1,
  renderedReadyMs: 2500,
  longTaskTotalMs: 200,
  longestTaskMs: 50,
  domNodes: 1200,
  horizontalOverflowElements: 0,
  imagesWithoutDimensions: 0,
  failedRequests: 0,
  consoleErrors: 0,
});

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/;
const serverEvents = [];

function typeFromMime(mime, pathname) {
  if (pathname.endsWith('.html')) return 'document';
  if (mime.startsWith('text/css')) return 'css';
  if (mime.includes('javascript')) return 'js';
  if (mime.startsWith('image/')) return 'image';
  return 'other';
}

function safeFilePath(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (pathname === '/') pathname = '/index.html';
  if (!path.extname(pathname)) pathname += '.html';
  const candidate = path.resolve(ROOT, `.${pathname}`);
  return candidate === ROOT || candidate.startsWith(`${ROOT}${path.sep}`)
    ? candidate
    : null;
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const filePath = safeFilePath(requestUrl.pathname);
  try {
    if (!filePath || !(await stat(filePath)).isFile()) throw new Error('not-found');
    const raw = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mime = MIME.get(extension) || 'application/octet-stream';
    const encoded = COMPRESSIBLE.test(mime)
      ? gzipSync(raw, { level: 9 })
      : raw;
    const relativePath = `/${path.relative(ROOT, filePath).replaceAll('\\', '/')}`;
    serverEvents.push({
      pathname: relativePath,
      rawBytes: raw.byteLength,
      encodedBytes: encoded.byteLength,
      type: typeFromMime(mime, relativePath),
      status: 200,
    });
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mime,
      'Content-Length': String(encoded.byteLength),
      'Content-Encoding': COMPRESSIBLE.test(mime) ? 'gzip' : 'identity',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else response.end(encoded);
  } catch {
    serverEvents.push({
      pathname: requestUrl.pathname,
      rawBytes: 0,
      encodedBytes: 0,
      type: 'other',
      status: 404,
    });
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

async function listen() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer() {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function aggregate(events) {
  const output = {
    requests: events.length,
    rawBytes: 0,
    encodedBytes: 0,
    documentBytes: 0,
    cssBytes: 0,
    jsBytes: 0,
    imageBytes: 0,
    otherBytes: 0,
    largestResponseBytes: 0,
    largestResponsePath: '',
    statusFailures: 0,
  };
  for (const event of events) {
    output.rawBytes += event.rawBytes;
    output.encodedBytes += event.encodedBytes;
    output[`${event.type}Bytes`] += event.encodedBytes;
    output.statusFailures += event.status >= 400 ? 1 : 0;
    if (event.encodedBytes > output.largestResponseBytes) {
      output.largestResponseBytes = event.encodedBytes;
      output.largestResponsePath = event.pathname;
    }
  }
  return output;
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function ms(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : 'unavailable';
}

function check(label, actual, limit, unit = '') {
  return {
    label,
    actual,
    limit,
    passed: Number.isFinite(actual) && actual <= limit,
    display: `${unit === 'bytes' ? kib(actual) : actual.toFixed(unit === 'score' ? 3 : 0)} / ${unit === 'bytes' ? kib(limit) : limit}${unit === 'ms' ? ' ms' : ''}`,
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return Number.NaN;
  return sorted[Math.floor(sorted.length / 2)];
}

function applyMedianVitals(samples) {
  const result = samples[0];
  const keys = ['ttfb', 'domContentLoaded', 'load', 'fcp', 'cls', 'layoutShifts', 'lcp', 'longTaskTotal', 'longestTask'];
  result.initialVitals = Object.fromEntries(keys.map((key) => [
    key,
    median(samples.map((sample) => sample.initialVitals[key])),
  ]));
  result.renderedReadyMs = median(samples.map((sample) => sample.renderedReadyMs));
  result.timingSamples = samples.map((sample) => sample.initialVitals);

  const replacements = new Map([
    ['FCP (local lab)', check('FCP (local lab)', result.initialVitals.fcp, BUDGET.fcpMs, 'ms')],
    ['LCP (local lab)', check('LCP (local lab)', result.initialVitals.lcp, BUDGET.lcpMs, 'ms')],
    ['CLS (local lab)', check('CLS (local lab)', result.initialVitals.cls, BUDGET.cls, 'score')],
    ['rendered-ready proxy', check('rendered-ready proxy', result.renderedReadyMs, BUDGET.renderedReadyMs, 'ms')],
    ['initial long-task total', check('initial long-task total', result.initialVitals.longTaskTotal, BUDGET.longTaskTotalMs, 'ms')],
    ['initial longest task', check('initial longest task', result.initialVitals.longestTask, BUDGET.longestTaskMs, 'ms')],
  ]);
  result.checks = result.checks.map((item) => replacements.get(item.label) || item);
  return result;
}

async function waitForRenderedReady(page) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const visibleImages = [...document.images].filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      });
      const heading = document.querySelector('h1');
      const headingStyle = heading ? getComputedStyle(heading) : null;
      return {
        ready: document.readyState === 'complete'
          && visibleImages.every((image) => image.complete && image.naturalWidth > 0)
          && document.fonts.status === 'loaded'
          && Boolean(heading && heading.getBoundingClientRect().height > 0)
          && headingStyle?.visibility !== 'hidden'
          && headingStyle?.display !== 'none',
        now: performance.now(),
      };
    });
    if (state.ready) return state.now;
    await page.waitForTimeout(50);
  }
  return Number.POSITIVE_INFINITY;
}

async function scrollJourney(page) {
  await page.evaluate(async () => {
    const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
    // The audit intentionally measures the complete page payload, so opt every
    // image into loading inside this disposable browser context before walking
    // the document. This does not mutate source files or production behavior.
    for (const image of document.images) image.loading = 'eager';
    const step = Math.max(320, Math.floor(innerHeight * 0.8));
    for (let top = 0; top < document.documentElement.scrollHeight; top += step) {
      scrollTo(0, top);
      await delay(55);
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await delay(150);
    scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(async (image) => {
      if (!image.complete) {
        await Promise.race([
          new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
      if (image.complete && image.naturalWidth) await image.decode().catch(() => {});
    }));
  });
  await page.waitForTimeout(250);
}

async function runScenario(browser, origin, route, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    reducedMotion: 'reduce',
    ...profile.context,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const pageRequests = [];
  const failedRequests = [];
  const consoleErrors = [];
  const externalEvents = [];

  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) {
      pageRequests.push({ url: request.url(), type: request.resourceType() });
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    window.__insureSprPerformance = {
      cls: 0,
      layoutShifts: 0,
      lcp: 0,
      longTaskTotal: 0,
      longestTask: 0,
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__insureSprPerformance.cls += entry.value;
          window.__insureSprPerformance.layoutShifts += 1;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length) {
        window.__insureSprPerformance.lcp = entries.at(-1).startTime;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__insureSprPerformance.longTaskTotal += entry.duration;
        window.__insureSprPerformance.longestTask = Math.max(
          window.__insureSprPerformance.longestTask,
          entry.duration,
        );
      }
    }).observe({ type: 'longtask', buffered: true });
  });

  await context.route('**/*', async (intercept) => {
    const request = intercept.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      await intercept.continue();
      return;
    }

    const commonHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type, x-client-version',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store',
    };
    let status = 200;
    let contentType = 'text/plain; charset=utf-8';
    let body = '';

    if (url.hostname === 'ffdmmxffzewqiacsuvhr.supabase.co'
      && url.pathname.endsWith('/services')) {
      contentType = 'application/json; charset=utf-8';
      body = JSON.stringify({
        practice: { privacy_notice_version: 'pending-approval' },
        categories: [],
        services: [],
        intake_ready: false,
        turnstile_site_key: null,
      });
    } else if (url.hostname === 'ffdmmxffzewqiacsuvhr.supabase.co'
      && url.pathname.endsWith('/events')) {
      contentType = 'application/json; charset=utf-8';
      body = request.method() === 'OPTIONS' ? '' : JSON.stringify({ recorded: true });
      status = request.method() === 'OPTIONS' ? 204 : 200;
    } else if (url.hostname === 'fonts.googleapis.com') {
      contentType = 'text/css; charset=utf-8';
      body = '/* deterministic audit: production font transfer is excluded */';
    }

    const bytes = Buffer.byteLength(body);
    externalEvents.push({
      url: request.url(),
      hostname: url.hostname,
      bytes,
      status,
    });
    await intercept.fulfill({ status, contentType, headers: commonHeaders, body });
  });

  const serverStart = serverEvents.length;
  const requestStart = pageRequests.length;
  const externalStart = externalEvents.length;
  await page.goto(`${origin}${route.path}`, { waitUntil: 'load', timeout: 15_000 });
  const renderedReadyMs = await waitForRenderedReady(page);
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  const serverInitialEnd = serverEvents.length;
  const requestInitialEnd = pageRequests.length;
  const externalInitialEnd = externalEvents.length;
  const initialVitals = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      ttfb: navigation?.responseStart || Number.NaN,
      domContentLoaded: navigation?.domContentLoadedEventEnd || Number.NaN,
      load: navigation?.loadEventEnd || Number.NaN,
      fcp: firstContentfulPaint?.startTime || Number.NaN,
      cls: window.__insureSprPerformance.cls,
      layoutShifts: window.__insureSprPerformance.layoutShifts,
      lcp: window.__insureSprPerformance.lcp,
      longTaskTotal: window.__insureSprPerformance.longTaskTotal,
      longestTask: window.__insureSprPerformance.longestTask,
    };
  });

  await scrollJourney(page);

  const browserMetrics = await page.evaluate(() => {
    const documentOverflows = document.documentElement.scrollWidth
      > document.documentElement.clientWidth + 1;
    const overflow = documentOverflows
      ? [...document.querySelectorAll('body *')].filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && (rect.left < -1 || rect.right > innerWidth + 1);
        })
      : [];
    const missingImageDimensions = [...document.images].filter((image) =>
      !image.hasAttribute('width') || !image.hasAttribute('height'));
    return {
      fullJourneyLongTaskTotal: window.__insureSprPerformance.longTaskTotal,
      fullJourneyLongestTask: window.__insureSprPerformance.longestTask,
      domNodes: document.querySelectorAll('*').length,
      viewportScreens: document.documentElement.scrollHeight / innerHeight,
      horizontalOverflowElements: overflow.length,
      overflowExamples: overflow.slice(-3).map((element) => {
        const rect = element.getBoundingClientRect();
        return `${element.tagName.toLowerCase()}.${String(element.className || '').split(/\s+/).slice(0, 2).join('.')} (${Math.round(rect.left)}..${Math.round(rect.right)})`;
      }),
      imagesWithoutDimensions: missingImageDimensions.length,
      brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).length,
    };
  });

  const firstPartyInitial = aggregate(serverEvents.slice(serverStart, serverInitialEnd));
  const firstPartyFull = aggregate(serverEvents.slice(serverStart));
  const initialRequestCount = requestInitialEnd - requestStart;
  const fullRequestCount = pageRequests.length - requestStart;
  const initialThirdParty = externalInitialEnd - externalStart;
  const fullThirdParty = externalEvents.length - externalStart;

  const checks = [
    check('initial first-party transfer', firstPartyInitial.encodedBytes, BUDGET.initialFirstPartyEncodedBytes, 'bytes'),
    check('full first-party transfer', firstPartyFull.encodedBytes, BUDGET.fullFirstPartyEncodedBytes, 'bytes'),
    check('full image transfer', firstPartyFull.imageBytes, BUDGET.fullImageEncodedBytes, 'bytes'),
    check('CSS transfer', firstPartyFull.cssBytes, BUDGET.fullCssEncodedBytes, 'bytes'),
    check('JavaScript transfer', firstPartyFull.jsBytes, BUDGET.fullJsEncodedBytes, 'bytes'),
    check('largest first-party response', firstPartyFull.largestResponseBytes, BUDGET.largestFirstPartyResponseBytes, 'bytes'),
    check('initial request count', initialRequestCount, BUDGET.initialRequests),
    check('full request count', fullRequestCount, BUDGET.fullRequests),
    check('third-party request count', fullThirdParty, BUDGET.thirdPartyRequests),
    check('FCP (local lab)', initialVitals.fcp, BUDGET.fcpMs, 'ms'),
    check('LCP (local lab)', initialVitals.lcp, BUDGET.lcpMs, 'ms'),
    check('CLS (local lab)', initialVitals.cls, BUDGET.cls, 'score'),
    check('rendered-ready proxy', renderedReadyMs, BUDGET.renderedReadyMs, 'ms'),
    check('initial long-task total', initialVitals.longTaskTotal, BUDGET.longTaskTotalMs, 'ms'),
    check('initial longest task', initialVitals.longestTask, BUDGET.longestTaskMs, 'ms'),
    check('DOM nodes', browserMetrics.domNodes, BUDGET.domNodes),
    check('horizontal overflow elements', browserMetrics.horizontalOverflowElements, BUDGET.horizontalOverflowElements),
    check('images without dimensions', browserMetrics.imagesWithoutDimensions, BUDGET.imagesWithoutDimensions),
    check('failed requests', failedRequests.length + firstPartyFull.statusFailures + browserMetrics.brokenImages, BUDGET.failedRequests),
    check('console errors', consoleErrors.length, BUDGET.consoleErrors),
    check('page length in viewport screens', browserMetrics.viewportScreens, profile.maxViewportScreens, 'score'),
  ];

  await context.close();
  return {
    name: `${route.name}/${profile.name}`,
    firstPartyInitial,
    firstPartyFull,
    initialRequestCount,
    fullRequestCount,
    initialThirdParty,
    fullThirdParty,
    initialVitals,
    browserMetrics,
    renderedReadyMs,
    failedRequests,
    consoleErrors,
    checks,
  };
}

let origin;
let browser;
const results = [];
try {
  origin = await listen();
  browser = await chromium.launch({ headless: true });
  console.log('InsureSPR performance budgets');
  console.log(`Loopback origin: ${origin}`);
  console.log('Lighthouse: unavailable in this workspace; no Lighthouse score is claimed.');
  console.log('CWV entries below are real Chromium lab entries on unthrottled loopback, not field data.');
  console.log('Timing release gates use the median of three isolated browser runs per scenario.');
  console.log('Transfer totals are deterministic gzip/raw first-party bodies; production font/API bytes are stubbed and excluded.\n');

  for (const profile of PROFILES) {
    for (const route of ROUTES) {
      const samples = [];
      for (let repetition = 0; repetition < 3; repetition += 1) {
        samples.push(await runScenario(browser, origin, route, profile));
      }
      const result = applyMedianVitals(samples);
      results.push(result);
      const failed = result.checks.filter((item) => !item.passed);
      const metric = result.browserMetrics;
      const vitals = result.initialVitals;
      console.log(`${failed.length ? 'FAIL' : 'PASS'} ${result.name}`);
      console.log(`  requests initial/full: ${result.initialRequestCount}/${result.fullRequestCount} (${result.fullThirdParty} stubbed external)`);
      console.log(`  transfer initial/full: ${kib(result.firstPartyInitial.encodedBytes)}/${kib(result.firstPartyFull.encodedBytes)} · images ${kib(result.firstPartyFull.imageBytes)} · JS ${kib(result.firstPartyFull.jsBytes)} · CSS ${kib(result.firstPartyFull.cssBytes)}`);
      console.log(`  FCP ${ms(vitals.fcp)} · LCP ${ms(vitals.lcp)} · CLS ${vitals.cls.toFixed(3)} · ready proxy ${ms(result.renderedReadyMs)} · initial long tasks ${ms(vitals.longTaskTotal)}`);
      console.log(`  initial longest-task samples: ${result.timingSamples.map((sample) => ms(sample.longestTask)).join(' / ')}`);
      console.log(`  diagnostic full-scroll long tasks: ${ms(metric.fullJourneyLongTaskTotal)} (includes the audit's scripted eager-load/scroll journey and is not a release gate)`);
      console.log(`  DOM ${metric.domNodes} · length ${metric.viewportScreens.toFixed(1)} screens · overflow ${metric.horizontalOverflowElements} · largest ${result.firstPartyFull.largestResponsePath} ${kib(result.firstPartyFull.largestResponseBytes)}`);
      for (const failure of failed) console.log(`  BUDGET ${failure.label}: ${failure.display}`);
      if (metric.overflowExamples.length) console.log(`  overflow examples: ${metric.overflowExamples.join(' | ')}`);
      if (result.failedRequests.length) console.log(`  failed: ${result.failedRequests.slice(0, 2).join(' | ')}`);
      if (result.consoleErrors.length) console.log(`  console: ${result.consoleErrors.slice(0, 2).join(' | ')}`);
      console.log('');
    }
  }
} finally {
  if (browser) await browser.close();
  if (origin) await closeServer();
}

const failedChecks = results.flatMap((result) =>
  result.checks.filter((item) => !item.passed).map((item) => ({
    scenario: result.name,
    ...item,
  })));

console.log(`Summary: ${results.length} scenarios, ${failedChecks.length} budget violation(s).`);
if (failedChecks.length) {
  console.log('The audit failed; budgets were not relaxed to match the current site.');
  process.exitCode = 1;
} else {
  console.log('All objective performance budgets passed.');
}
