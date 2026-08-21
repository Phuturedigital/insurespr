import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const { chromium } = loadPlaywright();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const formPages = [
  ['book.html', 'book-form'],
  ['contact.html', 'contact-form'],
  ['workforce.html', 'employer-form'],
  ['manage-booking.html', 'manage-booking-form']
];
const intakePages = formPages.slice(0, 3);
const apiPattern = '**/functions/v1/insurespr-api/**';
const approvedVersion = '2026-08-13';
const approvedConfig = {
  practice: { privacy_notice_version: approvedVersion },
  services: [{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'X-Ray',
    slug: 'x-ray',
    booking_mode: 'request',
    price_type: 'unpublished',
    verification_status: 'verified'
  }],
  turnstile_site_key: 'test-site-key'
};

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

const submissions = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/form-unavailable') {
    let body = '';
    for await (const chunk of request) body += chunk;
    submissions.push({ method: request.method, url: request.url, body });
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Online form unavailable');
    return;
  }

  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': contentType(target) });
    response.end(body);
  } catch (_) {
    response.writeHead(404).end();
  }
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer() {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function mockPublicApi(context, config = approvedConfig) {
  await context.route('https://challenges.cloudflare.com/turnstile/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: "window.turnstile={render:function(_mount,options){options.callback('test-turnstile-token');return 1;},reset:function(){},remove:function(){}};"
    });
  });
  await context.route(apiPattern, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/services')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
      return;
    }
    if (pathname.endsWith('/availability')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"slots":[]}' });
      return;
    }
    if (pathname.endsWith('/events')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":{"message":"Unexpected test request"}}' });
  });
}

async function assertClosedNativeForm(browser, base, javaScriptEnabled, blockProduction) {
  const context = await browser.newContext({ javaScriptEnabled });
  if (blockProduction) await context.route('**/production.js*', (route) => route.abort());
  for (const [pageName, formId] of formPages) {
    const page = await context.newPage();
    await page.goto(`${base}/${pageName}`, { waitUntil: 'domcontentloaded' });
    const snapshot = await page.locator(`#${formId}`).evaluate((form) => {
      const gate = form.querySelector('[data-form-gate]');
      const notice = document.querySelector(`[data-form-gate-status="${form.id}"]`);
      return {
        method: form.method,
        action: new URL(form.getAttribute('action'), location.href).pathname,
        disabled: gate instanceof HTMLFieldSetElement && gate.disabled,
        noticeVisible: Boolean(notice && !notice.hidden)
      };
    });
    assert.equal(snapshot.method, 'post', `${pageName} must use POST without relying on JavaScript`);
    assert.equal(snapshot.action, '/form-unavailable', `${pageName} must use the safe same-origin action`);
    assert.equal(snapshot.disabled, true, `${pageName} must remain gated`);
    assert.equal(snapshot.noticeVisible, true, `${pageName} must expose fallback contact details`);

    const before = submissions.length;
    await Promise.all([
      page.waitForURL('**/form-unavailable'),
      page.locator(`#${formId}`).evaluate((form) => {
        const text = form.querySelector('input[type="text"], input[type="email"], textarea');
        if (text) text.value = 'pii-sentinel@example.com';
        form.submit();
      })
    ]);
    assert.equal(submissions.length, before + 1, `${pageName} native submit should reach only the safe endpoint`);
    const submission = submissions.at(-1);
    assert.equal(submission.method, 'POST');
    assert.equal(submission.url, '/form-unavailable');
    assert.equal(submission.body.includes('pii-sentinel'), false, `${pageName} disabled controls must not serialize PII`);
    assert.equal(page.url().includes('?'), false, `${pageName} must never put form data in a URL`);
    await page.close();
  }
  await context.close();
}

async function assertApprovedForms(browser, base) {
  const context = await browser.newContext();
  await mockPublicApi(context);
  for (const [pageName, formId] of intakePages) {
    const page = await context.newPage();
    await page.goto(`${base}/${pageName}`, { waitUntil: 'domcontentloaded' });
    await page.locator(`#${formId}[data-ready="true"]`).waitFor();
    assert.equal(await page.locator(`#${formId} [data-form-gate]`).evaluate((gate) => gate.disabled), false, `${pageName} approved form should open`);
    assert.equal(await page.locator(`#${formId} [name="privacy_version"]`).inputValue(), approvedVersion);
    const policy = page.locator(`#${formId} [data-consent-policy-label]`);
    await page.waitForFunction((id) => !document.querySelector(`#${id} [data-consent-policy-label]`)?.hidden, formId);
    assert.match(await policy.textContent(), new RegExp(approvedVersion));
    assert.equal(await page.locator(`[data-form-gate-status="${formId}"]`).isHidden(), true);
    await page.close();
  }
  await context.close();
}

async function assertPendingForms(browser, base) {
  const context = await browser.newContext();
  await mockPublicApi(context, {
    practice: { privacy_notice_version: 'pending' },
    services: approvedConfig.services,
    turnstile_site_key: 'test-site-key'
  });
  for (const [pageName, formId] of intakePages) {
    const page = await context.newPage();
    await page.goto(`${base}/${pageName}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((id) => document.getElementById(id)?.dataset.ready === 'false', formId);
    assert.equal(await page.locator(`#${formId} [data-form-gate]`).evaluate((gate) => gate.disabled), true, `${pageName} pending policy must stay closed`);
    assert.equal(await page.locator(`[data-form-gate-status="${formId}"] [data-form-gate-title]`).textContent(), 'Online requests are not open yet.');
    if (formId === 'book-form') assert.equal(await page.locator('#booking-email').isDisabled(), true);
    await page.close();
  }
  await context.close();
}

async function assertMissingProtectionStaysClosed(browser, base) {
  const context = await browser.newContext();
  await mockPublicApi(context, {
    practice: { privacy_notice_version: approvedVersion },
    services: approvedConfig.services,
    turnstile_site_key: '   '
  });
  const page = await context.newPage();
  await page.goto(`${base}/book.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('book-form')?.dataset.ready === 'false');
  assert.equal(await page.locator('#book-form [data-form-gate]').evaluate((gate) => gate.disabled), true);
  assert.match(await page.locator('[data-form-gate-status="book-form"] [data-form-gate-copy]').textContent(), /anti-spam protection still needs setup/i);
  assert.equal(await page.locator('#booking-email').isDisabled(), true);
  await context.close();
}

async function assertConfigFailureStaysClosed(browser, base) {
  const context = await browser.newContext();
  await context.route(apiPattern, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"test"}}' }));
  const page = await context.newPage();
  await page.goto(`${base}/contact.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('contact-form')?.dataset.ready === 'false');
  assert.equal(await page.locator('#contact-form [data-form-gate]').evaluate((gate) => gate.disabled), true);
  assert.equal(await page.locator('[data-form-gate-status="contact-form"] [data-form-gate-title]').textContent(), 'The online form could not be opened.');
  await context.close();
}

async function assertStalePolicyClosesForm(browser, base) {
  const context = await browser.newContext();
  let submittedPayload;
  await context.route('https://challenges.cloudflare.com/turnstile/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: "window.turnstile={render:function(_mount,options){options.callback('test-turnstile-token');return 1;},reset:function(){},remove:function(){}};"
    });
  });
  await context.route(apiPattern, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/services')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(approvedConfig) });
      return;
    }
    if (pathname.endsWith('/contact-enquiries')) {
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: '{"error":{"code":"PRIVACY_NOTICE_CHANGED","message":"Review the current notice."}}'
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  await page.goto(`${base}/contact.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#contact-form[data-ready="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('#contact-form [name="turnstile_token"]')?.value === 'test-turnstile-token');
  await page.locator('#cname').fill('Safety Test');
  await page.locator('#cemail').fill('safety@example.test');
  await page.locator('#cmsg').fill('Please contact me.');
  await page.locator('#cprivacy').check();
  await page.locator('#contact-form [type="submit"]').click();
  await page.waitForFunction(() => document.getElementById('contact-form')?.dataset.ready === 'false');
  assert.equal(submittedPayload.privacy_version, approvedVersion, 'submitted payload must carry the approved version');
  assert.equal(await page.locator('#contact-form [data-form-gate]').evaluate((gate) => gate.disabled), true);
  assert.equal(await page.locator('#cprivacy').isChecked(), false);
  assert.equal(await page.locator('#contact-form [name="privacy_version"]').inputValue(), '');
  assert.match(await page.locator('[data-form-gate-status="contact-form"] [data-form-gate-title]').textContent(), /Privacy notice changed/);
  await context.close();
}

async function assertManagementTokens(browser, base) {
  const tokenA = 'a'.repeat(64);
  const tokenB = 'b'.repeat(64);
  for (const [suffix, token] of [[`#token=${tokenA}`, tokenA], [`?token=${tokenB}`, tokenB]]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/manage-booking.html${suffix}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#manage-booking-form[data-ready="true"]').waitFor();
    assert.equal(page.url(), `${base}/manage-booking.html`, 'management token must be cleared from the visible URL');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('insurespr.manageToken')), token);
    assert.equal(await page.locator('#manage-booking-form [name="token"]').inputValue(), token);
    assert.equal(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    await context.close();
  }
}

async function assertMarketingSanitization(browser, base) {
  const context = await browser.newContext();
  await mockPublicApi(context);
  const page = await context.newPage();
  const query = new URLSearchParams({
    utm_source: 'safe-source',
    utm_medium: 'person@example.com',
    utm_campaign: '+27 71 000 0000',
    utm_term: 'x'.repeat(121),
    utm_content: 'safe-content'
  });
  await page.goto(`${base}/contact.html?${query}`, { waitUntil: 'domcontentloaded' });
  const marketing = await page.evaluate(() => JSON.parse(sessionStorage.getItem('insurespr.marketing')));
  assert.equal(marketing.utm_source, 'safe-source');
  assert.equal(marketing.utm_content, 'safe-content');
  assert.equal(marketing.utm_medium, null);
  assert.equal(marketing.utm_campaign, null);
  assert.equal(marketing.utm_term, null);
  assert.equal(marketing.landing_path, '/contact.html');
  await context.close();
}

const source = await readFile(path.join(root, 'production.js'), 'utf8');
assert.match(source, /booking_request_submitted/);
assert.doesNotMatch(source, /booking_completed/);

const port = await listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
try {
  await assertClosedNativeForm(browser, base, false, false);
  await assertClosedNativeForm(browser, base, true, true);
  await assertApprovedForms(browser, base);
  await assertPendingForms(browser, base);
  await assertMissingProtectionStaysClosed(browser, base);
  await assertConfigFailureStaysClosed(browser, base);
  await assertStalePolicyClosesForm(browser, base);
  await assertManagementTokens(browser, base);
  await assertMarketingSanitization(browser, base);
  console.log('Form safety tests passed.');
} finally {
  await browser.close();
  await closeServer();
}
