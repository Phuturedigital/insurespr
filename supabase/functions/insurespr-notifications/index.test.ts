import { type ClaimedNotification, renderEmail, timingSafeEqual } from './index.ts';

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
