const ATTESTATION_HEADERS = [
  'x-insurespr-attestation-version',
  'x-insurespr-attestation-timestamp',
  'x-insurespr-attestation-nonce',
  'x-insurespr-attestation-ip-hash',
  'x-insurespr-attestation-action',
  'x-insurespr-attestation-signature',
] as const;

const DEFAULT_PUBLIC_KEY_SPKI_BASE64 = 'MCowBQYDK2VwAyEAdpN+OSzrxx0UUUoDeQAKyJBtjZ0sS6f9SYv/DBoBY/Y=';
const MAX_CLOCK_SKEW_SECONDS = 90;

export type ProxyAttestation = {
  ipHash: string;
  nonceHash: string;
  expiresAt: string;
};

export class ProxyAttestationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export function proxyAttestationCanonical(input: {
  method: string;
  route: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  ipHash: string;
  origin: string;
  action: string;
}): string {
  return [
    'v1',
    input.method,
    input.route,
    input.timestamp,
    input.nonce,
    input.bodyHash,
    input.ipHash,
    input.origin,
    input.action,
  ].join('\n');
}

export function hasProxyAttestation(req: Request): boolean {
  return ATTESTATION_HEADERS.some((name) => req.headers.has(name));
}

export async function verifyProxyAttestation(
  req: Request,
  body: Record<string, unknown>,
  expectedAction: string,
  allowedOrigin: string | null,
  claimNonce: (nonceHash: string, expiresAt: string) => Promise<boolean>,
  options: {
    publicKeySpkiBase64?: string;
    now?: () => number;
  } = {},
): Promise<ProxyAttestation | null> {
  if (!hasProxyAttestation(req)) return null;
  if (!allowedOrigin) {
    throw new ProxyAttestationError('PROXY_ATTESTATION_INVALID', 'The protected request origin is invalid.');
  }

  const values = Object.fromEntries(
    ATTESTATION_HEADERS.map((name) => [name, req.headers.get(name) || '']),
  );
  if (Object.values(values).some((value) => !value)) {
    throw new ProxyAttestationError('PROXY_ATTESTATION_INVALID', 'The protected request is incomplete.');
  }
  if (values['x-insurespr-attestation-version'] !== 'v1') {
    throw new ProxyAttestationError('PROXY_ATTESTATION_INVALID', 'The protected request version is invalid.');
  }

  const timestamp = values['x-insurespr-attestation-timestamp'];
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor((options.now || Date.now)() / 1_000);
  if (
    !/^\d{10}$/.test(timestamp) ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new ProxyAttestationError('PROXY_ATTESTATION_EXPIRED', 'The protected request expired.');
  }

  const nonce = values['x-insurespr-attestation-nonce'];
  const ipHash = values['x-insurespr-attestation-ip-hash'];
  const action = values['x-insurespr-attestation-action'];
  const signature = values['x-insurespr-attestation-signature'];
  if (!/^[0-9a-f-]{36}$/i.test(nonce) || !/^[0-9a-f]{64}$/.test(ipHash)) {
    throw new ProxyAttestationError(
      'PROXY_ATTESTATION_INVALID',
      'The protected request metadata is invalid.',
    );
  }
  if (action !== expectedAction || !/^[A-Za-z0-9_-]{80,100}$/.test(signature)) {
    throw new ProxyAttestationError('PROXY_ATTESTATION_INVALID', 'The protected request context is invalid.');
  }

  const routeByAction: Record<string, string> = {
    book: '/bookings',
    employer: '/employer-leads',
    contact: '/contact-enquiries',
  };
  const route = routeByAction[expectedAction];
  if (!route) {
    throw new ProxyAttestationError('PROXY_ATTESTATION_INVALID', 'The protected request action is invalid.');
  }

  const bodyHash = await sha256(JSON.stringify(body));
  const canonical = proxyAttestationCanonical({
    method: req.method.toUpperCase(),
    route,
    timestamp,
    nonce,
    bodyHash,
    ipHash,
    origin: allowedOrigin,
    action,
  });

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      decodeBase64(options.publicKeySpkiBase64 || DEFAULT_PUBLIC_KEY_SPKI_BASE64),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'Ed25519',
      key,
      decodeBase64(signature),
      new TextEncoder().encode(canonical),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new ProxyAttestationError(
      'PROXY_ATTESTATION_INVALID',
      'The protected request signature is invalid.',
    );
  }

  const nonceHash = await sha256(nonce);
  const expiresAt = new Date((timestampSeconds + MAX_CLOCK_SKEW_SECONDS) * 1_000).toISOString();
  if (!await claimNonce(nonceHash, expiresAt)) {
    throw new ProxyAttestationError('PROXY_ATTESTATION_REPLAYED', 'The protected request was already used.');
  }
  return { ipHash, nonceHash, expiresAt };
}
