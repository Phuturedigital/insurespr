const FUNCTION_NAME = 'insurespr-api';
const MAX_BODY_BYTES = 32_000;
const PRIVACY_VERSION = 'pending-approval';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://insurespr.vercel.app',
  'https://insuresprhealth.co.za',
  'https://www.insuresprhealth.co.za',
  'https://insurespr-concept.phuturedigital.co.za',
  'http://127.0.0.1:4321',
  'http://localhost:4321',
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = Record<string, Json>;

type DbErrorShape = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getAllowedOrigins(): Set<string> {
  const configured = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'content-type, x-client-version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function responseHeaders(origin: string | null, cacheControl = 'no-store'): HeadersInit {
  return {
    ...corsHeaders(origin),
    'Cache-Control': cacheControl,
    'Content-Type': 'application/json; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function jsonResponse(
  origin: string | null,
  body: JsonRecord,
  status = 200,
  cacheControl = 'no-store',
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin, cacheControl),
  });
}

function getRoute(url: URL): string {
  const parts = url.pathname.split('/').filter(Boolean);
  const marker = parts.lastIndexOf(FUNCTION_NAME);
  if (marker < 0) return '/';
  const suffix = parts.slice(marker + 1).join('/');
  return suffix ? `/${suffix}` : '/';
}

function secretKey(): string {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try {
      const parsed = JSON.parse(modern) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      throw new ApiError(503, 'SERVER_CONFIGURATION', 'The booking service is not configured.');
    }
  }

  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new ApiError(503, 'SERVER_CONFIGURATION', 'The booking service is not configured.');
}

function supabaseUrl(): string {
  const value = Deno.env.get('SUPABASE_URL');
  if (!value) throw new ApiError(503, 'SERVER_CONFIGURATION', 'The booking service is not configured.');
  return value.replace(/\/$/, '');
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', secretKey());
  headers.set('Content-Type', 'application/json');
  if (!headers.has('Prefer')) headers.set('Prefer', 'return=representation');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readDbJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T | DbErrorShape;
  if (response.ok) return body as T;

  const error = body as DbErrorShape;
  if (error.message === 'selected slot is unavailable' || error.code === 'P0002' || error.code === '23505') {
    throw new ApiError(
      409,
      'SLOT_UNAVAILABLE',
      'That time is no longer available. Please choose another time.',
    );
  }
  if (
    error.code === '22023' || error.message?.startsWith('invalid ') || error.message?.includes('required')
  ) {
    throw new ApiError(422, 'VALIDATION_ERROR', error.message || 'Please check the submitted details.');
  }
  throw new ApiError(
    503,
    'DATABASE_UNAVAILABLE',
    'We could not save this right now. Please try again or contact the practice.',
  );
}

async function rpc<T>(name: string, payload: JsonRecord): Promise<T> {
  const response = await dbFetch(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return await readDbJson<T>(response);
}

function requireUuid(value: string | null, field: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `${field} is invalid.`);
  }
  return value;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('cf-connecting-ip') || 'unknown';
}

async function hmacHex(value: string): Promise<string> {
  const material = Deno.env.get('IP_HASH_PEPPER') || secretKey();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(material),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function enforceRateLimit(
  req: Request,
  endpoint: string,
  limit: number,
  windowSeconds: number,
): Promise<string> {
  const ipHash = await hmacHex(clientIp(req));
  const result = await rpc<Array<{ allowed: boolean; remaining: number; retry_after_seconds: number }>>(
    'check_rate_limit',
    {
      p_key_hash: ipHash,
      p_endpoint: endpoint,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    },
  );
  const state = result[0];
  if (!state?.allowed) {
    throw new ApiError(
      429,
      'RATE_LIMITED',
      `Too many attempts. Please wait ${state?.retry_after_seconds || 60} seconds and try again.`,
    );
  }
  return ipHash;
}

async function readBody(req: Request): Promise<JsonRecord> {
  const declaredLength = Number(req.headers.get('content-length') || '0');
  if (declaredLength > MAX_BODY_BYTES) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'The submitted form is too large.');
  }
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send this form as JSON.');
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'The submitted form is too large.');
  }

  try {
    const parsed = JSON.parse(raw) as Json;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not an object');
    return parsed as JsonRecord;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'The submitted form could not be read.');
  }
}

function rejectBot(body: JsonRecord): void {
  if (typeof body.website === 'string' && body.website.trim()) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'The submitted form could not be accepted.');
  }
}

async function verifyTurnstile(body: JsonRecord, req: Request): Promise<void> {
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!turnstileSecret) return;

  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : '';
  if (!token) throw new ApiError(422, 'BOT_CHECK_REQUIRED', 'Please complete the anti-spam check.');

  const form = new FormData();
  form.set('secret', turnstileSecret);
  form.set('response', token);
  const ip = clientIp(req);
  if (ip !== 'unknown') form.set('remoteip', ip);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const result = await response.json().catch(() => ({ success: false })) as { success?: boolean };
  if (!result.success) {
    throw new ApiError(422, 'BOT_CHECK_FAILED', 'The anti-spam check failed. Please try again.');
  }
}

function normalizePhone(value: Json): string {
  const raw = typeof value === 'string' ? value.replace(/[\s()-]/g, '') : '';
  if (/^0[0-9]{9}$/.test(raw)) return `+27${raw.slice(1)}`;
  if (/^27[0-9]{9}$/.test(raw)) return `+${raw}`;
  return raw;
}

function text(value: Json, max = 2_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boolean(value: Json): boolean {
  return value === true;
}

function marketing(body: JsonRecord): JsonRecord {
  const candidate = body.marketing;
  if (!candidate || Array.isArray(candidate) || typeof candidate !== 'object') return {};
  return candidate as JsonRecord;
}

async function handleServices(origin: string | null): Promise<Response> {
  const [practiceResponse, categoriesResponse, servicesResponse] = await Promise.all([
    dbFetch(
      'practice_settings?select=practice_name,descriptor,address_line,locality,region,country_code,phone_display,phone_e164,whatsapp_e164,public_email,timezone,opening_hours,maps_url,privacy_notice_version&id=eq.primary',
    ),
    dbFetch(
      'service_categories?select=id,slug,name,audience,summary,primary_cta,display_order&is_published=eq.true&order=display_order.asc',
    ),
    dbFetch(
      'services?select=id,category_id,slug,name,short_description,audience,booking_mode,confirmation_mode,appointment_duration_minutes,price_type,cash_price_cents,cash_price_max_cents,currency,price_note,medical_aid_status,referral_requirement,appointment_requirement,what_to_bring,expected_duration,results_process,preparation_instructions,verification_status,display_order&is_published=eq.true&order=display_order.asc',
    ),
  ]);

  const [practice, categories, services] = await Promise.all([
    readDbJson<JsonRecord[]>(practiceResponse),
    readDbJson<JsonRecord[]>(categoriesResponse),
    readDbJson<JsonRecord[]>(servicesResponse),
  ]);

  return jsonResponse(
    origin,
    {
      practice: practice[0] || null,
      categories,
      services,
    },
    200,
    'public, max-age=60, stale-while-revalidate=300',
  );
}

async function handleAvailability(url: URL, origin: string | null): Promise<Response> {
  const serviceId = requireUuid(url.searchParams.get('service_id'), 'service_id');
  const from = url.searchParams.get('from');
  const until = url.searchParams.get('until');
  const fromDate = from ? new Date(from) : new Date();
  const untilDate = until ? new Date(until) : new Date(Date.now() + 14 * 86_400_000);

  if (Number.isNaN(fromDate.valueOf()) || Number.isNaN(untilDate.valueOf()) || untilDate <= fromDate) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'The requested date range is invalid.');
  }
  if (untilDate.valueOf() - fromDate.valueOf() > 45 * 86_400_000) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Availability can be requested for at most 45 days.');
  }

  const slots = await rpc<Json[]>('list_available_slots', {
    p_service_id: serviceId,
    p_from: fromDate.toISOString(),
    p_until: untilDate.toISOString(),
  });
  return jsonResponse(origin, { slots }, 200, 'public, max-age=15');
}

async function handleBooking(req: Request, origin: string | null): Promise<Response> {
  const body = await readBody(req);
  rejectBot(body);
  await verifyTurnstile(body, req);
  const ipHash = await enforceRateLimit(req, 'bookings', 10, 3_600);

  const payload: JsonRecord = {
    idempotency_key: text(body.idempotency_key, 36),
    first_name: text(body.first_name, 80),
    surname: text(body.surname, 80),
    mobile_e164: normalizePhone(body.mobile),
    email: text(body.email, 254).toLowerCase(),
    service_id: text(body.service_id, 36),
    slot_id: text(body.slot_id, 36) || null,
    preferred_date: text(body.preferred_date, 10) || null,
    preferred_time_period: text(body.preferred_time_period, 20) || 'any',
    patient_status: text(body.patient_status, 20),
    notes: text(body.notes, 1_000) || null,
    privacy_accepted: boolean(body.privacy_accepted),
    privacy_version: PRIVACY_VERSION,
    ip_hash: ipHash,
    marketing: marketing(body),
  };

  const booking = await rpc<JsonRecord>('create_booking', { p_payload: payload });
  return jsonResponse(origin, { booking }, 201);
}

async function handleEmployerLead(req: Request, origin: string | null): Promise<Response> {
  const body = await readBody(req);
  rejectBot(body);
  await verifyTurnstile(body, req);
  const ipHash = await enforceRateLimit(req, 'employer-leads', 6, 3_600);
  const services = Array.isArray(body.services_required)
    ? body.services_required.filter((value): value is string => typeof value === 'string').slice(0, 20)
    : [];

  const payload: JsonRecord = {
    idempotency_key: text(body.idempotency_key, 36),
    contact_name: text(body.contact_name, 160),
    company_name: text(body.company_name, 200),
    work_email: text(body.work_email, 254).toLowerCase(),
    phone_e164: normalizePhone(body.phone),
    employee_count_range: text(body.employee_count_range, 80),
    services_required: services,
    preferred_timeframe: text(body.preferred_timeframe, 200) || null,
    delivery_mode: text(body.delivery_mode, 40) || null,
    location: text(body.location, 300) || null,
    notes: text(body.notes, 2_000) || null,
    privacy_accepted: boolean(body.privacy_accepted),
    privacy_version: PRIVACY_VERSION,
    ip_hash: ipHash,
    marketing: marketing(body),
  };
  const lead = await rpc<JsonRecord>('create_employer_lead', { p_payload: payload });
  return jsonResponse(origin, { lead }, 201);
}

async function handleContact(req: Request, origin: string | null): Promise<Response> {
  const body = await readBody(req);
  rejectBot(body);
  await verifyTurnstile(body, req);
  const ipHash = await enforceRateLimit(req, 'contact-enquiries', 6, 3_600);
  const payload: JsonRecord = {
    idempotency_key: text(body.idempotency_key, 36),
    name: text(body.name, 160),
    email: text(body.email, 254).toLowerCase(),
    phone_e164: normalizePhone(body.phone) || null,
    enquiry_type: text(body.enquiry_type, 40) || 'general',
    message: text(body.message, 2_000),
    privacy_accepted: boolean(body.privacy_accepted),
    privacy_version: PRIVACY_VERSION,
    ip_hash: ipHash,
    marketing: marketing(body),
  };
  const enquiry = await rpc<JsonRecord>('create_contact_enquiry', { p_payload: payload });
  return jsonResponse(origin, { enquiry }, 201);
}

async function handleBookingAction(req: Request, origin: string | null): Promise<Response> {
  const body = await readBody(req);
  rejectBot(body);
  await enforceRateLimit(req, 'booking-actions', 10, 3_600);
  const payload: JsonRecord = {
    token: text(body.token, 64),
    action: text(body.action, 40),
    preferred_date: text(body.preferred_date, 10) || null,
    preferred_time_period: text(body.preferred_time_period, 20) || null,
    note: text(body.note, 500) || null,
  };
  const booking = await rpc<JsonRecord>('manage_booking', { p_payload: payload });
  return jsonResponse(origin, { booking });
}

async function handleEvent(req: Request, origin: string | null): Promise<Response> {
  const body = await readBody(req);
  rejectBot(body);
  await enforceRateLimit(req, 'analytics-events', 120, 60);
  const payload: JsonRecord = {
    event_name: text(body.event_name, 80),
    anonymous_session_id: text(body.anonymous_session_id, 128) || null,
    page_path: text(body.page_path, 500),
    service_id: text(body.service_id, 36) || null,
    marketing: marketing(body),
  };
  await rpc<null>('record_analytics_event', { p_payload: payload });
  return jsonResponse(origin, { recorded: true });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const origin = req.headers.get('origin');
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : null;

  if (origin && !allowedOrigin) {
    return jsonResponse(null, {
      error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This site is not allowed to use the booking service.' },
      request_id: requestId,
    }, 403);
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
  }

  try {
    const url = new URL(req.url);
    const route = getRoute(url);
    if (req.method === 'GET' && route === '/') {
      return jsonResponse(allowedOrigin, { ok: true, service: FUNCTION_NAME }, 200, 'no-store');
    }
    if (req.method === 'GET' && route === '/services') return await handleServices(allowedOrigin);
    if (req.method === 'GET' && route === '/availability') {
      return await handleAvailability(url, allowedOrigin);
    }
    if (req.method === 'POST' && route === '/bookings') return await handleBooking(req, allowedOrigin);
    if (req.method === 'POST' && route === '/employer-leads') {
      return await handleEmployerLead(req, allowedOrigin);
    }
    if (req.method === 'POST' && route === '/contact-enquiries') {
      return await handleContact(req, allowedOrigin);
    }
    if (req.method === 'POST' && route === '/booking-actions') {
      return await handleBookingAction(req, allowedOrigin);
    }
    if (req.method === 'POST' && route === '/events') return await handleEvent(req, allowedOrigin);
    throw new ApiError(404, 'NOT_FOUND', 'That endpoint does not exist.');
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(allowedOrigin, {
        error: { code: error.code, message: error.message },
        request_id: requestId,
      }, error.status);
    }
    console.error(JSON.stringify({ request_id: requestId, error: 'unhandled_request_failure' }));
    return jsonResponse(allowedOrigin, {
      error: {
        code: 'UNEXPECTED_ERROR',
        message: 'Something went wrong. Please try again or contact the practice.',
      },
      request_id: requestId,
    }, 500);
  }
});
