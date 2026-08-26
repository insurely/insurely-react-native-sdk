// Copyright © 2026 Insurely AB. All rights reserved.

export type InsurelyLogLevel = 'none' | 'error' | 'all';

const RANK: Record<InsurelyLogLevel, number> = { none: 0, error: 1, all: 2 };

/**
 * Redacts the fields that must never reach a log at any level. Compared
 * case-insensitively, because header names arrive in whatever casing the
 * server sent (`Set-Cookie`, `set-cookie`).
 *
 * The cookie and `response` entries are defence in depth. The SDK's own
 * injections no longer reach the bridge at all (see the invariant in
 * `bridge/parse.ts`), which is what used to feed a bank's response body and
 * `Set-Cookie` array back into this logger; these keys make the next such path
 * harmless rather than silent.
 *
 * `response` is deliberately broad: it redacts *any* key named `response`
 * anywhere in a payload, including one inside a diagnostic error payload that
 * would have been useful to read. That is the trade — a less informative log in
 * exchange for a bank's response body never reaching one by a route nobody
 * anticipated. Keep it broad rather than narrowing it to a known path.
 */
const SECRET_KEYS = [
  'swedishPersonalNumber',
  'norwegianPersonalNumber',
  'estonianPersonalNumber',
  'norwegianPhoneNumber',
  'estonianPhoneNumber',
  'personalNumber',
  'authToken',
  'token',
  'autostartToken',
  'Set-Cookie',
  'setCookie',
  'cookies',
  'cookie',
  'response',
].map((key) => key.toLowerCase());

/**
 * Matches strings that look like URLs (scheme://...) so their query string
 * can be masked before logging. BankID deep links conventionally embed the
 * autostart token in the query string itself, which key-based redaction
 * can never catch because it never inspects string contents.
 */
const URL_LIKE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Masks the query string of a URL-like value, keeping the scheme, host and
 * path intact for diagnosability. A URL's query is untrusted for logging
 * purposes — rather than enumerate every parameter name that might carry a
 * secret, the whole query is replaced with a marker when present.
 */
function redactUrlLike(value: string): string {
  if (!URL_LIKE.test(value)) return value;

  const queryIndex = value.search(/[?#]/);
  if (queryIndex === -1) return value;

  return `${value.slice(0, queryIndex)}?[redacted]`;
}

export function createLogger(level: InsurelyLogLevel) {
  return {
    trace(message: string, payload?: unknown) {
      if (RANK[level] < RANK.all) return;
      console.log(
        `[Insurely] ${message}`,
        payload === undefined ? '' : redact(payload)
      );
    },
    error(message: string, payload?: unknown) {
      if (RANK[level] < RANK.error) return;
      console.warn(
        `[Insurely] ${message}`,
        payload === undefined ? '' : redact(payload)
      );
    },
  };
}

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactUrlLike(value);
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object' || value === null) return value;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SECRET_KEYS.includes(key.toLowerCase())
      ? '[redacted]'
      : redact(nested);
  }
  return output;
}
