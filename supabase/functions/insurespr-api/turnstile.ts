export type TurnstileVerification = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

export function matchesTurnstileContext(
  result: TurnstileVerification,
  expectedAction: string,
  allowedOrigin: string | null,
): boolean {
  if (!allowedOrigin) return false;

  let expectedHostname: string;
  try {
    expectedHostname = new URL(allowedOrigin).hostname;
  } catch {
    return false;
  }

  return result.success === true &&
    result.action === expectedAction &&
    result.hostname === expectedHostname;
}
