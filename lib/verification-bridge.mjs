import {
  createHash,
  createHmac,
  createPrivateKey,
  randomUUID,
  sign,
} from 'node:crypto';

const DEFAULT_UPSTREAM =
  'https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-api';
const MAX_BODY_BYTES = 32_000;
const TURNSTILE_TIMEOUT_MS = 6_000;

const OFFICIAL_ORIGINS = new Set([
  'https://insuresprhealth.co.za',
  'https://www.insuresprhealth.co.za',
]);

const ROUTES = new Map([
  ['services', { method: 'GET' }],
  ['availability', { method: 'GET' }],
  ['bookings', { method: 'POST', action: 'book' }],
  ['employer-leads', { method: 'POST', action: 'employer' }],
  ['contact-enquiries', { method: 'POST', action: 'contact' }],
  ['booking-actions', { method: 'POST' }],
  ['events', { method: 'POST' }],
]);

export class BridgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function routeFrom(requestUrl) {
  const candidate = new URL(requestUrl).searchParams.get('route') || '';
  const normalized = candidate.replace(/^\/+|\/+$/g, '');
  if (!ROUTES.has(normalized)) {
    throw new BridgeError(404, 'NOT_FOUND', 'That endpoint does not exist.');
  }
  return normalized;
}

function requestOrigin(request) {
  const requestUrl = new URL(request.url);
  const hostOrigin = requestUrl.origin;
  const headerOrigin = request.headers.get('origin');

  if (!OFFICIAL_ORIGINS.has(hostOrigin)) {
    throw new BridgeError(403, 'ORIGIN_NOT_ALLOWED', 'This site is not allowed to use the booking service.');
  }
  if (headerOrigin && headerOrigin !== hostOrigin) {
    throw new BridgeError(403, 'ORIGIN_NOT_ALLOWED', 'This site is not allowed to use the booking service.');
  }
  return hostOrigin;
}

async function canonicalBody(request) {
  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (declaredLength > MAX_BODY_BYTES) {
    throw new BridgeError(413, 'BODY_TOO_LARGE', 'The submitted form is too large.');
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new BridgeError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send this form as JSON.');
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new BridgeError(413, 'BODY_TOO_LARGE', 'The submitted form is too large.');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not an object');
    return { parsed, raw: JSON.stringify(parsed) };
  } catch {
    throw new BridgeError(400, 'INVALID_JSON', 'The submitted form could not be read.');
  }
}

function clientIp(request) {
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return vercelForwarded || forwarded || request.headers.get('x-real-ip') || '';
}

function privateKeyMaterial(env) {
  const encoded = String(env.INSURESPR_PROXY_PRIVATE_KEY_B64 || '').trim();
  if (!encoded) {
    throw new BridgeError(503, 'SERVER_CONFIGURATION', 'The booking service is not configured.');
  }
  try {
    const der = Buffer.from(encoded, 'base64');
    return {
      der,
      key: createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }),
    };
  } catch {
    throw new BridgeError(503, 'SERVER_CONFIGURATION', 'The booking service is not configured.');
  }
}

function configuration(env) {
  const siteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
  const secretKey = String(env.TURNSTILE_SECRET_KEY || '').trim();
  if (!siteKey || !secretKey) {
    throw new BridgeError(
      503,
      'BOT_CHECK_UNAVAILABLE',
      'The anti-spam service is temporarily unavailable. Please try again or email motselisi@bonevc.co.za.',
    );
  }
  return { siteKey, secretKey };
}

async function verifyTurnstile({ body, request, action, origin, env, fetchImpl }) {
  const { secretKey } = configuration(env);
  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token.trim() : '';
  if (!token || token.length > 2_048) {
    throw new BridgeError(422, 'BOT_CHECK_REQUIRED', 'Please complete the anti-spam check.');
  }

  const form = new URLSearchParams();
  form.set('secret', secretKey);
  form.set('response', token);
  form.set('idempotency_key', randomUUID());
  const ip = clientIp(request);
  if (ip) form.set('remoteip', ip);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });
  } catch {
    throw new BridgeError(
      503,
      'BOT_CHECK_UNAVAILABLE',
      'The anti-spam service is temporarily unavailable. Please try again or email motselisi@bonevc.co.za.',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new BridgeError(
      503,
      'BOT_CHECK_UNAVAILABLE',
      'The anti-spam service is temporarily unavailable. Please try again or email motselisi@bonevc.co.za.',
    );
  }
  const result = await response.json().catch(() => ({ success: false }));
  if (
    result.success !== true ||
    result.action !== action ||
    result.hostname !== new URL(origin).hostname
  ) {
    throw new BridgeError(422, 'BOT_CHECK_FAILED', 'The anti-spam check failed. Please try again.');
  }
}

export function attestationCanonical({
  method,
  route,
  timestamp,
  nonce,
  bodyHash,
  ipHash,
  origin,
  action,
}) {
  return ['v1', method, route, timestamp, nonce, bodyHash, ipHash, origin, action].join('\n');
}

function createAttestation({ method, route, rawBody, origin, action, request, env, now }) {
  const { der, key } = privateKeyMaterial(env);
  const timestamp = String(Math.floor(now() / 1_000));
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
  const ipHash = createHmac('sha256', der).update(clientIp(request) || 'unknown', 'utf8').digest('hex');
  const canonical = attestationCanonical({
    method,
    route: `/${route}`,
    timestamp,
    nonce,
    bodyHash,
    ipHash,
    origin,
    action,
  });
  const signature = sign(null, Buffer.from(canonical, 'utf8'), key).toString('base64url');
  return {
    'x-insurespr-attestation-version': 'v1',
    'x-insurespr-attestation-timestamp': timestamp,
    'x-insurespr-attestation-nonce': nonce,
    'x-insurespr-attestation-ip-hash': ipHash,
    'x-insurespr-attestation-action': action,
    'x-insurespr-attestation-signature': signature,
  };
}

function upstreamUrl(route, requestUrl, env) {
  const base = String(env.INSURESPR_UPSTREAM_API || DEFAULT_UPSTREAM).replace(/\/$/, '');
  const url = new URL(`${base}/${route}`);
  if (route === 'availability') {
    const source = new URL(requestUrl);
    for (const [key, value] of source.searchParams) {
      if (key !== 'route') url.searchParams.append(key, value);
    }
  }
  return url;
}

function safeUpstreamHeaders(response) {
  const headers = {
    'Cache-Control': response.headers.get('cache-control') || 'no-store',
    'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) headers['Retry-After'] = retryAfter;
  return headers;
}

export function createBridgeHandler({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  return async function handleBridgeRequest(request) {
    const requestId = randomUUID();
    try {
      const route = routeFrom(request.url);
      const routeConfig = ROUTES.get(route);
      const method = request.method.toUpperCase();
      if (routeConfig.method !== method) {
        throw new BridgeError(405, 'METHOD_NOT_ALLOWED', 'That request method is not allowed.');
      }
      const origin = requestOrigin(request);
      let body = null;
      let rawBody = '';
      const headers = new Headers({ Origin: origin });

      if (method === 'POST') {
        ({ parsed: body, raw: rawBody } = await canonicalBody(request));
        headers.set('Content-Type', 'application/json');
      }

      if (routeConfig.action) {
        await verifyTurnstile({
          body,
          request,
          action: routeConfig.action,
          origin,
          env,
          fetchImpl,
        });
        const signedHeaders = createAttestation({
          method,
          route,
          rawBody,
          origin,
          action: routeConfig.action,
          request,
          env,
          now,
        });
        for (const [key, value] of Object.entries(signedHeaders)) headers.set(key, value);
      }

      const upstream = await fetchImpl(upstreamUrl(route, request.url, env), {
        method,
        headers,
        body: method === 'POST' ? rawBody : undefined,
        redirect: 'error',
      });
      let responseBody = await upstream.text();

      if (route === 'services' && upstream.ok) {
        const siteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
        if (siteKey) {
          try {
            const parsed = JSON.parse(responseBody);
            parsed.turnstile_site_key = siteKey;
            responseBody = JSON.stringify(parsed);
          } catch {
            throw new BridgeError(502, 'UPSTREAM_INVALID', 'The booking service returned an invalid response.');
          }
        }
      }

      return new Response(responseBody, {
        status: upstream.status,
        headers: safeUpstreamHeaders(upstream),
      });
    } catch (error) {
      if (error instanceof BridgeError) {
        return jsonResponse({
          error: { code: error.code, message: error.message },
          request_id: requestId,
        }, error.status);
      }
      console.error(JSON.stringify({ request_id: requestId, error: 'bridge_request_failure' }));
      return jsonResponse({
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'The booking service is temporarily unavailable. Please try again or email motselisi@bonevc.co.za.',
        },
        request_id: requestId,
      }, 502);
    }
  };
}
