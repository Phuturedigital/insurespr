const FUNCTION_NAME = 'insurespr-notifications';
const PROVIDER_NAME = 'resend';
const PROVIDER_URL = 'https://api.resend.com/emails';
const DEFAULT_BATCH_SIZE = 8;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = Record<string, Json>;

export type ClaimedNotification = {
  attempt_id: string;
  entity_type: 'booking' | 'employer_lead' | 'contact_enquiry';
  entity_id: string;
  notification_kind:
    | 'patient_booking_acknowledgement'
    | 'practice_booking_alert'
    | 'patient_booking_confirmed'
    | 'patient_booking_cancelled'
    | 'patient_reschedule_acknowledgement'
    | 'practice_booking_action_alert'
    | 'employer_acknowledgement'
    | 'practice_employer_alert'
    | 'contact_acknowledgement'
    | 'practice_contact_alert';
  recipient: string;
  attempt_count: number;
  payload: JsonRecord | null;
};

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

export type DeliveryOutcome = 'sent' | 'failed' | 'lease_lost' | 'deferred';

type WorkerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  workerSecret: string;
  resendApiKey: string;
  emailFrom: string;
  emailReplyTo: string;
};

class DeliveryError extends Error {
  code: string;
  retryable: boolean;
  httpStatus: number | null;

  constructor(
    code: string,
    message: string,
    retryable: boolean,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

function jsonResponse(
  status: number,
  body: JsonRecord,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...additionalHeaders,
    },
  });
}

export function readinessResponse(ready: boolean): Response {
  return jsonResponse(200, {
    ok: true,
    ready,
    readiness: ready ? 'ready' : 'not_ready',
  }, {
    'x-insurespr-ready': ready ? 'true' : 'false',
  });
}

function logEvent(event: string, details: JsonRecord = {}): void {
  console.log(JSON.stringify({ function: FUNCTION_NAME, event, ...details }));
}

function getServiceRoleKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy) return legacy;

  const direct = Deno.env.get('SUPABASE_SECRET_KEY')?.trim();
  if (direct) return direct;

  const bundled = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim();
  if (!bundled) return '';

  try {
    const parsed: unknown = JSON.parse(bundled);
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
      ? Object.values(parsed)
      : [];
    return candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.toString()
      .trim() || '';
  } catch {
    return bundled;
  }
}

function readConfig(): WorkerConfig | null {
  const config: WorkerConfig = {
    supabaseUrl: Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '',
    serviceRoleKey: getServiceRoleKey(),
    workerSecret: Deno.env.get('NOTIFICATION_WORKER_SECRET')?.trim() || '',
    resendApiKey: Deno.env.get('RESEND_API_KEY')?.trim() || '',
    emailFrom: Deno.env.get('EMAIL_FROM')?.trim() || '',
    emailReplyTo: Deno.env.get('EMAIL_REPLY_TO')?.trim() || '',
  };

  if (
    !config.supabaseUrl.startsWith('https://') ||
    !config.serviceRoleKey ||
    config.workerSecret.length < 32 ||
    !config.resendApiKey ||
    !config.emailFrom ||
    !config.emailReplyTo
  ) {
    return null;
  }

  return config;
}

export function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }

  return mismatch === 0;
}

async function callRpc<T>(
  config: WorkerConfig,
  name: string,
  body: JsonRecord,
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new DeliveryError(
      'queue_rpc_failed',
      `Queue operation returned HTTP ${response.status}.`,
      true,
      response.status,
    );
  }

  return await response.json() as T;
}

function asRecord(value: Json | undefined): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: Json | undefined, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringList(value: Json | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && !!item.trim())
      .map((item) => item.trim())
    : [];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildEmail(
  subject: string,
  heading: string,
  paragraphs: string[],
): EmailContent {
  const safeParagraphs = paragraphs.filter(Boolean);
  const text = [heading, '', ...safeParagraphs].join('\n\n');
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f6f5;color:#17332d;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 18px">
      <div style="background:#ffffff;border:1px solid #d9e2df;border-radius:14px;padding:28px">
        <p style="margin:0 0 8px;color:#2f6f62;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">InsureSPR</p>
        <h1 style="margin:0 0 22px;font-size:24px;line-height:1.25">${escapeHtml(heading)}</h1>
        ${
    safeParagraphs.map((paragraph) =>
      `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`
    ).join('')
  }
      </div>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

function referenceLine(reference: string): string {
  return `Reference: ${reference || 'Not available'}`;
}

function formatAppointment(value: string, timezone: string): string {
  if (!value) return '';
  const appointment = new Date(value);
  if (Number.isNaN(appointment.getTime())) return value;

  try {
    return new Intl.DateTimeFormat('en-ZA', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone || 'Africa/Johannesburg',
    }).format(appointment);
  } catch {
    return value;
  }
}

function transitionSequence(claim: ClaimedNotification): number | null {
  const delivery = asRecord(claim.payload?._delivery);
  const sequence = delivery.transition_sequence;
  return typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

function assertBookingTransitionMatches(
  kind: ClaimedNotification['notification_kind'],
  status: string,
): void {
  const allowedStatuses: Partial<
    Record<ClaimedNotification['notification_kind'], string[]>
  > = {
    patient_booking_confirmed: ['confirmed', 'rescheduled'],
    patient_booking_cancelled: ['cancelled'],
    patient_reschedule_acknowledgement: ['reschedule_requested'],
    practice_booking_action_alert: ['cancelled', 'reschedule_requested'],
  };
  const allowed = allowedStatuses[kind];
  if (allowed && !allowed.includes(status)) {
    throw new DeliveryError(
      'notification_transition_mismatch',
      'The queued booking transition snapshot does not match its notification kind.',
      false,
    );
  }
}

export async function processClaimsInEntityOrder(
  claims: ClaimedNotification[],
  processor: (
    claim: ClaimedNotification,
  ) => Promise<Exclude<DeliveryOutcome, 'deferred'>>,
  deferrer?: (
    claim: ClaimedNotification,
    reason: 'predecessor_not_delivered',
  ) => Promise<'deferred' | 'lease_lost'>,
): Promise<DeliveryOutcome[]> {
  const grouped = new Map<string, Array<{ claim: ClaimedNotification; index: number }>>();
  claims.forEach((claim, index) => {
    // Delivery order is a recipient stream, not the entire booking. A delayed
    // practice alert must never hold up a patient's confirmation/cancellation,
    // while messages to that same patient remain strictly sequenced.
    const key = `${claim.entity_type}:${claim.entity_id}:${claim.recipient.trim().toLowerCase()}`;
    const group = grouped.get(key) || [];
    group.push({ claim, index });
    grouped.set(key, group);
  });

  const groupedOutcomes = await Promise.all(
    Array.from(grouped.values()).map(async (group) => {
      group.sort((left, right) => {
        const leftSequence = transitionSequence(left.claim);
        const rightSequence = transitionSequence(right.claim);
        if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
          return leftSequence - rightSequence;
        }
        if (leftSequence === null && rightSequence !== null) return -1;
        if (leftSequence !== null && rightSequence === null) return 1;
        return left.index - right.index;
      });

      const outcomes: DeliveryOutcome[] = [];
      let blocked = false;
      for (const { claim } of group) {
        if (blocked) {
          // The claim RPC normally returns one row per delivery stream. If a
          // future regression returns more, release the later lease through a
          // bounded retry instead of sending it out of order or abandoning it
          // in processing state.
          const outcome = deferrer ? await deferrer(claim, 'predecessor_not_delivered') : 'deferred';
          outcomes.push(outcome);
          continue;
        }
        const outcome = await processor(claim);
        outcomes.push(outcome);
        if (outcome !== 'sent') blocked = true;
      }
      return outcomes;
    }),
  );
  return groupedOutcomes.flat();
}

export function renderEmail(claim: ClaimedNotification): EmailContent {
  if (!claim.payload) {
    throw new DeliveryError(
      'entity_not_found',
      'The queued record no longer has a matching delivery context.',
      false,
    );
  }

  const practice = asRecord(claim.payload.practice);
  const practiceName = asString(practice.name, 'InsureSPR');
  const practiceAddress = asString(practice.address);
  const practiceTimezone = asString(practice.timezone, 'Africa/Johannesburg');

  if (
    claim.notification_kind === 'patient_booking_acknowledgement' ||
    claim.notification_kind === 'practice_booking_alert' ||
    claim.notification_kind === 'patient_booking_confirmed' ||
    claim.notification_kind === 'patient_booking_cancelled' ||
    claim.notification_kind === 'patient_reschedule_acknowledgement' ||
    claim.notification_kind === 'practice_booking_action_alert'
  ) {
    const booking = asRecord(claim.payload.booking);
    const reference = asString(booking.reference);
    const name = asString(booking.first_name, 'there');
    const service = asString(booking.service_name, 'the requested service');
    const status = asString(booking.status, 'pending');
    const preferredDate = asString(booking.preferred_date);
    const preferredPeriod = asString(
      booking.preferred_time_period,
      'any suitable time',
    );
    const slotStart = asString(booking.slot_starts_at);
    const appointmentTime = formatAppointment(slotStart, practiceTimezone);
    const preparationInstructions = claim.notification_kind === 'patient_booking_confirmed' &&
        (status === 'confirmed' || status === 'rescheduled')
      ? asString(booking.preparation_instructions)
      : '';
    assertBookingTransitionMatches(claim.notification_kind, status);

    if (claim.notification_kind === 'patient_booking_acknowledgement') {
      const scheduling = status === 'confirmed' && slotStart
        ? `Your appointment is confirmed for ${appointmentTime}.`
        : `We received your request for ${service}${
          preferredDate ? ` on ${preferredDate}` : ''
        } (${preferredPeriod}). This is a request, not a confirmed appointment. The practice will confirm availability separately.`;
      return buildEmail(
        `We received your InsureSPR request — ${reference}`,
        `Hello ${name}, we received your request`,
        [
          referenceLine(reference),
          scheduling,
          'To change or cancel this request, reply to this email.',
          practiceAddress ? `${practiceName}: ${practiceAddress}` : practiceName,
        ],
      );
    }

    if (claim.notification_kind === 'patient_booking_confirmed') {
      return buildEmail(
        `Your InsureSPR appointment is confirmed — ${reference}`,
        `Hello ${name}, your appointment is confirmed`,
        [
          referenceLine(reference),
          `Service: ${service}`,
          appointmentTime ? `Appointment: ${appointmentTime}` : `Appointment date: ${preferredDate}`,
          practiceAddress ? `Location: ${practiceAddress}` : '',
          preparationInstructions ? `Preparation: ${preparationInstructions}` : '',
          'To request a change or cancellation, reply to this email.',
        ],
      );
    }

    if (claim.notification_kind === 'patient_booking_cancelled') {
      return buildEmail(
        `Your InsureSPR cancellation was recorded — ${reference}`,
        `Hello ${name}, your cancellation was recorded`,
        [
          referenceLine(reference),
          `The booking for ${service} is now cancelled.`,
          'If you did not request this or need another appointment, reply to this email.',
        ],
      );
    }

    if (claim.notification_kind === 'patient_reschedule_acknowledgement') {
      return buildEmail(
        `We received your reschedule request — ${reference}`,
        `Hello ${name}, we received your reschedule request`,
        [
          referenceLine(reference),
          preferredDate
            ? `Requested date: ${preferredDate} (${preferredPeriod})`
            : 'The requested timing is recorded on your booking.',
          'This is not a confirmed new appointment. The practice will confirm the replacement time separately.',
          'For urgent corrections, reply to this email.',
        ],
      );
    }

    if (claim.notification_kind === 'practice_booking_action_alert') {
      return buildEmail(
        `Booking action needs review — ${reference}`,
        'A patient changed a booking online',
        [
          referenceLine(reference),
          `Action status: ${status}`,
          `Patient: ${asString(booking.first_name)} ${asString(booking.surname)}`
            .trim(),
          `Contact: ${asString(booking.mobile)} · ${asString(booking.email)}`,
          `Service: ${service}`,
          preferredDate ? `Requested date: ${preferredDate} (${preferredPeriod})` : '',
          'Review the booking and action history in the secure Supabase dashboard.',
        ],
      );
    }

    return buildEmail(
      `New booking request — ${reference}`,
      'A new booking request needs review',
      [
        referenceLine(reference),
        `Patient: ${asString(booking.first_name)} ${asString(booking.surname)}`
          .trim(),
        `Contact: ${asString(booking.mobile)} · ${asString(booking.email)}`,
        `Service: ${service}`,
        preferredDate ? `Preferred date: ${preferredDate} (${preferredPeriod})` : '',
        'Review the full record and any user-supplied notes in the secure Supabase dashboard. Do not forward sensitive details by email.',
      ],
    );
  }

  if (
    claim.notification_kind === 'employer_acknowledgement' ||
    claim.notification_kind === 'practice_employer_alert'
  ) {
    const lead = asRecord(claim.payload.lead);
    const reference = asString(lead.reference);
    const name = asString(lead.contact_name, 'there');
    const company = asString(lead.company_name, 'your organisation');

    if (claim.notification_kind === 'employer_acknowledgement') {
      return buildEmail(
        `We received your InsureSPR enquiry — ${reference}`,
        `Hello ${name}, thank you for contacting us`,
        [
          referenceLine(reference),
          `We received the workforce health enquiry for ${company}. A member of the practice team will review it and respond using the contact details you supplied.`,
          'For urgent corrections, reply to this email.',
        ],
      );
    }

    const services = asStringList(lead.services_required);
    return buildEmail(
      `New workforce enquiry — ${reference}`,
      'A new workforce enquiry needs review',
      [
        referenceLine(reference),
        `Organisation: ${company}`,
        `Contact: ${name} · ${asString(lead.phone)} · ${asString(lead.work_email)}`,
        services.length ? `Services requested: ${services.join(', ')}` : '',
        `Employee range: ${asString(lead.employee_count_range, 'Not specified')}`,
        'Review the full record and any user-supplied notes in the secure Supabase dashboard.',
      ],
    );
  }

  if (
    claim.notification_kind === 'contact_acknowledgement' ||
    claim.notification_kind === 'practice_contact_alert'
  ) {
    const enquiry = asRecord(claim.payload.enquiry);
    const reference = asString(enquiry.reference);
    const name = asString(enquiry.name, 'there');

    if (claim.notification_kind === 'contact_acknowledgement') {
      return buildEmail(
        `We received your InsureSPR enquiry — ${reference}`,
        `Hello ${name}, we received your message`,
        [
          referenceLine(reference),
          'A member of the practice team will review your enquiry and respond using the contact details you supplied.',
          'For urgent corrections, reply to this email.',
        ],
      );
    }

    return buildEmail(
      `New website enquiry — ${reference}`,
      'A new website enquiry needs review',
      [
        referenceLine(reference),
        `Contact: ${name} · ${asString(enquiry.phone, 'No phone supplied')} · ${asString(enquiry.email)}`,
        `Category: ${asString(enquiry.enquiry_type, 'general')}`,
        'Review the message in the secure Supabase dashboard. Its contents are intentionally omitted from this email.',
      ],
    );
  }

  throw new DeliveryError(
    'unsupported_notification_kind',
    'The queued notification kind is not supported by this worker.',
    false,
  );
}

async function sendEmail(
  config: WorkerConfig,
  claim: ClaimedNotification,
  content: EmailContent,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `insurespr/${claim.attempt_id}`,
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [claim.recipient],
        reply_to: config.emailReplyTo,
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DeliveryError(
      'provider_network_error',
      'The email provider could not be reached before the request deadline.',
      true,
    );
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 ||
      response.status >= 500;
    throw new DeliveryError(
      `provider_http_${response.status}`,
      `The email provider returned HTTP ${response.status}.`,
      retryable,
      response.status,
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new DeliveryError(
      'provider_response_invalid',
      'The email provider returned an invalid success response.',
      true,
      response.status,
    );
  }

  const providerMessageId = responseBody && typeof responseBody === 'object' && 'id' in responseBody
    ? String((responseBody as { id: unknown }).id || '').trim()
    : '';
  if (!providerMessageId) {
    throw new DeliveryError(
      'provider_message_id_missing',
      'The email provider did not return a message identifier.',
      true,
      response.status,
    );
  }

  return providerMessageId;
}

async function recordFailure(
  config: WorkerConfig,
  workerId: string,
  claim: ClaimedNotification,
  error: DeliveryError,
): Promise<boolean> {
  try {
    return await callRpc<boolean>(config, 'fail_notification_attempt', {
      p_attempt_id: claim.attempt_id,
      p_worker_id: workerId,
      p_error_code: error.code,
      p_error_message: error.message,
      p_retryable: error.retryable,
      p_provider: PROVIDER_NAME,
      p_http_status: error.httpStatus,
    });
  } catch {
    logEvent('queue_failure_write_failed', { attempt_id: claim.attempt_id });
    return false;
  }
}

async function processClaim(
  config: WorkerConfig,
  workerId: string,
  claim: ClaimedNotification,
): Promise<Exclude<DeliveryOutcome, 'deferred'>> {
  try {
    const content = renderEmail(claim);
    const providerMessageId = await sendEmail(config, claim, content);
    const completed = await callRpc<boolean>(
      config,
      'complete_notification_attempt',
      {
        p_attempt_id: claim.attempt_id,
        p_worker_id: workerId,
        p_provider: PROVIDER_NAME,
        p_provider_message_id: providerMessageId,
      },
    );

    if (!completed) {
      logEvent('completion_lease_lost', { attempt_id: claim.attempt_id });
      return 'lease_lost';
    }

    logEvent('delivery_sent', {
      attempt_id: claim.attempt_id,
      kind: claim.notification_kind,
      attempt_count: claim.attempt_count,
    });
    return 'sent';
  } catch (cause) {
    const error = cause instanceof DeliveryError ? cause : new DeliveryError(
      'worker_unexpected_error',
      'The worker could not prepare or deliver this notification.',
      true,
    );
    await recordFailure(config, workerId, claim, error);
    logEvent('delivery_failed', {
      attempt_id: claim.attempt_id,
      kind: claim.notification_kind,
      attempt_count: claim.attempt_count,
      error_code: error.code,
      retryable: error.retryable,
    });
    return 'failed';
  }
}

async function deferAfterPredecessor(
  config: WorkerConfig,
  workerId: string,
  claim: ClaimedNotification,
): Promise<'deferred' | 'lease_lost'> {
  const released = await recordFailure(
    config,
    workerId,
    claim,
    new DeliveryError(
      'predecessor_not_delivered',
      'An earlier notification in this delivery stream was not delivered.',
      true,
    ),
  );
  return released ? 'deferred' : 'lease_lost';
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    // This public probe never invokes the queue and exposes no provider,
    // recipient or credential details. It exists solely for release/uptime
    // checks that must not possess the scheduler secret.
    return readinessResponse(Boolean(readConfig()));
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const config = readConfig();
  if (!config) {
    logEvent('configuration_incomplete');
    return jsonResponse(503, { error: 'notification_delivery_not_configured' });
  }

  const suppliedSecret = request.headers.get('x-worker-secret') || '';
  if (!timingSafeEqual(suppliedSecret, config.workerSecret)) {
    logEvent('authorization_rejected');
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const workerId = crypto.randomUUID();
  let claims: ClaimedNotification[];
  try {
    claims = await callRpc<ClaimedNotification[]>(
      config,
      'claim_notification_batch',
      {
        p_worker_id: workerId,
        p_limit: DEFAULT_BATCH_SIZE,
      },
    );
  } catch {
    logEvent('queue_claim_failed');
    return jsonResponse(502, { error: 'notification_queue_unavailable' });
  }

  if (!Array.isArray(claims) || claims.length === 0) {
    return jsonResponse(200, { claimed: 0, sent: 0, failed: 0, lease_lost: 0 });
  }

  const outcomes = await processClaimsInEntityOrder(
    claims,
    (claim) => processClaim(config, workerId, claim),
    (claim) => deferAfterPredecessor(config, workerId, claim),
  );
  const counts = outcomes.reduce(
    (result, outcome) => ({ ...result, [outcome]: result[outcome] + 1 }),
    { sent: 0, failed: 0, lease_lost: 0, deferred: 0 },
  );

  return jsonResponse(200, {
    claimed: claims.length,
    sent: counts.sent,
    failed: counts.failed,
    lease_lost: counts.lease_lost,
    deferred: counts.deferred,
  });
}

if (import.meta.main) {
  Deno.serve(handler);
}
