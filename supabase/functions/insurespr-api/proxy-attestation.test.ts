import {
  proxyAttestationCanonical,
  ProxyAttestationError,
  verifyProxyAttestation,
} from './proxy-attestation.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function base64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.test('signed proxy attestations verify once and preserve their trusted rate-limit hash', async () => {
  const now = 1_787_990_400_000;
  const body = { turnstile_token: 'one-time-token', privacy_accepted: true };
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = base64Url(await crypto.subtle.exportKey('spki', pair.publicKey));
  const timestamp = String(Math.floor(now / 1_000));
  const nonce = '123e4567-e89b-42d3-a456-426614174000';
  const ipHash = 'a'.repeat(64);
  const bodyHash = hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body))),
  );
  const canonical = proxyAttestationCanonical({
    method: 'POST',
    route: '/bookings',
    timestamp,
    nonce,
    bodyHash,
    ipHash,
    origin: 'https://www.insuresprhealth.co.za',
    action: 'book',
  });
  const signature = base64Url(
    await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(canonical)),
  );
  const headers = {
    Origin: 'https://www.insuresprhealth.co.za',
    'Content-Type': 'application/json',
    'x-insurespr-attestation-version': 'v1',
    'x-insurespr-attestation-timestamp': timestamp,
    'x-insurespr-attestation-nonce': nonce,
    'x-insurespr-attestation-ip-hash': ipHash,
    'x-insurespr-attestation-action': 'book',
    'x-insurespr-attestation-signature': signature,
  };
  let claims = 0;
  const claimNonce = () => Promise.resolve(++claims === 1);
  const request = new Request('https://project.supabase.co/functions/v1/insurespr-api/bookings', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const verified = await verifyProxyAttestation(
    request,
    body,
    'book',
    'https://www.insuresprhealth.co.za',
    claimNonce,
    { publicKeySpkiBase64: publicKey, now: () => now },
  );
  assertEquals(verified?.ipHash, ipHash);
  assertEquals(claims, 1);

  let replayError: unknown;
  try {
    await verifyProxyAttestation(
      request,
      body,
      'book',
      'https://www.insuresprhealth.co.za',
      claimNonce,
      { publicKeySpkiBase64: publicKey, now: () => now },
    );
  } catch (error) {
    replayError = error;
  }
  assertEquals((replayError as ProxyAttestationError).code, 'PROXY_ATTESTATION_REPLAYED');
});

Deno.test('body tampering invalidates the signed proxy attestation before nonce claim', async () => {
  const now = 1_787_990_400_000;
  const signedBody = { turnstile_token: 'original' };
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = base64Url(await crypto.subtle.exportKey('spki', pair.publicKey));
  const timestamp = String(Math.floor(now / 1_000));
  const nonce = '123e4567-e89b-42d3-a456-426614174001';
  const ipHash = 'b'.repeat(64);
  const bodyHash = hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(signedBody))),
  );
  const canonical = proxyAttestationCanonical({
    method: 'POST',
    route: '/bookings',
    timestamp,
    nonce,
    bodyHash,
    ipHash,
    origin: 'https://www.insuresprhealth.co.za',
    action: 'book',
  });
  const signature = base64Url(
    await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(canonical)),
  );
  const request = new Request('https://project.supabase.co/functions/v1/insurespr-api/bookings', {
    method: 'POST',
    headers: {
      'x-insurespr-attestation-version': 'v1',
      'x-insurespr-attestation-timestamp': timestamp,
      'x-insurespr-attestation-nonce': nonce,
      'x-insurespr-attestation-ip-hash': ipHash,
      'x-insurespr-attestation-action': 'book',
      'x-insurespr-attestation-signature': signature,
    },
  });
  let claims = 0;
  let thrown: unknown;
  try {
    await verifyProxyAttestation(
      request,
      { turnstile_token: 'tampered' },
      'book',
      'https://www.insuresprhealth.co.za',
      () => {
        claims += 1;
        return Promise.resolve(true);
      },
      { publicKeySpkiBase64: publicKey, now: () => now },
    );
  } catch (error) {
    thrown = error;
  }
  assertEquals((thrown as ProxyAttestationError).code, 'PROXY_ATTESTATION_INVALID');
  assertEquals(claims, 0);
});
