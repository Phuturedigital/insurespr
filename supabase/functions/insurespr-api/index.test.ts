import { type ApiDependencyOverrides, createHandler, readDbJson, verifyTurnstile } from './index.ts';

type JsonRecord = Record<string, unknown>;

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

async function responseBody(response: Response): Promise<JsonRecord> {
  return await response.json() as JsonRecord;
}

async function assertDbErrorMapping(
  databaseError: JsonRecord,
  status: number,
  code: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await readDbJson(
      new Response(JSON.stringify(databaseError), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  } catch (error) {
    thrown = error;
  }
  const apiError = thrown as { status?: number; code?: string };
  assertEquals(apiError?.status, status);
  assertEquals(apiError?.code, code);
}

for (
  const scenario of [
    { name: 'official origin', origin: 'https://insuresprhealth.co.za' },
    { name: 'spoofed localhost origin', origin: 'http://localhost:5177' },
    { name: 'absent origin', origin: null },
    { name: 'arbitrary command client origin', origin: 'https://command-client.invalid' },
  ]
) {
  Deno.test(`pending privacy rejects ${scenario.name} before request side effects`, async () => {
    let policyReads = 0;
    let turnstileCalls = 0;
    let rateLimitCalls = 0;
    let rpcCalls = 0;

    const overrides: ApiDependencyOverrides = {
      getAllowedOrigins: () =>
        new Set([
          'https://insuresprhealth.co.za',
          'https://www.insuresprhealth.co.za',
        ]),
      dbFetch: (path) => {
        policyReads += 1;
        assertEquals(
          path,
          'practice_settings?select=privacy_notice_version&id=eq.primary&limit=1',
        );
        return Promise.resolve(
          new Response(JSON.stringify([{ privacy_notice_version: 'pending-approval' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
      verifyTurnstile: () => {
        turnstileCalls += 1;
        return Promise.resolve(null);
      },
      enforceRateLimit: () => {
        rateLimitCalls += 1;
        return Promise.resolve('must-not-be-used');
      },
      rpc: <T>() => {
        rpcCalls += 1;
        return Promise.resolve(null as T);
      },
      requestId: () => 'test-request-id',
    };

    const headers = new Headers();
    if (scenario.origin) headers.set('Origin', scenario.origin);
    const response = await createHandler(overrides)(
      new Request('https://project.supabase.co/functions/v1/insurespr-api/bookings', {
        method: 'POST',
        headers,
      }),
    );
    const body = await responseBody(response);
    const error = body.error as JsonRecord;

    assertEquals(response.status, 503);
    assertEquals(error.code, 'PRIVACY_NOTICE_NOT_READY');
    assertEquals(body.request_id, 'test-request-id');
    assertEquals(policyReads, 1);
    assertEquals(turnstileCalls, 0);
    assertEquals(rateLimitCalls, 0);
    assertEquals(rpcCalls, 0);
    assertEquals(
      response.headers.get('Access-Control-Allow-Origin'),
      scenario.origin === 'https://insuresprhealth.co.za' ? scenario.origin : null,
    );
  });
}

Deno.test('database privacy-version errors map to stable API errors', async () => {
  await assertDbErrorMapping(
    { code: 'PVP01', message: 'displayed privacy notice changed' },
    409,
    'PRIVACY_NOTICE_CHANGED',
  );
  await assertDbErrorMapping(
    { code: '55000', message: 'privacy notice version is not approved' },
    503,
    'PRIVACY_NOTICE_NOT_READY',
  );
});

Deno.test('Turnstile fails closed when both production keys are absent', async () => {
  let thrown: unknown;
  try {
    await verifyTurnstile(
      {},
      new Request('https://project.supabase.co/functions/v1/insurespr-api/bookings'),
      'book',
      'https://insuresprhealth.co.za',
      {},
    );
  } catch (error) {
    thrown = error;
  }
  const apiError = thrown as { status?: number; code?: string };
  assertEquals(apiError?.status, 503);
  assertEquals(apiError?.code, 'BOT_CHECK_UNAVAILABLE');
});

Deno.test('default cloud Origin allowlist contains only the exact official hosts', async () => {
  const expected = new Set([
    'https://insuresprhealth.co.za',
    'https://www.insuresprhealth.co.za',
  ]);
  const response = await createHandler({ requestId: () => 'origin-test' })(
    new Request('https://project.supabase.co/functions/v1/insurespr-api/', {
      headers: { Origin: 'https://insurespr.vercel.app' },
    }),
  );
  assertEquals(response.status, 403);

  for (const origin of expected) {
    const allowed = await createHandler({ requestId: () => 'origin-test' })(
      new Request('https://project.supabase.co/functions/v1/insurespr-api/', {
        headers: { Origin: origin },
      }),
    );
    assertEquals(allowed.status, 200);
    assertEquals(allowed.headers.get('Access-Control-Allow-Origin'), origin);
  }
});

for (
  const scenario of [
    { route: 'bookings', rpcName: 'create_booking' },
    { route: 'employer-leads', rpcName: 'create_employer_lead' },
    { route: 'contact-enquiries', rpcName: 'create_contact_enquiry' },
  ]
) {
  Deno.test(`${scenario.route} forwards the displayed privacy version unchanged`, async () => {
    const displayedVersion = 'privacy-2026-08-13-approved';
    let capturedRpc = '';
    let capturedTrustedRateLimitHash: string | null | undefined;
    const capturedPayloads: JsonRecord[] = [];
    const handler = createHandler({
      getAllowedOrigins: () => new Set(['https://www.insuresprhealth.co.za']),
      dbFetch: () =>
        Promise.resolve(
          new Response(JSON.stringify([{ privacy_notice_version: displayedVersion }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      verifyTurnstile: () => Promise.resolve('trusted-proxy-ip-hash'),
      enforceRateLimit: (_req, _endpoint, _limit, _windowSeconds, trustedKeyHash) => {
        capturedTrustedRateLimitHash = trustedKeyHash;
        return Promise.resolve('test-ip-hash');
      },
      rpc: <T>(name: string, payload: JsonRecord) => {
        capturedRpc = name;
        capturedPayloads.push(payload);
        return Promise.resolve({ idempotent: false } as T);
      },
      requestId: () => 'privacy-forward-test',
    });

    const response = await handler(
      new Request(
        `https://project.supabase.co/functions/v1/insurespr-api/${scenario.route}`,
        {
          method: 'POST',
          headers: {
            Origin: 'https://www.insuresprhealth.co.za',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            privacy_version: displayedVersion,
            privacy_accepted: true,
          }),
        },
      ),
    );

    assertEquals(response.status, 201);
    assertEquals(capturedRpc, scenario.rpcName);
    const rpcPayload = capturedPayloads[0]?.p_payload as JsonRecord;
    assertEquals(rpcPayload.privacy_version, displayedVersion);
    assertEquals(capturedTrustedRateLimitHash, 'trusted-proxy-ip-hash');
  });
}
