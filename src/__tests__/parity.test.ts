// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it } from '@jest/globals';
import { buildInjectedScript } from '../bridge/injected';
import swedbank from './__fixtures__/parity/swedbank-test.json';
import fullCustomization from './__fixtures__/parity/full-customization.json';

/**
 * Recovers the object the injected script assigns to `window.insurely`.
 *
 * This extracts the *actual* rendered payload from `buildInjectedScript`'s
 * output rather than reconstructing the expected string by hand, so the test
 * exercises the real escaping and envelope-assembly logic instead of merely
 * echoing it back.
 */
function injectedPayload(config: unknown, prefill: unknown): unknown {
  const script = buildInjectedScript({
    baseUrl: 'https://blocks.test.insurely.com',
    config: config as never,
    prefill: prefill as never,
  });
  const match = /window\.insurely = (\{[\s\S]*?\});\n/.exec(script);
  if (!match) throw new Error('window.insurely assignment not found');
  return JSON.parse(
    match[1]!.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')
  );
}

describe('parity with the iOS and Android SDKs', () => {
  // Fixtures were derived by reading the native serializers (see the
  // sibling .md file next to each fixture for field-by-field provenance),
  // not captured from a live run of the iOS/Android sample apps.
  it.each([
    ['swedbank test integration', swedbank],
    ['full customization', fullCustomization],
  ])(
    'injects the same window.insurely payload as native for %s',
    (_name, fixture) => {
      const payload = injectedPayload(
        fixture.config,
        fixture.prefill
      ) as Record<string, unknown>;
      expect(payload.config).toEqual(fixture.config);
      expect(payload.prefill).toEqual(fixture.prefill);
    }
  );

  it('omits prefill entirely when none is given', () => {
    const payload = injectedPayload(swedbank.config, undefined) as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('prefill');
  });
});
