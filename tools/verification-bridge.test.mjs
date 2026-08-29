import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import { attestationCanonical, createBridgeHandler } from '../lib/verification-bridge.mjs';

function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

test('services are read through the upstream and receive only the public site key', async () => {
  const calls = [];
  const handler = createBridgeHandler({
    env: { TURNSTILE_SITE_KEY: 'public-site-key' },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ services: [], turnstile_site_key: null });
    },
  });

  const response = await handler(
    new Request('https://www.insuresprhealth.co.za/api/insurespr?route=services'),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.turnstile_site_key, 'public-site-key');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /insurespr-api\/services$/);
  assert.equal(calls[0].init.headers.get('Origin'), 'https://www.insuresprhealth.co.za');
});

test('protected requests validate Turnstile and forward a verifiable signed attestation', async () => {
  const { privateKeyB64, publicKey } = testKeys();
  const upstreamCalls = [];
  const now = 1_787_990_400_000;
  const rawBody = JSON.stringify({ turnstile_token: 'one-time-token', privacy_accepted: true });
  const handler = createBridgeHandler({
    env: {
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'secret-key',
      INSURESPR_PROXY_PRIVATE_KEY_B64: privateKeyB64,
    },
    now: () => now,
    fetchImpl: async (url, init) => {
      if (String(url).includes('/siteverify')) {
        const form = new URLSearchParams(init.body);
        assert.equal(form.get('response'), 'one-time-token');
        assert.equal(form.get('remoteip'), '203.0.113.9');
        return json({
          success: true,
          action: 'book',
          hostname: 'www.insuresprhealth.co.za',
        });
      }
      upstreamCalls.push({ url: String(url), init });
      return json({ booking: { reference: 'ISR-TEST' } }, 201);
    },
  });

  const response = await handler(
    new Request('https://www.insuresprhealth.co.za/api/insurespr?route=bookings', {
      method: 'POST',
      headers: {
        Origin: 'https://www.insuresprhealth.co.za',
        'Content-Type': 'application/json',
        'X-Vercel-Forwarded-For': '203.0.113.9',
      },
      body: rawBody,
    }),
  );

  assert.equal(response.status, 201);
  assert.equal(upstreamCalls.length, 1);
  const { url, init } = upstreamCalls[0];
  assert.match(url, /insurespr-api\/bookings$/);
  assert.equal(init.body, rawBody);

  const headers = init.headers;
  const bodyHash = await crypto.subtle.digest('SHA-256', Buffer.from(rawBody));
  const canonical = attestationCanonical({
    method: 'POST',
    route: '/bookings',
    timestamp: headers.get('x-insurespr-attestation-timestamp'),
    nonce: headers.get('x-insurespr-attestation-nonce'),
    bodyHash: Buffer.from(bodyHash).toString('hex'),
    ipHash: headers.get('x-insurespr-attestation-ip-hash'),
    origin: 'https://www.insuresprhealth.co.za',
    action: 'book',
  });
  assert.equal(
    verify(
      null,
      Buffer.from(canonical),
      publicKey,
      Buffer.from(headers.get('x-insurespr-attestation-signature'), 'base64url'),
    ),
    true,
  );
});

test('protected requests fail closed on a Turnstile action mismatch', async () => {
  const { privateKeyB64 } = testKeys();
  let upstreamCalls = 0;
  const handler = createBridgeHandler({
    env: {
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'secret-key',
      INSURESPR_PROXY_PRIVATE_KEY_B64: privateKeyB64,
    },
    fetchImpl: async (url) => {
      if (String(url).includes('/siteverify')) {
        return json({ success: true, action: 'contact', hostname: 'www.insuresprhealth.co.za' });
      }
      upstreamCalls += 1;
      return json({});
    },
  });
  const response = await handler(
    new Request('https://www.insuresprhealth.co.za/api/insurespr?route=bookings', {
      method: 'POST',
      headers: {
        Origin: 'https://www.insuresprhealth.co.za',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ turnstile_token: 'one-time-token' }),
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'BOT_CHECK_FAILED');
  assert.equal(upstreamCalls, 0);
});

test('the bridge rejects aliases and cross-origin submissions', async () => {
  const handler = createBridgeHandler({ fetchImpl: async () => json({}) });
  const response = await handler(
    new Request('https://insurespr.vercel.app/api/insurespr?route=services'),
  );
  assert.equal(response.status, 403);
});
