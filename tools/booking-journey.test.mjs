import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './load-playwright.mjs';

const { chromium } = loadPlaywright();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPattern = '**/functions/v1/insurespr-api/**';
const approvedPrivacyVersion = '2026-08-13';
const appointmentService = {
  id: '11111111-1111-4111-8111-111111111111',
  category_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'dxa-body-composition',
  name: 'DXA Body Composition Scan',
  short_description: 'A focused body-composition scan.',
  audience: 'scanning',
  booking_mode: 'appointment',
  confirmation_mode: 'staff',
  appointment_duration_minutes: 30,
  price_type: 'unpublished',
  cash_price_cents: null,
  cash_price_max_cents: null,
  currency: 'ZAR',
  price_note: null,
  medical_aid_status: 'needs_confirmation',
  referral_requirement: 'Email the practice if you are unsure.',
  appointment_requirement: 'An appointment is required.',
  what_to_bring: null,
  expected_duration: null,
  results_process: null,
  preparation_instructions: null,
  verification_status: 'verified',
  display_order: 1
};
const requestService = {
  ...appointmentService,
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'primary-healthcare-x-ray',
  name: 'Primary Healthcare X-Ray',
  audience: 'individual',
  booking_mode: 'request',
  appointment_duration_minutes: null,
  appointment_requirement: 'Submit a preferred time and staff will confirm.',
  display_order: 2
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
    public_email: 'motselisi@bonevc.co.za',
    timezone: 'Africa/Johannesburg',
    opening_hours: { monday: ['08:00', '17:00'] },
    maps_url: 'https://maps.google.com/?q=7+Malibongwe+Drive+EmedCentre+Randburg',
    privacy_notice_version: approvedPrivacyVersion
  },
  categories: [],
  services: [appointmentService, requestService],
  intake_ready: true,
  turnstile_site_key: '1x00000000000000000000AA'
};
const managementToken = 'a'.repeat(64);
const patient = {
  firstName: 'Journey',
  surname: 'Tester',
  mobile: '083 111 2233',
  email: 'journey@example.test',
  notes: 'Wheelchair access, please.'
};

function futureDate(days = 21) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function slotFor(date, suffix, hour = 8) {
  const hourText = String(hour).padStart(2, '0');
  return {
    slot_id: `${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}-${suffix}${suffix}${suffix}${suffix}-4${suffix}${suffix}${suffix}-8${suffix}${suffix}${suffix}-${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}`,
    service_id: appointmentService.id,
    starts_at: `${date}T${hourText}:00:00+02:00`,
    ends_at: `${date}T${hourText}:30:00+02:00`
  };
}

function bookingFor({
  reference = 'ISR-TEST-0001',
  status = 'confirmed',
  date,
  slot = null,
  service = appointmentService,
  token = managementToken,
  preferredTime = 'morning'
}) {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    reference,
    service_id: service.id,
    service_name: service.name,
    status,
    slot_id: slot?.slot_id || null,
    slot_start: slot?.starts_at || null,
    slot_end: slot?.ends_at || null,
    preferred_date: date,
    preferred_time_period: preferredTime,
    management_token: token
  };
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

const nativeSubmissions = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/form-unavailable') {
    let body = '';
    for await (const chunk of request) body += chunk;
    nativeSubmissions.push({ method: request.method, url: request.url, body });
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
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fulfillApi(route, result, defaultStatus = 200) {
  const response = result || {};
  if (response.delayMs) await delay(response.delayMs);
  if (response.abort) {
    await route.abort(response.abort === true ? 'failed' : response.abort);
    return;
  }
  const status = response.status ?? defaultStatus;
  if (status === 204) {
    await route.fulfill({ status, body: '' });
    return;
  }
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {})
  });
}

async function installTurnstile(context, { autoComplete = true } = {}) {
  const script = `
    (function () {
      var widgets = new Map();
      var nextWidget = 0;
      var nextToken = 0;
      var autoComplete = ${autoComplete ? 'true' : 'false'};
      function complete(options) {
        if (!autoComplete || !options || typeof options.callback !== 'function') return;
        setTimeout(function () {
          nextToken += 1;
          options.callback('test-turnstile-token-' + nextToken);
        }, 0);
      }
      window.turnstile = {
        render: function (_mount, options) {
          nextWidget += 1;
          widgets.set(nextWidget, options);
          complete(options);
          return nextWidget;
        },
        reset: function (widgetId) { complete(widgets.get(widgetId)); },
        remove: function (widgetId) { widgets.delete(widgetId); }
      };
    })();
  `;
  await context.route('https://challenges.cloudflare.com/turnstile/**', (route) => {
    return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: script });
  });
}

async function installApi(context, options = {}) {
  const calls = {
    services: [],
    availability: [],
    bookings: [],
    actions: [],
    events: []
  };
  let availabilityNumber = 0;
  let bookingNumber = 0;
  let actionNumber = 0;

  await context.route(apiPattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const routePath = url.pathname.split('/insurespr-api')[1] || '/';

    if (request.method() === 'GET' && routePath === '/services') {
      calls.services.push({ url: url.toString() });
      await fulfillApi(route, { status: 200, body: options.config || approvedConfig });
      return;
    }

    if (request.method() === 'GET' && routePath === '/availability') {
      availabilityNumber += 1;
      const call = {
        number: availabilityNumber,
        serviceId: url.searchParams.get('service_id'),
        from: url.searchParams.get('from'),
        until: url.searchParams.get('until')
      };
      calls.availability.push(call);
      const result = typeof options.availability === 'function'
        ? await options.availability(call)
        : { status: 200, body: { slots: options.slots || [] } };
      await fulfillApi(route, result);
      return;
    }

    if (request.method() === 'POST' && routePath === '/bookings') {
      bookingNumber += 1;
      const payload = request.postDataJSON();
      const call = { number: bookingNumber, payload };
      calls.bookings.push(call);
      const result = typeof options.booking === 'function'
        ? await options.booking(call)
        : { status: 201, body: { booking: bookingFor({ date: payload.preferred_date }) } };
      await fulfillApi(route, result, 201);
      return;
    }

    if (request.method() === 'POST' && routePath === '/booking-actions') {
      actionNumber += 1;
      const payload = request.postDataJSON();
      const call = { number: actionNumber, payload };
      calls.actions.push(call);
      const result = typeof options.action === 'function'
        ? await options.action(call)
        : { status: 200, body: { booking: { reference: 'ISR-MANAGE-0001', status: 'reschedule_requested' } } };
      await fulfillApi(route, result);
      return;
    }

    if (request.method() === 'POST' && routePath === '/events') {
      const payload = request.postDataJSON();
      calls.events.push({ payload });
      await fulfillApi(route, { status: 204 });
      return;
    }

    await fulfillApi(route, {
      status: 400,
      body: { error: { code: 'UNEXPECTED_TEST_REQUEST', message: `Unexpected ${request.method()} ${routePath}` } }
    });
  });

  return calls;
}

async function withContext(browser, options, callback) {
  // Keep functional journey assertions deterministic. The production UI still
  // exercises smooth motion in its dedicated motion/accessibility coverage;
  // this suite should not race Chromium's animated focus scrolling between
  // validation attempts.
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await context.route('https://fonts.googleapis.com/**', (route) => {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
    });
    await context.route('https://fonts.gstatic.com/**', (route) => route.abort('blockedbyclient'));
    if (options?.initScript) await context.addInitScript({ content: options.initScript });
    await installTurnstile(context, options?.turnstile);
    const calls = await installApi(context, options?.api);
    return await callback(context, calls);
  } finally {
    await context.close();
  }
}

async function openBooking(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}/book.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#book-form[data-ready="true"]').waitFor();
  return page;
}

async function waitForTurnstile(page) {
  await page.waitForFunction(() => {
    const field = document.querySelector('#book-form [name="turnstile_token"]');
    return Boolean(field && field.value);
  });
}

async function waitForStep(page, step) {
  await page.waitForFunction((expected) => {
    const active = document.querySelector('.booking-step:not([hidden])');
    return Number(active?.getAttribute('data-book-step')) === expected;
  }, step);
  assert.equal(
    Number(await page.locator('.booking-step:not([hidden])').getAttribute('data-book-step')),
    step,
    `booking step ${step} should be visible`
  );
}

async function selectServiceAndDate(page, { date, service = appointmentService, slot = null, expectNoSlots = false }) {
  await page.locator('#bservice').selectOption(service.id);
  await page.locator('[data-book-next="2"]').click();
  await waitForStep(page, 2);
  await page.locator('#bdate').fill(date);

  if (slot) {
    await page.locator(`input[name="slot_id"][value="${slot.slot_id}"]`).waitFor({ state: 'attached' });
  } else if (expectNoSlots || service.booking_mode !== 'appointment') {
    await page.waitForFunction(() => /No live slots have been published/i.test(document.getElementById('slot-note')?.textContent || ''));
  }

  await page.locator('[data-book-next="3"]').click();
  await waitForStep(page, 3);
}

async function fillDetails(page, { slot = null, preferredTime = 'morning', values = patient } = {}) {
  if (slot) await page.locator(`input[name="slot_id"][value="${slot.slot_id}"]`).check();
  else await page.locator('#bperiod').selectOption(preferredTime);
  await page.locator('[data-book-next="4"]').click();
  await waitForStep(page, 4);
  await page.locator('#bfirst').fill(values.firstName);
  await page.locator('#bsurname').fill(values.surname);
  await page.locator('#bphone').fill(values.mobile);
  await page.locator('#bemail').fill(values.email);
  await page.locator('#bstatus').selectOption('new');
  await page.locator('#bnotes').fill(values.notes);
  await page.locator('#bprivacy').check();
}

async function reviewBooking(page) {
  await page.locator('[data-book-next="5"]').click();
  await waitForStep(page, 5);
  assert.equal(await page.locator('[data-review-service]').textContent(), appointmentService.name);
  assert.equal(await page.locator('[data-review-patient]').textContent(), `${patient.firstName} ${patient.surname} · New patient`);
  assert.equal(await page.locator('[data-review-contact]').textContent(), `${patient.mobile} · ${patient.email}`);
}

async function waitForBookStatus(page, expected) {
  const status = page.locator('#book-status:not([hidden])');
  await status.waitFor();
  assert.match((await status.textContent()) || '', expected);
  return status;
}

function assertNoPiiInUrl(page) {
  const url = decodeURIComponent(page.url()).toLowerCase();
  for (const forbidden of [patient.firstName, patient.surname, patient.mobile, patient.email, patient.notes]) {
    assert.equal(url.includes(forbidden.toLowerCase()), false, `URL must not contain ${forbidden}`);
  }
}

async function testCompleteJourneyHistoryIdempotencyAndRefresh(browser, base) {
  const date = futureDate(18);
  const slot = slotFor(date, '1', 9);
  const responseBooking = bookingFor({ reference: 'ISR-JOURNEY-0001', date, slot });

  await withContext(browser, {
    api: {
      slots: [slot],
      booking: async () => ({ delayMs: 120, status: 201, body: { booking: responseBooking } })
    }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);
    assert.deepEqual(
      await page.locator('#bservice optgroup').evaluateAll((groups) => groups.map((group) => group.label)),
      ['X-Ray examinations', 'DXA scans & bone services'],
      'the generic selector must distinguish examinations from DXA services'
    );
    await selectServiceAndDate(page, { date, slot });
    await fillDetails(page, { slot });
    await reviewBooking(page);
    assertNoPiiInUrl(page);

    await page.evaluate(() => history.back());
    await waitForStep(page, 4);
    assert.equal(await page.locator('#bemail').inputValue(), patient.email, 'Back must preserve entered details');
    await page.evaluate(() => history.back());
    await waitForStep(page, 3);
    assert.equal(await page.locator(`input[value="${slot.slot_id}"]`).isChecked(), true, 'Back must preserve the selected slot');
    await page.evaluate(() => history.forward());
    await waitForStep(page, 4);
    await page.evaluate(() => history.forward());
    await waitForStep(page, 5);
    assertNoPiiInUrl(page);

    const confirmation = page.waitForURL(`${base}/booking-confirmation.html`);
    await page.locator('#book-form [type="submit"]').evaluate((button) => {
      button.click();
      button.click();
    });
    await confirmation;

    assert.equal(calls.bookings.length, 1, 'a double click must create only one booking request');
    const payload = calls.bookings[0].payload;
    assert.match(payload.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(payload.slot_id, slot.slot_id);
    assert.equal(payload.service_id, appointmentService.id);
    assert.equal(payload.privacy_version, approvedPrivacyVersion);
    assert.equal(payload.privacy_accepted, true);
    assert.match(payload.turnstile_token, /^test-turnstile-token-/);
    assert.equal(payload.first_name, patient.firstName);
    assert.equal(payload.mobile, patient.mobile);

    assert.equal(page.url(), `${base}/booking-confirmation.html`);
    assertNoPiiInUrl(page);
    assert.equal(await page.locator('[data-booking-reference]').textContent(), responseBooking.reference);
    assert.equal(await page.locator('[data-booking-state]').textContent(), 'Confirmed');
    assert.equal(await page.locator('[data-booking-service]').textContent(), appointmentService.name);
    const manageHref = await page.locator('[data-manage-booking]').getAttribute('href');
    assert.equal(manageHref, `manage-booking.html#token=${managementToken}`);
    assert.equal(manageHref.includes('?token='), false, 'management credentials must never use a query string');

    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('[data-booking-reference]').textContent(), responseBooking.reference, 'confirmation must survive refresh');
    assert.equal(await page.locator('[data-booking-state]').textContent(), 'Confirmed');
    assert.equal(await page.locator('[data-manage-booking]').getAttribute('href'), `manage-booking.html#token=${managementToken}`);
    assertNoPiiInUrl(page);
  });
}

async function testValidationAndInvalidPhone(browser, base) {
  const date = futureDate(19);
  const slot = slotFor(date, '2', 10);

  await withContext(browser, {
    api: {
      slots: [slot],
      booking: async ({ payload }) => {
        if (payload.mobile === 'not-a-phone') {
          return {
            status: 422,
            body: { error: { code: 'VALIDATION_ERROR', message: 'Enter a valid South African mobile number.' } }
          };
        }
        return {
          status: 201,
          body: { booking: bookingFor({ reference: 'ISR-VALID-0001', date, slot }) }
        };
      }
    }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);

    await page.locator('[data-book-next="2"]').click();
    await waitForStep(page, 1);
    assert.notEqual(await page.locator('#bservice').evaluate((field) => field.validationMessage), '');

    await page.locator('#bservice').selectOption(appointmentService.id);
    await page.locator('[data-book-next="2"]').click();
    await waitForStep(page, 2);
    await page.locator('[data-book-next="3"]').click();
    await waitForStep(page, 2);
    assert.notEqual(await page.locator('#bdate').evaluate((field) => field.validationMessage), '');

    await page.locator('#bdate').fill(date);
    await page.locator(`input[value="${slot.slot_id}"]`).waitFor({ state: 'attached' });
    await page.locator('[data-book-next="3"]').click();
    await waitForStep(page, 3);
    await page.locator('[data-book-next="4"]').click();
    await waitForStep(page, 3);
    assert.notEqual(await page.locator(`input[value="${slot.slot_id}"]`).evaluate((field) => field.validationMessage), '');

    await page.locator(`input[value="${slot.slot_id}"]`).check();
    await page.locator('[data-book-next="4"]').click();
    await waitForStep(page, 4);
    await page.locator('#bfirst').fill(patient.firstName);
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 4);
    assert.notEqual(await page.locator('#bsurname').evaluate((field) => field.validationMessage), '');

    await page.locator('#bsurname').fill(patient.surname);
    await page.locator('#bphone').fill('not-a-phone');
    await page.locator('#bemail').fill('invalid-email');
    await page.locator('#bstatus').selectOption('new');
    await page.locator('#bprivacy').check();
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 4);
    assert.notEqual(await page.locator('#bemail').evaluate((field) => field.validationMessage), '');

    await page.locator('#bemail').fill(patient.email);
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 5);
    await page.locator('#book-form [type="submit"]').click();
    await waitForBookStatus(page, /Enter a valid South African mobile number/i);
    assert.equal(calls.bookings.length, 1);
    assert.equal(calls.bookings[0].payload.mobile, 'not-a-phone');
    const idempotencyKey = calls.bookings[0].payload.idempotency_key;
    await waitForTurnstile(page);

    await page.locator('[data-book-back="4"]').click();
    await waitForStep(page, 4);
    await page.locator('#bphone').fill(patient.mobile);
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 5);
    const confirmation = page.waitForURL(`${base}/booking-confirmation.html`);
    await page.locator('#book-form [type="submit"]').click();
    await confirmation;
    assert.equal(calls.bookings.length, 2);
    assert.equal(calls.bookings[1].payload.idempotency_key, idempotencyKey, 'validation retry must retain its idempotency key');
  });
}

async function testSlotRaceRefreshAndRetry(browser, base) {
  const date = futureDate(20);
  const firstSlot = slotFor(date, '3', 8);
  const replacementSlot = slotFor(date, '4', 11);

  await withContext(browser, {
    api: {
      availability: async ({ number }) => ({
        status: 200,
        body: { slots: number === 1 ? [firstSlot] : [replacementSlot] }
      }),
      booking: async ({ number, payload }) => {
        if (number === 1) {
          return {
            status: 409,
            body: {
              error: {
                code: 'SLOT_UNAVAILABLE',
                message: 'That appointment time is no longer available. Choose another time.'
              }
            }
          };
        }
        return {
          status: 201,
          body: {
            booking: bookingFor({
              reference: 'ISR-RACE-0001',
              status: 'pending',
              date,
              slot: replacementSlot,
              preferredTime: payload.preferred_time_period
            })
          }
        };
      }
    }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);
    await selectServiceAndDate(page, { date, slot: firstSlot });
    await fillDetails(page, { slot: firstSlot });
    await reviewBooking(page);
    await page.locator('#book-form [type="submit"]').click();
    await waitForBookStatus(page, /no longer available/i);
    await page.locator(`input[value="${replacementSlot.slot_id}"]`).waitFor({ state: 'attached' });

    assert.equal(calls.availability.length, 2, 'slot conflict must refresh availability');
    assert.equal(await page.locator('#bfirst').inputValue(), patient.firstName);
    assert.equal(await page.locator('#bsurname').inputValue(), patient.surname);
    assert.equal(await page.locator('#bphone').inputValue(), patient.mobile);
    assert.equal(await page.locator('#bemail').inputValue(), patient.email);
    assert.equal(await page.locator('#bprivacy').isChecked(), true);
    const idempotencyKey = calls.bookings[0].payload.idempotency_key;
    await waitForTurnstile(page);

    await page.locator('[data-book-back="4"]').click();
    await waitForStep(page, 4);
    await page.locator('[data-book-back="3"]').click();
    await waitForStep(page, 3);
    await page.locator(`input[value="${replacementSlot.slot_id}"]`).check();
    await page.locator('[data-book-next="4"]').click();
    await waitForStep(page, 4);
    assert.equal(await page.locator('#bemail').inputValue(), patient.email, 'slot refresh must preserve form data');
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 5);
    const confirmation = page.waitForURL(`${base}/booking-confirmation.html`);
    await page.locator('#book-form [type="submit"]').click();
    await confirmation;

    assert.equal(calls.bookings.length, 2);
    assert.equal(calls.bookings[0].payload.slot_id, firstSlot.slot_id);
    assert.equal(calls.bookings[1].payload.slot_id, replacementSlot.slot_id);
    assert.equal(calls.bookings[1].payload.idempotency_key, idempotencyKey, 'slot-race retry must retain its idempotency key');
  });
}

async function testApiDatabaseAndNetworkRetries(browser, base) {
  const date = futureDate(22);
  const slot = slotFor(date, '5', 12);
  const failures = [
    {
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } }
    },
    {
      status: 503,
      body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'The booking service is temporarily unavailable.' } }
    },
    { abort: 'failed' }
  ];

  await withContext(browser, {
    api: {
      slots: [slot],
      booking: async ({ number }) => failures[number - 1] || {
        status: 201,
        body: { booking: bookingFor({ reference: 'ISR-RETRY-0001', date, slot }) }
      }
    }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);
    await selectServiceAndDate(page, { date, slot });
    await fillDetails(page, { slot });
    await reviewBooking(page);

    const expectations = [
      /Something went wrong\. Please try again/i,
      /booking service is temporarily unavailable/i,
      /could not connect right now/i
    ];
    for (const expected of expectations) {
      await page.locator('#book-form [type="submit"]').click();
      await waitForBookStatus(page, expected);
      assert.equal(await page.locator('#bemail').inputValue(), patient.email);
      assert.equal(await page.locator('#bprivacy').isChecked(), true);
      await waitForTurnstile(page);
    }

    assert.equal(calls.bookings.length, 3);
    const key = calls.bookings[0].payload.idempotency_key;
    assert.ok(calls.bookings.every((call) => call.payload.idempotency_key === key), 'all failed attempts must retain one idempotency key');

    const confirmation = page.waitForURL(`${base}/booking-confirmation.html`);
    await page.locator('#book-form [type="submit"]').click();
    await confirmation;
    assert.equal(calls.bookings.length, 4);
    assert.ok(calls.bookings.every((call) => call.payload.idempotency_key === key), 'successful retry must reuse the original idempotency key');
  });
}

async function testNoSlotPreferredTimeFallback(browser, base) {
  const date = futureDate(23);

  await withContext(browser, {
    api: {
      slots: [],
      booking: async ({ payload }) => ({
        status: 201,
        body: {
          booking: bookingFor({
            reference: 'ISR-PREFERRED-0001',
            status: 'pending',
            date,
            service: appointmentService,
            token: managementToken,
            preferredTime: payload.preferred_time_period
          })
        }
      })
    }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);
    await selectServiceAndDate(page, { date, expectNoSlots: true });
    assert.equal(await page.locator('#slot-field').isHidden(), true);
    assert.equal(await page.locator('#preferred-period-field').isVisible(), true);
    assert.match(await page.locator('#slot-note').textContent(), /Submit a preferred time and the practice will confirm availability/i);
    await fillDetails(page, { preferredTime: 'afternoon' });
    await reviewBooking(page);
    const confirmation = page.waitForURL(`${base}/booking-confirmation.html`);
    await page.locator('#book-form [type="submit"]').click();
    await confirmation;

    assert.equal(calls.bookings.length, 1);
    assert.equal(calls.bookings[0].payload.slot_id, null);
    assert.equal(calls.bookings[0].payload.preferred_time_period, 'afternoon');
    assert.equal(await page.locator('[data-booking-state]').textContent(), 'Request received — awaiting staff confirmation');
  });
}

async function testCancellationAndRescheduleWording(browser, base) {
  const date = futureDate(26);
  await withContext(browser, {
    api: {
      action: async ({ payload }) => ({
        status: 200,
        body: {
          booking: {
            reference: 'ISR-MANAGE-0001',
            status: payload.action === 'cancel' ? 'cancelled' : 'reschedule_requested'
          }
        }
      })
    }
  }, async (context, calls) => {
    const page = await context.newPage();
    await page.goto(`${base}/manage-booking.html#token=${managementToken}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#manage-booking-form[data-ready="true"]').waitFor();
    assert.equal(page.url(), `${base}/manage-booking.html`, 'management token must be removed from the visible URL immediately');
    assert.equal(await page.locator('[name="token"]').inputValue(), managementToken);

    await page.locator('#maction').selectOption('request_reschedule');
    await page.locator('#mdate').fill(date);
    await page.locator('#mperiod').selectOption('morning');
    await page.locator('#mnote').fill('A later appointment would help.');
    await page.locator('#manage-booking-form [type="submit"]').click();
    await page.locator('#manage-booking-status:not([hidden])').waitFor();
    assert.equal(
      await page.locator('#manage-booking-status').textContent(),
      'Your reschedule request has been recorded. It is not a new confirmed time yet. Reference: ISR-MANAGE-0001.'
    );
    assert.deepEqual(calls.actions[0].payload, {
      token: managementToken,
      action: 'request_reschedule',
      preferred_date: date,
      preferred_time_period: 'morning',
      note: 'A later appointment would help.',
      website: ''
    });

    await page.locator('#maction').selectOption('cancel');
    await page.locator('#manage-booking-form [type="submit"]').click();
    await page.waitForFunction(() => /cancelled/i.test(document.getElementById('manage-booking-status')?.textContent || ''));
    assert.equal(
      await page.locator('#manage-booking-status').textContent(),
      'The booking has been cancelled. Reference: ISR-MANAGE-0001.'
    );
    assert.equal(calls.actions[1].payload.action, 'cancel');
    assert.equal(calls.actions[1].payload.token, managementToken);
  });
}

async function testTurnstileAndHoneypotBotFailures(browser, base) {
  const date = futureDate(27);

  await withContext(browser, {
    turnstile: { autoComplete: false },
    api: { slots: [] }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await selectServiceAndDate(page, { date, service: requestService, expectNoSlots: true });
    await fillDetails(page, { preferredTime: 'any' });
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 5);
    await page.locator('#book-form [type="submit"]').click();
    await waitForBookStatus(page, /Please complete the anti-spam check before sending/i);
    assert.equal(calls.bookings.length, 0, 'a missing Turnstile token must block the request in the browser');
    assert.equal(page.url(), `${base}/book.html`);
  });

  await withContext(browser, {
    api: {
      slots: [],
      booking: async ({ payload }) => payload.website
        ? {
            status: 422,
            body: { error: { code: 'VALIDATION_ERROR', message: 'The submitted form could not be accepted.' } }
          }
        : { status: 500, body: { error: { code: 'TEST_ERROR', message: 'The honeypot was not sent.' } } }
    }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);
    await selectServiceAndDate(page, { date, service: requestService, expectNoSlots: true });
    await fillDetails(page, { preferredTime: 'any' });
    await page.locator('#bwebsite').evaluate((field) => { field.value = 'https://spam.invalid'; });
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 5);
    await page.locator('#book-form [type="submit"]').click();
    await waitForBookStatus(page, /submitted form could not be accepted/i);
    assert.equal(calls.bookings.length, 1);
    assert.equal(calls.bookings[0].payload.website, 'https://spam.invalid');
    assert.equal(page.url(), `${base}/book.html`, 'bot rejection must not reach confirmation');
  });
}

async function testStructuredWhatsAppContinuation(browser, base) {
  const date = futureDate(28);
  const reference = 'ISR-WHATSAPP-0001';
  await withContext(browser, {
    initScript: `
      window.__openedUrls = [];
      window.__copiedText = '';
      window.open = function (url) { window.__openedUrls.push(url); return {}; };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async function (text) { window.__copiedText = text; } }
      });
    `,
    api: {
      slots: [],
      booking: async ({ payload }) => ({
        status: 201,
        body: {
          booking: bookingFor({
            reference,
            status: 'pending',
            date,
            service: requestService,
            preferredTime: payload.preferred_time_period
          })
        }
      })
    }
  }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);
    await selectServiceAndDate(page, { date, service: requestService, expectNoSlots: true });
    await fillDetails(page, { preferredTime: 'morning' });
    await page.locator('[data-book-next="5"]').click();
    await waitForStep(page, 5);
    await page.locator('#booking-whatsapp').click();
    await page.waitForURL(`${base}/booking-confirmation.html`);

    assert.equal(calls.bookings.length, 1);
    const continuation = page.locator('[data-whatsapp-continuation]');
    await continuation.waitFor({ state: 'visible' });
    const message = await page.locator('[data-whatsapp-message]').inputValue();
    assert.match(message, new RegExp(`Reference: ${reference}`));
    assert.match(message, new RegExp(`Name: ${patient.firstName} ${patient.surname}`));
    assert.match(message, new RegExp(`Service: ${requestService.name}`));
    assert.match(message, /Preferred date:/);
    assert.match(message, /Preferred time: Morning/);
    assert.match(message, /Patient: New patient/);
    assert.match(message, /Please confirm availability\./);
    for (const forbidden of [patient.mobile, patient.email, patient.notes]) {
      assert.equal(message.toLowerCase().includes(forbidden.toLowerCase()), false, 'WhatsApp scheduling message must exclude contact details and notes');
    }
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem('insurespr.whatsappContinuation')),
      null,
      'one-time scheduling draft must be removed immediately after confirmation renders'
    );

    await page.locator('[data-copy-open-whatsapp]').click();
    await page.waitForFunction(() => window.__copiedText && window.__openedUrls.length === 1);
    const handoff = await page.evaluate(() => ({ copied: window.__copiedText, opened: window.__openedUrls[0] }));
    assert.equal(handoff.copied, message);
    assert.equal(handoff.opened, 'https://wa.me/27834507861');
    const whatsappUrl = new URL(handoff.opened);
    assert.equal(whatsappUrl.search, '', 'WhatsApp URL must not contain booking or patient data');
    assert.equal(whatsappUrl.hash, '', 'WhatsApp URL must not contain booking or patient data');
    for (const forbidden of [reference, patient.firstName, patient.surname, patient.mobile, patient.email, requestService.name]) {
      assert.equal(handoff.opened.toLowerCase().includes(forbidden.toLowerCase()), false, 'WhatsApp URL must contain no booking or patient information');
    }
    assert.match(await page.locator('[data-whatsapp-status]').textContent(), /Message copied/);

    await page.reload();
    assert.equal(await page.locator('[data-whatsapp-continuation]').isHidden(), true, 'one-time WhatsApp continuation must not reappear after refresh');
  });
}

async function testAbandonmentEventContainsNoPii(browser, base) {
  const date = futureDate(29);
  const slot = slotFor(date, '6', 14);
  await withContext(browser, { api: { slots: [slot] } }, async (context, calls) => {
    const page = await openBooking(context, base);
    await waitForTurnstile(page);
    await selectServiceAndDate(page, { date, slot });
    await fillDetails(page, { slot });
    for (let attempt = 0; attempt < 20 && !calls.events.some((call) => call.payload.event_name === 'booking_started'); attempt += 1) {
      await delay(25);
    }
    assert.ok(calls.events.some((call) => call.payload.event_name === 'booking_started'), 'the journey must be marked as started before abandonment');
    // Dispatch the lifecycle event while the page is still alive. Playwright's
    // route interception can cancel a keepalive request at the exact instant a
    // frame is destroyed, whereas browsers deliver this same pagehide event.
    await page.evaluate(() => {
      window.dispatchEvent(typeof PageTransitionEvent === 'function'
        ? new PageTransitionEvent('pagehide', { persisted: false })
        : new Event('pagehide'));
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete');
    for (let attempt = 0; attempt < 20 && !calls.events.some((call) => call.payload.event_name === 'booking_abandoned'); attempt += 1) {
      await delay(25);
    }
    const abandoned = calls.events.filter((call) => call.payload.event_name === 'booking_abandoned');
    assert.ok(abandoned.length >= 1, 'leaving a started booking must emit booking_abandoned');
    for (const event of abandoned) {
      assert.equal(event.payload.service_id, appointmentService.id);
      const eventJson = JSON.stringify(event.payload).toLowerCase();
      for (const forbidden of [patient.firstName, patient.surname, patient.mobile, patient.email, patient.notes]) {
        assert.equal(eventJson.includes(forbidden.toLowerCase()), false, 'abandonment analytics must not contain intake PII');
      }
    }
  });
}

async function testPartialJavaScriptFailureFailsClosed(browser, base) {
  const context = await browser.newContext();
  try {
    await context.route('**/production.js*', (route) => route.abort('blockedbyclient'));
    const page = await context.newPage();
    const before = nativeSubmissions.length;
    await page.goto(`${base}/book.html`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#book-form [data-form-gate]').evaluate((gate) => gate.disabled), true);
    assert.equal(await page.locator('#book-form').getAttribute('method'), 'post');
    assert.equal(await page.locator('#book-form').getAttribute('action'), '/form-unavailable');
    await Promise.all([
      page.waitForURL(`${base}/form-unavailable`),
      page.locator('#book-form').evaluate((form) => {
        form.querySelector('[name="first_name"]').value = 'pii-sentinel';
        form.querySelector('[name="email"]').value = 'pii-sentinel@example.test';
        form.submit();
      })
    ]);
    assert.equal(nativeSubmissions.length, before + 1);
    const submission = nativeSubmissions.at(-1);
    assert.equal(submission.method, 'POST');
    assert.equal(submission.url, '/form-unavailable');
    assert.equal(submission.body.includes('pii-sentinel'), false, 'disabled form controls must not serialize PII when JavaScript fails');
    assert.equal(page.url(), `${base}/form-unavailable`);
  } finally {
    await context.close();
  }
}

const port = await listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const tests = [
  ['complete journey, History API, duplicate submit, confirmation refresh and fragment token', testCompleteJourneyHistoryIdempotencyAndRefresh],
  ['required fields, invalid email and invalid phone recovery', testValidationAndInvalidPhone],
  ['slot race, refreshed availability, preserved form data and stable retry key', testSlotRaceRefreshAndRetry],
  ['API, database and network failures remain visible and retryable', testApiDatabaseAndNetworkRetries],
  ['no-slot preferred-time fallback', testNoSlotPreferredTimeFallback],
  ['cancellation and reschedule wording', testCancellationAndRescheduleWording],
  ['Turnstile and honeypot bot failures', testTurnstileAndHoneypotBotFailures],
  ['structured WhatsApp continuation keeps booking data out of URLs', testStructuredWhatsAppContinuation],
  ['abandonment analytics contains no PII', testAbandonmentEventContainsNoPii],
  ['partial JavaScript failure fails closed', testPartialJavaScriptFailureFailsClosed]
];
const failures = [];

try {
  for (const [name, test] of tests) {
    try {
      await test(browser, base);
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL ${name}`);
      console.error(error?.stack || error);
    }
  }
} finally {
  await browser.close();
  await closeServer();
}

if (failures.length) {
  throw new AggregateError(
    failures.map(({ error }) => error),
    `${failures.length} booking journey test${failures.length === 1 ? '' : 's'} failed: ${failures.map(({ name }) => name).join('; ')}`
  );
}

console.log(`Booking journey tests passed (${tests.length} scenarios).`);
