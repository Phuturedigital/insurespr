import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

/*
 * Deterministic keyboard/focus accessibility journey.
 *
 * This is a bounded browser regression test, not an accessibility overlay,
 * screen-reader certification, or claim of WCAG conformance. It exercises the
 * real static pages over an ephemeral loopback server, while all public API and
 * anti-spam traffic is fulfilled in the browser context. It performs no
 * production reads or writes.
 */

const { chromium } = loadPlaywright();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPattern = '**/functions/v1/insurespr-api/**';
const privacyVersion = '2026-08-13';
const managementToken = 'a'.repeat(64);

const requestService = {
  id: '22222222-2222-4222-8222-222222222222',
  category_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'primary-healthcare-x-ray',
  name: 'Primary Healthcare X-Ray',
  short_description: 'Everyday imaging with staff confirmation.',
  audience: 'individual',
  booking_mode: 'request',
  confirmation_mode: 'staff',
  appointment_duration_minutes: null,
  price_type: 'unpublished',
  cash_price_cents: null,
  cash_price_max_cents: null,
  currency: 'ZAR',
  price_note: null,
  medical_aid_status: 'needs_confirmation',
  referral_requirement: 'Email the practice if you are unsure.',
  appointment_requirement: 'Submit a preferred time and staff will confirm.',
  what_to_bring: null,
  expected_duration: null,
  results_process: null,
  preparation_instructions: null,
  verification_status: 'verified',
  display_order: 1
};

const approvedConfig = {
  practice: {
    practice_name: 'InsureSPR Precision Healthcare',
    descriptor: 'X-Ray, Medicals and Bone Density, Malibongwe Drive, Randburg',
    address_line: '7 Malibongwe Drive, EmedCentre',
    locality: 'Randburg',
    region: 'Gauteng',
    country_code: 'ZA',
    phone_display: null,
    phone_e164: null,
    whatsapp_e164: null,
    public_email: 'health@insuresprhealth.co.za',
    timezone: 'Africa/Johannesburg',
    opening_hours: { monday: ['08:00', '17:00'] },
    maps_url: 'https://maps.google.com/?q=7+Malibongwe+Drive+EmedCentre+Randburg',
    privacy_notice_version: privacyVersion
  },
  categories: [],
  services: [requestService],
  turnstile_site_key: '1x00000000000000000000AA'
};

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(root, relative);

  if (target !== root && !target.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': contentType(target), 'Cache-Control': 'no-store' });
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
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function futureDate(days = 21) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function bookingResponse(date) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    reference: 'ISR-A11Y-0001',
    service_id: requestService.id,
    service_name: requestService.name,
    status: 'pending',
    slot_id: null,
    slot_start: null,
    slot_end: null,
    preferred_date: date,
    preferred_time_period: 'morning',
    management_token: managementToken
  };
}

async function fulfillJson(route, status, body = {}) {
  if (status === 204) {
    await route.fulfill({ status, body: '' });
    return;
  }
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  });
}

async function installMocks(context, options = {}) {
  const calls = { bookings: [], actions: [], events: [] };

  await context.route('https://fonts.googleapis.com/**', (route) => {
    return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
  });
  await context.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'));
  await context.route('https://challenges.cloudflare.com/turnstile/**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: `window.turnstile={
        render:function(_mount,options){setTimeout(function(){options.callback('a11y-turnstile-token');},0);return 1;},
        reset:function(){},remove:function(){}
      };`
    });
  });

  await context.route(apiPattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const routePath = url.pathname.split('/insurespr-api')[1] || '/';

    if (request.method() === 'GET' && routePath === '/services') {
      await fulfillJson(route, 200, approvedConfig);
      return;
    }
    if (request.method() === 'GET' && routePath === '/availability') {
      await fulfillJson(route, 200, { slots: [] });
      return;
    }
    if (request.method() === 'POST' && routePath === '/events') {
      calls.events.push(request.postDataJSON());
      await fulfillJson(route, 204);
      return;
    }
    if (request.method() === 'POST' && routePath === '/bookings') {
      const payload = request.postDataJSON();
      calls.bookings.push(payload);
      if (options.bookingError) {
        await fulfillJson(route, 503, {
          error: {
            code: 'BOOKING_TEMPORARILY_UNAVAILABLE',
            message: 'The booking service is temporarily unavailable. Please try again.'
          }
        });
      } else {
        await fulfillJson(route, 201, { booking: bookingResponse(payload.preferred_date) });
      }
      return;
    }
    if (request.method() === 'POST' && routePath === '/booking-actions') {
      const payload = request.postDataJSON();
      calls.actions.push(payload);
      await fulfillJson(route, 200, {
        booking: {
          reference: 'ISR-MANAGE-0001',
          status: payload.action === 'cancel' ? 'cancelled' : 'reschedule_requested'
        }
      });
      return;
    }

    await fulfillJson(route, 400, {
      error: { code: 'UNEXPECTED_TEST_REQUEST', message: `Unexpected ${request.method()} ${routePath}` }
    });
  });

  return calls;
}

async function withContext(browser, options, callback) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    reducedMotion: options.reducedMotion || 'no-preference'
  });

  try {
    if (options.observeMotion) {
      await context.addInitScript(() => {
        window.__a11yMotion = { intervals: [], scrollIntoView: [], scrollTo: [], scrollBy: [] };

        const originalInterval = window.setInterval;
        window.setInterval = function (callback, delay, ...args) {
          window.__a11yMotion.intervals.push(Number(delay));
          return originalInterval.call(this, callback, delay, ...args);
        };

        const originalScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (options) {
          window.__a11yMotion.scrollIntoView.push(
            options && typeof options === 'object' ? { ...options } : options
          );
          return originalScrollIntoView.call(this, options);
        };

        const originalScrollTo = window.scrollTo;
        window.scrollTo = function (...args) {
          window.__a11yMotion.scrollTo.push(args);
          return originalScrollTo.apply(this, args);
        };

        const originalScrollBy = Element.prototype.scrollBy;
        Element.prototype.scrollBy = function (...args) {
          window.__a11yMotion.scrollBy.push(args);
          return originalScrollBy.apply(this, args);
        };
      });
    }

    const calls = await installMocks(context, options);
    return await callback(context, calls);
  } finally {
    await context.close();
  }
}

async function activeElementSnapshot(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    const rect = active.getBoundingClientRect();
    return {
      tag: active.tagName.toLowerCase(),
      id: active.id,
      className: typeof active.className === 'string' ? active.className : '',
      text: (active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth) || 0
    };
  });
}

async function assertVisibleFocus(page, message) {
  /* Keyboard focus can trigger the page's smooth-scroll behavior. Chromium on
     Linux reports the new active element before that native scroll animation
     reaches it, so allow the browser to finish bringing the control on screen
     before evaluating the accessibility invariant. This still fails closed if
     focus never becomes visible. */
  try {
    await page.waitForFunction(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return false;
      const style = getComputedStyle(active);
      const rect = active.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        style.visibility !== 'hidden' && style.display !== 'none' &&
        rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    }, undefined, { timeout: 3000 });
  } catch {
    /* Keep the detailed assertions below as the single diagnostic surface. */
  }
  const snapshot = await activeElementSnapshot(page);
  assert.ok(snapshot, `${message}: the page has no active HTML element`);
  assert.notEqual(snapshot.tag, 'body', `${message}: keyboard focus fell back to the document body`);
  assert.equal(snapshot.visible, true, `${message}: the focused element is not rendered (${JSON.stringify(snapshot)})`);
  assert.equal(snapshot.inViewport, true, `${message}: the focused element is outside the viewport (${JSON.stringify(snapshot)})`);
  assert.notEqual(snapshot.outlineStyle, 'none', `${message}: the focused element has no visible outline (${JSON.stringify(snapshot)})`);
  assert.ok(snapshot.outlineWidth >= 2, `${message}: focus outline is thinner than 2px (${JSON.stringify(snapshot)})`);
  return snapshot;
}

async function tabUntil(page, selector, maximum = 12) {
  for (let index = 0; index < maximum; index += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((candidate) => document.activeElement?.matches(candidate), selector)) return;
  }
  assert.fail(`Tab did not reach ${selector} within ${maximum} stops`);
}

async function waitForReadyForm(page, formSelector) {
  await page.locator(`${formSelector}[data-ready="true"]`).waitFor();
}

async function waitForStep(page, step) {
  await page.waitForFunction((expected) => {
    const active = document.querySelector('.booking-step:not([hidden])');
    return Number(active?.getAttribute('data-book-step')) === expected;
  }, step);
}

async function pressButton(page, selector) {
  await page.locator(selector).focus();
  /* locator.focus() is programmatic and does not itself establish keyboard
     modality for :focus-visible. A real backwards/forwards keyboard roundtrip
     proves both reachability and the focus indication on the target. */
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate((candidate) => document.activeElement?.matches(candidate), selector),
    true,
    `${selector} must be reachable again through sequential keyboard focus`
  );
  await assertVisibleFocus(page, `before activating ${selector}`);
  await page.keyboard.press('Enter');
}

async function fillBookingDetails(page) {
  await page.locator('#bfirst').fill('Accessibility');
  await page.locator('#bsurname').fill('Journey');
  await page.locator('#bphone').fill('083 111 2233');
  await page.locator('#bemail').fill('accessibility@example.test');
  await page.locator('#bstatus').selectOption('new');
  await page.locator('#bnotes').fill('Step-free access, please.');
  await page.locator('#bprivacy').check();
}

async function semanticScan(context, page, pageName) {
  const problems = await page.evaluate(() => {
    const issues = [];
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && !element.closest('[hidden], [inert]');
    };

    const ids = new Map();
    document.querySelectorAll('[id]').forEach((element) => {
      const id = element.id;
      ids.set(id, (ids.get(id) || 0) + 1);
    });
    for (const [id, count] of ids) {
      if (count > 1) issues.push(`duplicate id #${id} (${count} uses)`);
    }

    if (document.querySelectorAll('main').length !== 1) {
      issues.push(`expected one main landmark; found ${document.querySelectorAll('main').length}`);
    }
    if (document.querySelectorAll('h1').length !== 1) {
      issues.push(`expected one h1; found ${document.querySelectorAll('h1').length}`);
    }

    document.querySelectorAll('img').forEach((image) => {
      if (!image.hasAttribute('alt')) issues.push(`image ${image.src} has no alt attribute`);
    });

    document.querySelectorAll('[aria-controls]').forEach((control) => {
      const target = control.getAttribute('aria-controls');
      if (target && !document.getElementById(target)) {
        issues.push(`${control.tagName.toLowerCase()}[aria-controls="${target}"] has no matching target`);
      }
    });

    document.querySelectorAll('input:not([type="hidden"]), select, textarea, button').forEach((control) => {
      if (!visible(control)) return;
      const label = control.labels && Array.from(control.labels).some((item) => item.textContent.trim());
      const named = label || control.getAttribute('aria-label')?.trim() || control.getAttribute('aria-labelledby')?.trim() || control.textContent.trim();
      if (!named) issues.push(`${control.tagName.toLowerCase()}${control.id ? `#${control.id}` : ''} has no accessible-name source`);
    });

    document.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => {
      const focusable = hidden.querySelector(
        'a[href]:not([tabindex="-1"]), button:not([tabindex="-1"]), input:not([type="hidden"]):not([tabindex="-1"]), select:not([tabindex="-1"]), textarea:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable && visible(focusable)) {
        issues.push(`aria-hidden subtree contains focusable ${focusable.tagName.toLowerCase()}${focusable.id ? `#${focusable.id}` : ''}`);
      }
    });

    return issues;
  });

  let axNodes;
  try {
    const session = await context.newCDPSession(page);
    await session.send('Accessibility.enable');
    ({ nodes: axNodes } = await session.send('Accessibility.getFullAXTree'));
    await session.detach();
  } catch (error) {
    problems.push(`Chromium accessibility tree was unavailable: ${error.message}`);
  }

  if (axNodes) {
    const namedRoles = new Set(['button', 'link', 'combobox', 'textbox', 'checkbox', 'radio']);
    for (const node of axNodes) {
      const role = node.role?.value;
      if (node.ignored || !namedRoles.has(role)) continue;
      if (!String(node.name?.value || '').trim()) {
        problems.push(`accessibility tree exposes an unnamed ${role} (backend node ${node.backendDOMNodeId || 'unknown'})`);
      }
    }
    if (!axNodes.some((node) => !node.ignored && node.role?.value === 'main')) {
      problems.push('accessibility tree has no main landmark');
    }
  }

  assert.deepEqual(problems, [], `${pageName} semantic scan found:\n- ${problems.join('\n- ')}`);
}

const tests = [
  {
    name: 'skip link transfers focus and keyboard focus remains visible',
    run: async (browser, base) => withContext(browser, {}, async (context) => {
      const page = await context.newPage();
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });

      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.skip')), true, 'the skip link must be the first Tab stop');
      await assertVisibleFocus(page, 'skip link focus');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.hash === '#main');
      const skipProblems = [];
      if (await page.evaluate(() => document.activeElement?.id) !== 'main') {
        skipProblems.push('activating the skip link changes the URL/scroll target but does not move programmatic focus to #main');
      }

      for (let index = 0; index < 6; index += 1) {
        await page.keyboard.press('Tab');
        await assertVisibleFocus(page, `homepage Tab stop ${index + 1} after main`);
      }
      assert.deepEqual(skipProblems, [], `skip-link journey found:\n- ${skipProblems.join('\n- ')}`);
    })
  },
  {
    name: 'mobile menu opens with Enter, closes with Escape, and restores focus',
    run: async (browser, base) => withContext(browser, { viewport: { width: 390, height: 844 } }, async (context) => {
      const page = await context.newPage();
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });

      await tabUntil(page, '.nav-toggle');
      await assertVisibleFocus(page, 'mobile menu button');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('nav-links')?.dataset.open === 'true');
      assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'true');

      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => Boolean(document.activeElement?.closest('#nav-links'))),
        true,
        'Tab from the open menu button must enter the disclosed navigation'
      );
      await assertVisibleFocus(page, 'first link in the open mobile menu');

      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#nav-links').getAttribute('data-open'), 'false');
      assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.nav-toggle')), true, 'Escape must restore focus to the menu button');
      await assertVisibleFocus(page, 'restored mobile menu focus');
    })
  },
  {
    name: 'booking wizard validation focuses errors and dynamic feedback is announced',
    run: async (browser, base) => withContext(browser, { bookingError: true }, async (context, calls) => {
      const page = await context.newPage();
      await page.goto(`${base}/book.html`, { waitUntil: 'domcontentloaded' });
      await waitForReadyForm(page, '#book-form');

      await pressButton(page, '[data-book-next="2"]');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'bservice', 'missing service must focus the service field');
      await assertVisibleFocus(page, 'invalid service field');

      await page.locator('#bservice').selectOption(requestService.id);
      await pressButton(page, '[data-book-next="2"]');
      await waitForStep(page, 2);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'bdate', 'step 2 must focus its first field');

      await pressButton(page, '[data-book-next="3"]');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'bdate', 'missing date must focus the date field');
      await assertVisibleFocus(page, 'invalid date field');

      await page.locator('#bdate').fill(futureDate());
      await pressButton(page, '[data-book-next="3"]');
      await waitForStep(page, 3);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'bperiod', 'step 3 must focus its first field');

      await page.locator('#bperiod').selectOption('morning');
      await pressButton(page, '[data-book-next="4"]');
      await waitForStep(page, 4);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'bfirst', 'step 4 must focus its first field');

      await pressButton(page, '[data-book-next="5"]');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'bfirst', 'invalid details must focus the first missing field');
      await assertVisibleFocus(page, 'invalid first-name field');

      await fillBookingDetails(page);
      await pressButton(page, '[data-book-next="5"]');
      await waitForStep(page, 5);
      assert.equal(await page.locator('[data-book-progress="5"]').getAttribute('aria-current'), 'step');
      assert.equal(await page.locator('#booking-review').getAttribute('aria-live'), 'polite');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-book-back="4"]')), true, 'review must receive a deterministic keyboard focus target');

      await page.waitForFunction(() => Boolean(document.querySelector('#book-form [name="turnstile_token"]')?.value));
      await pressButton(page, '#book-form [type="submit"]');
      await page.locator('#book-status:not([hidden])').waitFor();
      assert.equal(calls.bookings.length, 1, 'the keyboard submission must make one mocked booking request');
      assert.equal(await page.locator('#book-status').getAttribute('role'), 'alert', 'booking errors must be exposed as an alert live region');
      assert.match(await page.locator('#book-status').textContent(), /temporarily unavailable/i);
    })
  },
  {
    name: 'booking dialog traps focus and returns it to the keyboard trigger',
    run: async (browser, base) => withContext(browser, {}, async (context) => {
      const page = await context.newPage();
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
      const trigger = page.locator('.hero-booking-panel');
      await trigger.focus();
      await assertVisibleFocus(page, 'booking-dialog trigger');
      await page.keyboard.press('Enter');

      const dialog = page.locator('dialog.booking-dialog[open]');
      await dialog.waitFor();
      await page.frameLocator('dialog.booking-dialog iframe').locator('#book-form[data-ready="true"]').waitFor();
      assert.equal(await dialog.getAttribute('aria-label'), 'Request an appointment');
      assert.equal(
        await page.evaluate(() => Boolean(document.activeElement && document.querySelector('dialog[open]')?.contains(document.activeElement))),
        true,
        'opening the dialog must move focus inside it'
      );
      await assertVisibleFocus(page, 'initial booking-dialog focus');

      const containmentProblems = [];
      for (let index = 0; index < 10; index += 1) {
        await page.keyboard.press(index === 0 ? 'Shift+Tab' : 'Tab');
        const focusSnapshot = await activeElementSnapshot(page);
        const contained = await page.evaluate(() => Boolean(
          document.activeElement && document.querySelector('dialog[open]')?.contains(document.activeElement)
        ));
        if (!contained) containmentProblems.push(`focus escaped on keyboard step ${index + 1} (${JSON.stringify(focusSnapshot)})`);
      }

      await page.locator('.booking-dialog-bar button').focus();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      if (!await page.evaluate(() => document.activeElement?.matches('.hero-booking-panel'))) {
        containmentProblems.push(`Escape closed the dialog but focus did not return to .hero-booking-panel (${JSON.stringify(await activeElementSnapshot(page))})`);
      }
      await assertVisibleFocus(page, 'returned booking-dialog trigger focus');
      assert.deepEqual(containmentProblems, [], `booking-dialog journey found:\n- ${containmentProblems.join('\n- ')}`);
    })
  },
  {
    name: 'cancel and reschedule controls work from the keyboard and announce results',
    run: async (browser, base) => withContext(browser, {}, async (context, calls) => {
      const page = await context.newPage();
      await page.goto(`${base}/manage-booking.html#token=${managementToken}`, { waitUntil: 'domcontentloaded' });
      await waitForReadyForm(page, '#manage-booking-form');
      assert.equal(page.url(), `${base}/manage-booking.html`, 'the management token must be cleared from the visible URL');

      await page.locator('#maction').focus();
      await assertVisibleFocus(page, 'booking-change action control');
      assert.match(await page.locator('label[for="maction"]').textContent(), /what do you need/i);
      await page.locator('#mdate').fill(futureDate(28));
      await page.locator('#mperiod').selectOption('afternoon');
      await pressButton(page, '#manage-booking-form [type="submit"]');
      await page.waitForFunction(() => /reschedule request/i.test(document.getElementById('manage-booking-status')?.textContent || ''));
      assert.equal(calls.actions[0]?.action, 'request_reschedule');
      assert.equal(await page.locator('#manage-booking-status').getAttribute('role'), 'status', 'reschedule success must be a status live region');

      await page.locator('#maction').focus();
      await page.keyboard.press('End');
      assert.equal(await page.locator('#maction').inputValue(), 'cancel', 'keyboard selection must reach the cancel option');
      await pressButton(page, '#manage-booking-form [type="submit"]');
      await page.waitForFunction(() => /has been cancelled/i.test(document.getElementById('manage-booking-status')?.textContent || ''));
      assert.equal(calls.actions[1]?.action, 'cancel');
      assert.equal(await page.locator('#manage-booking-status').getAttribute('role'), 'status', 'cancellation success must be a status live region');
    })
  },
  {
    name: 'critical journeys reflow without page-level horizontal scrolling at the 200% proxy',
    run: async (browser, base) => withContext(browser, { viewport: { width: 640, height: 720 } }, async (context) => {
      const page = await context.newPage();
      for (const pageName of ['index.html', 'book.html', 'manage-booking.html']) {
        const suffix = pageName === 'manage-booking.html' ? `#token=${managementToken}` : '';
        await page.goto(`${base}/${pageName}${suffix}`, { waitUntil: 'domcontentloaded' });
        if (pageName === 'book.html') await waitForReadyForm(page, '#book-form');
        if (pageName === 'manage-booking.html') await waitForReadyForm(page, '#manage-booking-form');
        const dimensions = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
        }));
        assert.ok(
          dimensions.content <= dimensions.viewport + 1,
          `${pageName} has ${dimensions.content - dimensions.viewport}px page-level horizontal overflow at a 640 CSS-pixel viewport (1280px at the 200% reflow proxy)`
        );
      }
    })
  },
  {
    name: 'reduced-motion preference suppresses autonomous and scripted smooth motion',
    run: async (browser, base) => withContext(browser, { reducedMotion: 'reduce', observeMotion: true }, async (context) => {
      const page = await context.newPage();
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);

      const motion = await page.evaluate(() => {
        const reveal = document.querySelector('.reveal');
        const visual = document.querySelector('.hero-visual');
        const revealStyle = reveal && getComputedStyle(reveal);
        const scanStyle = visual && getComputedStyle(visual, '::after');
        return {
          revealOpacity: revealStyle?.opacity,
          revealTransform: revealStyle?.transform,
          revealTransitionSeconds: (revealStyle?.transitionDuration || '').split(',').map((value) => parseFloat(value) || 0),
          scanDisplay: scanStyle?.display,
          scanAnimation: scanStyle?.animationName,
          intervals: window.__a11yMotion.intervals
        };
      });
      assert.equal(motion.revealOpacity, '1', 'reduced motion must not leave reveal content transparent');
      assert.equal(motion.revealTransform, 'none', 'reduced motion must not translate reveal content');
      assert.ok(motion.revealTransitionSeconds.every((seconds) => seconds <= 0.001), 'reduced-motion reveal transitions must be effectively disabled');
      assert.ok(motion.scanDisplay === 'none' || motion.scanAnimation === 'none', 'the decorative scan animation must be disabled');
      assert.equal(motion.intervals.includes(5500), false, 'the autonomous hero carousel must not start its 5.5-second timer');

      await page.goto(`${base}/book.html`, { waitUntil: 'domcontentloaded' });
      await waitForReadyForm(page, '#book-form');
      await page.locator('#bservice').selectOption(requestService.id);
      await pressButton(page, '[data-book-next="2"]');
      await waitForStep(page, 2);
      const stepScroll = await page.evaluate(() => window.__a11yMotion.scrollTo.at(-1));
      assert.notEqual(stepScroll?.[0]?.behavior, 'smooth', 'booking-step focus must not request smooth scrolling when reduced motion is active');

      await page.goto(`${base}/manage-booking.html#token=${managementToken}`, { waitUntil: 'domcontentloaded' });
      await waitForReadyForm(page, '#manage-booking-form');
      await page.locator('#mdate').fill(futureDate(28));
      await pressButton(page, '#manage-booking-form [type="submit"]');
      await page.locator('#manage-booking-status:not([hidden])').waitFor();
      const statusScroll = await page.evaluate(() => window.__a11yMotion.scrollIntoView.at(-1));
      assert.notEqual(statusScroll?.behavior, 'smooth', 'dynamic form status must not request smooth scrolling when reduced motion is active');
    })
  },
  {
    name: 'critical pages expose named controls and coherent document semantics',
    run: async (browser, base) => withContext(browser, {}, async (context) => {
      const page = await context.newPage();
      for (const pageName of ['index.html', 'book.html', 'manage-booking.html']) {
        const suffix = pageName === 'manage-booking.html' ? `#token=${managementToken}` : '';
        await page.goto(`${base}/${pageName}${suffix}`, { waitUntil: 'domcontentloaded' });
        if (pageName === 'book.html') await waitForReadyForm(page, '#book-form');
        if (pageName === 'manage-booking.html') await waitForReadyForm(page, '#manage-booking-form');
        await semanticScan(context, page, pageName);
      }
    })
  }
];

const failures = [];
const port = await listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

try {
  for (const test of tests) {
    try {
      await test.run(browser, base);
      console.log(`✓ ${test.name}`);
    } catch (error) {
      failures.push({ name: test.name, error });
      console.error(`✗ ${test.name}`);
      console.error(`  ${String(error.message || error).replace(/\n/g, '\n  ')}`);
    }
  }
} finally {
  await browser.close();
  await closeServer();
}

if (failures.length) {
  const details = failures.map(({ name, error }) => `- ${name}: ${error.message || error}`).join('\n');
  assert.fail(`${failures.length} accessibility journey test${failures.length === 1 ? '' : 's'} failed:\n${details}`);
}

console.log(`Accessibility journey passed ${tests.length} bounded scenarios.`);
