import { matchesTurnstileContext } from './turnstile.ts';

function assertEquals(actual: boolean, expected: boolean): void {
  if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
}

Deno.test('Turnstile context accepts an exact action and origin hostname', () => {
  for (const action of ['book', 'employer', 'contact']) {
    assertEquals(
      matchesTurnstileContext(
        { success: true, action, hostname: 'insuresprhealth.co.za' },
        action,
        'https://insuresprhealth.co.za',
      ),
      true,
    );
  }
});

Deno.test('Turnstile context rejects a token minted for another form action', () => {
  assertEquals(
    matchesTurnstileContext(
      { success: true, action: 'contact', hostname: 'insuresprhealth.co.za' },
      'book',
      'https://insuresprhealth.co.za',
    ),
    false,
  );
});

Deno.test('Turnstile context rejects a token minted on another hostname', () => {
  assertEquals(
    matchesTurnstileContext(
      { success: true, action: 'book', hostname: 'insurespr.vercel.app' },
      'book',
      'https://insuresprhealth.co.za',
    ),
    false,
  );
});

Deno.test('Turnstile context rejects failed, incomplete and originless results', () => {
  assertEquals(
    matchesTurnstileContext(
      { success: false, action: 'book', hostname: 'insuresprhealth.co.za' },
      'book',
      'https://insuresprhealth.co.za',
    ),
    false,
  );
  assertEquals(matchesTurnstileContext({ success: true }, 'book', 'https://insuresprhealth.co.za'), false);
  assertEquals(
    matchesTurnstileContext(
      { success: true, action: 'book', hostname: 'insuresprhealth.co.za' },
      'book',
      null,
    ),
    false,
  );
});
