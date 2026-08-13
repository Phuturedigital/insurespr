import {
  type ClaimedNotification,
  processClaimsInEntityOrder,
  readinessResponse,
  renderEmail,
  timingSafeEqual,
} from './index.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function baseClaim(
  kind: ClaimedNotification['notification_kind'],
): ClaimedNotification {
  return {
    attempt_id: '5e344784-fcca-4d67-b8e7-7581cfeb3861',
    entity_type: 'booking',
    entity_id: '122a93f6-18d7-4621-b6ac-662b56e612b8',
    notification_kind: kind,
    recipient: 'test@example.invalid',
    attempt_count: 1,
    payload: {
      practice: {
        name: 'InsureSPR',
        address: '16 Baker Street, Rosebank, Gauteng',
        phone: '+27 11 555 0100',
        email: 'practice@example.invalid',
        timezone: 'Africa/Johannesburg',
      },
      booking: {
        reference: 'SPR-TEST-001',
        first_name: 'Alex <script>alert(1)</script>',
        surname: 'Patient',
        email: 'test@example.invalid',
        mobile: '+27115550100',
        service_name: 'Primary Healthcare X-Ray',
        preferred_date: '2026-08-20',
        preferred_time_period: 'morning',
        slot_starts_at: null,
        status: 'pending',
        confirmation_mode: 'staff',
        created_at: '2026-08-12T12:00:00Z',
        notes: 'Sensitive free-text value must never enter an email.',
      },
    },
  };
}

function bookingTransitionClaim(
  kind: ClaimedNotification['notification_kind'],
  status: string,
  transitionSequence: number,
  attemptId: string,
): ClaimedNotification {
  const claim = baseClaim(kind);
  claim.attempt_id = attemptId;
  const payload = claim.payload as Record<string, unknown>;
  const booking = payload.booking as Record<string, unknown>;
  booking.status = status;
  payload._delivery = { transition_sequence: transitionSequence };
  return claim;
}

Deno.test('worker-secret comparison accepts only exact matches', () => {
  assert(
    timingSafeEqual('a'.repeat(32), 'a'.repeat(32)),
    'exact secret rejected',
  );
  assert(
    !timingSafeEqual('a'.repeat(32), 'b'.repeat(32)),
    'different secret accepted',
  );
  assert(
    !timingSafeEqual('a'.repeat(32), 'a'.repeat(31)),
    'short secret accepted',
  );
});

Deno.test('public readiness signal discloses only ready state and never invokes work', async () => {
  const ready = readinessResponse(true);
  assert(ready.status === 200, 'ready response must be HTTP 200');
  assert(ready.headers.get('cache-control') === 'no-store', 'readiness must never be cached');
  assert(ready.headers.get('x-insurespr-ready') === 'true', 'ready header must be explicit');
  assert(
    JSON.stringify(await ready.json()) === JSON.stringify({ ok: true, ready: true, readiness: 'ready' }),
    'ready body must contain only the public readiness state',
  );

  const notReady = readinessResponse(false);
  assert(notReady.status === 200, 'not-ready response must remain machine-readable');
  assert(notReady.headers.get('x-insurespr-ready') === 'false', 'not-ready header must be explicit');
  assert(
    JSON.stringify(await notReady.json()) ===
      JSON.stringify({ ok: true, ready: false, readiness: 'not_ready' }),
    'not-ready body must contain only the public readiness state',
  );
});

Deno.test('pending acknowledgement cannot imply a confirmed appointment', () => {
  const email = renderEmail(baseClaim('patient_booking_acknowledgement'));

  assert(
    email.text.includes('This is a request, not a confirmed appointment'),
    'pending request omitted confirmation warning',
  );
  assert(
    !email.text.includes('Sensitive free-text'),
    'booking notes leaked into text email',
  );
  assert(
    !email.html.includes('Sensitive free-text'),
    'booking notes leaked into HTML email',
  );
  assert(!email.html.includes('<script>'), 'patient name was not HTML-escaped');
  assert(
    email.html.includes('&lt;script&gt;'),
    'escaped patient name is missing',
  );
});

Deno.test('confirmation uses the assigned slot in the practice timezone', () => {
  const claim = baseClaim('patient_booking_confirmed');
  const booking = claim.payload?.booking as Record<string, unknown>;
  booking.status = 'confirmed';
  booking.slot_starts_at = '2026-08-20T08:30:00Z';

  const email = renderEmail(claim);
  assert(
    email.text.includes('appointment is confirmed'),
    'confirmation wording missing',
  );
  assert(
    email.text.includes('10:30'),
    'slot was not rendered in Africa/Johannesburg time',
  );
  assert(
    !email.text.includes('Sensitive free-text'),
    'booking notes leaked into confirmation',
  );
});

Deno.test('confirmed and rescheduled emails include only nonblank approved preparation and escape it', () => {
  for (const status of ['confirmed', 'rescheduled']) {
    const claim = baseClaim('patient_booking_confirmed');
    const booking = claim.payload?.booking as Record<string, unknown>;
    booking.status = status;
    booking.slot_starts_at = '2026-08-20T08:30:00Z';
    booking.preparation_instructions =
      '  Follow <approved> & "reviewed" instructions.\nBring the referral.  ';

    const email = renderEmail(claim);
    assert(
      email.text.includes('Preparation: Follow <approved> & "reviewed" instructions.\nBring the referral.'),
      `${status} email omitted the approved preparation instructions`,
    );
    assert(
      email.html.includes(
        'Preparation: Follow &lt;approved&gt; &amp; &quot;reviewed&quot; instructions.<br>Bring the referral.',
      ),
      `${status} preparation instructions were not HTML-escaped`,
    );
    assert(
      !email.html.includes('<approved>'),
      `${status} preparation instructions leaked unescaped HTML`,
    );
  }
});

Deno.test('preparation is omitted outside an eligible confirmation and when blank', () => {
  const cases: Array<{
    kind: ClaimedNotification['notification_kind'];
    status: string;
    preparation: string;
  }> = [
    {
      kind: 'patient_booking_acknowledgement',
      status: 'confirmed',
      preparation: 'Do not render this delayed acknowledgement preparation.',
    },
    {
      kind: 'patient_booking_confirmed',
      status: 'rescheduled',
      preparation: '   \n\t  ',
    },
    {
      kind: 'patient_reschedule_acknowledgement',
      status: 'reschedule_requested',
      preparation: 'Do not render before the replacement time is confirmed.',
    },
    {
      kind: 'patient_booking_cancelled',
      status: 'cancelled',
      preparation: 'Do not render after cancellation.',
    },
    {
      kind: 'patient_booking_confirmed',
      status: 'confirmed',
      preparation: '   \n\t  ',
    },
  ];

  for (const testCase of cases) {
    const claim = baseClaim(testCase.kind);
    const booking = claim.payload?.booking as Record<string, unknown>;
    booking.status = testCase.status;
    booking.slot_starts_at = '2026-08-20T08:30:00Z';
    booking.preparation_instructions = testCase.preparation;

    const email = renderEmail(claim);
    assert(
      !email.text.includes('Preparation:'),
      `${testCase.kind}/${testCase.status} exposed preparation instructions`,
    );
    assert(
      !email.html.includes('Preparation:'),
      `${testCase.kind}/${testCase.status} exposed preparation instructions in HTML`,
    );
    assert(
      !email.text.includes('Do not render'),
      `${testCase.kind}/${testCase.status} leaked excluded preparation text`,
    );
  }
});

Deno.test('practice contact alert excludes the submitted message body', () => {
  const claim: ClaimedNotification = {
    ...baseClaim('practice_contact_alert'),
    entity_type: 'contact_enquiry',
    payload: {
      practice: {
        name: 'InsureSPR',
        phone: '+27 11 555 0100',
        timezone: 'Africa/Johannesburg',
      },
      enquiry: {
        reference: 'ENQ-TEST-001',
        name: 'Alex Patient',
        email: 'test@example.invalid',
        phone: '+27115550100',
        enquiry_type: 'general',
        message: 'Private message body must remain in the secure dashboard.',
      },
    },
  };

  const email = renderEmail(claim);
  assert(
    !email.text.includes('Private message body'),
    'enquiry body leaked into text email',
  );
  assert(
    !email.html.includes('Private message body'),
    'enquiry body leaked into HTML email',
  );
  assert(
    email.text.includes('intentionally omitted'),
    'privacy instruction missing',
  );
});

Deno.test('booking transition emails render the immutable queued snapshot, not later booking state', () => {
  const liveClaim = bookingTransitionClaim(
    'patient_booking_confirmed',
    'confirmed',
    41,
    'immutable-confirmation',
  );
  const liveBooking = liveClaim.payload?.booking as Record<string, unknown>;
  liveBooking.slot_starts_at = '2026-08-20T08:30:00Z';
  liveBooking.preparation_instructions = 'Bring the original referral.';

  const queuedPayload = structuredClone(liveClaim.payload);
  const queuedPayloadJson = JSON.stringify(queuedPayload);
  const queuedClaim: ClaimedNotification = { ...liveClaim, payload: queuedPayload };

  // Model a later database update after this delivery attempt was queued. The
  // worker must not consult or mutate this newer state while rendering.
  liveBooking.status = 'cancelled';
  liveBooking.slot_starts_at = '2026-09-01T13:00:00Z';
  liveBooking.preparation_instructions = 'Do not use this later instruction.';
  liveBooking.notes = 'Do not use this later private note.';

  const email = renderEmail(queuedClaim);
  assert(email.text.includes('appointment is confirmed'), 'queued confirmation became a later cancellation');
  assert(email.text.includes('20 August 2026'), 'queued appointment date was replaced by later state');
  assert(
    email.text.includes('Bring the original referral.'),
    'queued preparation was replaced by later state',
  );
  assert(!email.text.includes('Do not use this later'), 'later booking state leaked into queued email');
  assert(
    JSON.stringify(queuedClaim.payload) === queuedPayloadJson,
    'rendering mutated the immutable queued transition snapshot',
  );
});

Deno.test('booking notification kind and queued transition status must match fail closed', () => {
  const mismatches: Array<{
    kind: ClaimedNotification['notification_kind'];
    status: string;
  }> = [
    { kind: 'patient_booking_confirmed', status: 'pending' },
    { kind: 'patient_booking_cancelled', status: 'confirmed' },
    { kind: 'patient_reschedule_acknowledgement', status: 'confirmed' },
    { kind: 'practice_booking_action_alert', status: 'confirmed' },
  ];

  for (const { kind, status } of mismatches) {
    const claim = bookingTransitionClaim(kind, status, 51, `${kind}-${status}`);
    let rendered = false;
    try {
      renderEmail(claim);
      rendered = true;
    } catch {
      // The worker should record a permanent failure instead of sending a
      // message whose kind contradicts its immutable transition snapshot.
    }
    assert(!rendered, `${kind}/${status} mismatch was rendered instead of rejected`);
  }
});

Deno.test('booking lifecycle claims are processed by transition sequence within one entity', async () => {
  const cases: Array<{
    name: string;
    laterKind: ClaimedNotification['notification_kind'];
    laterStatus: string;
  }> = [
    {
      name: 'confirm then cancel',
      laterKind: 'patient_booking_cancelled',
      laterStatus: 'cancelled',
    },
    {
      name: 'confirm then reschedule request',
      laterKind: 'patient_reschedule_acknowledgement',
      laterStatus: 'reschedule_requested',
    },
  ];

  for (const testCase of cases) {
    const confirmed = bookingTransitionClaim(
      'patient_booking_confirmed',
      'confirmed',
      101,
      `${testCase.name}-confirmed`,
    );
    const laterTransition = bookingTransitionClaim(
      testCase.laterKind,
      testCase.laterStatus,
      102,
      `${testCase.name}-later`,
    );
    const processed: string[] = [];

    const outcomes = await processClaimsInEntityOrder(
      [laterTransition, confirmed],
      (claim) => {
        processed.push(claim.attempt_id);
        return Promise.resolve('sent');
      },
      () =>
        Promise.reject(
          new Error(`${testCase.name} should not have deferred a delivered predecessor`),
        ),
    );

    assert(
      JSON.stringify(processed) === JSON.stringify([confirmed.attempt_id, laterTransition.attempt_id]),
      `${testCase.name} was not serialized in immutable transition order`,
    );
    assert(
      JSON.stringify(outcomes) === JSON.stringify(['sent', 'sent']),
      `${testCase.name} did not deliver both transitions`,
    );
  }
});

Deno.test('a delayed practice stream does not block the patient delivery stream', async () => {
  const practiceAlert = bookingTransitionClaim(
    'practice_booking_action_alert',
    'cancelled',
    101,
    'practice-stream',
  );
  practiceAlert.recipient = 'practice@example.invalid';
  const patientCancellation = bookingTransitionClaim(
    'patient_booking_cancelled',
    'cancelled',
    102,
    'patient-stream',
  );
  patientCancellation.recipient = 'patient@example.invalid';
  const processed: string[] = [];

  const outcomes = await processClaimsInEntityOrder(
    [patientCancellation, practiceAlert],
    (claim) => {
      processed.push(claim.attempt_id);
      return Promise.resolve(claim.attempt_id === practiceAlert.attempt_id ? 'failed' : 'sent');
    },
    () => Promise.resolve('deferred'),
  );

  assert(processed.includes(practiceAlert.attempt_id), 'practice stream was not attempted');
  assert(processed.includes(patientCancellation.attempt_id), 'practice failure blocked patient delivery');
  assert(
    outcomes.includes('failed') && outcomes.includes('sent'),
    'independent practice/patient stream outcomes were not preserved',
  );
});

Deno.test('a failed predecessor defers and releases later already-claimed booking work without sending it', async () => {
  const confirmed = bookingTransitionClaim(
    'patient_booking_confirmed',
    'confirmed',
    201,
    'failed-predecessor',
  );
  const cancelled = bookingTransitionClaim(
    'patient_booking_cancelled',
    'cancelled',
    202,
    'must-be-deferred',
  );
  const processed: string[] = [];
  const releasedAttemptIds: string[] = [];

  const outcomes = await processClaimsInEntityOrder(
    [cancelled, confirmed],
    (claim) => {
      processed.push(claim.attempt_id);
      return Promise.resolve(claim.attempt_id === confirmed.attempt_id ? 'failed' : 'sent');
    },
    (claim) => {
      releasedAttemptIds.push(claim.attempt_id);
      // This models the queue failure RPC releasing the later row's claim.
      return Promise.resolve('deferred');
    },
  );

  assert(
    JSON.stringify(processed) === JSON.stringify([confirmed.attempt_id]),
    'later claimed booking work was sent after its predecessor failed',
  );
  assert(
    JSON.stringify(releasedAttemptIds) === JSON.stringify([cancelled.attempt_id]),
    'later claimed booking work was not deferred and released',
  );
  assert(
    JSON.stringify(outcomes) === JSON.stringify(['failed', 'deferred']),
    'failure/defer outcomes were not reported for the serialized booking chain',
  );
});

Deno.test('booking notes and action free-text never appear in any rendered delivery email', () => {
  const privateValues = [
    'PRIVATE_BOOKING_NOTE_3b4ec4',
    'PRIVATE_RESCHEDULE_REASON_4c7d90',
    'PRIVATE_ACTION_METADATA_514f8a',
  ];
  const cases: Array<{
    kind: ClaimedNotification['notification_kind'];
    status: string;
  }> = [
    { kind: 'patient_booking_cancelled', status: 'cancelled' },
    { kind: 'patient_reschedule_acknowledgement', status: 'reschedule_requested' },
    { kind: 'practice_booking_action_alert', status: 'reschedule_requested' },
  ];

  for (const { kind, status } of cases) {
    const claim = bookingTransitionClaim(kind, status, 301, `${kind}-privacy`);
    const booking = claim.payload?.booking as Record<string, unknown>;
    booking.notes = privateValues[0];
    booking.reschedule_reason = privateValues[1];
    booking.action_metadata = privateValues[2];

    const email = renderEmail(claim);
    for (const value of privateValues) {
      assert(!email.text.includes(value), `${kind} leaked ${value} into text email`);
      assert(!email.html.includes(value), `${kind} leaked ${value} into HTML email`);
    }
  }
});
