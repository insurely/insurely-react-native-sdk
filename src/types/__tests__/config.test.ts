// Copyright © 2026 Insurely AB. All rights reserved.

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  validateSettings,
  warnOnUnreachableResults,
  type InsurelyConfig,
} from '../config';

const valid: InsurelyConfig = {
  customerId: '00000000-0000-4000-8000-000000000000',
  configName: 'example-integration',
};

describe('validateSettings', () => {
  it('accepts a minimal config', () => {
    expect(() => validateSettings(valid)).not.toThrow();
  });

  it('accepts every language Blocks supports', () => {
    for (const language of [
      'da',
      'de',
      'en',
      'et',
      'fr',
      'it',
      'lt',
      'lv',
      'no',
      'ru',
      'sv',
    ] as const) {
      expect(() => validateSettings({ ...valid, language })).not.toThrow();
    }
  });

  it('accepts fields the native SDKs never exposed', () => {
    expect(() =>
      validateSettings(
        {
          ...valid,
          authToken: 'token',
          scrollToTopOffset: 24,
          disableAutomaticScrolling: true,
          dataAggregation: { referenceId: 'ref-1', advisorHandle: 'advisor' },
        },
        {
          customer: { email: 'a@b.com' },
          user: { email: 'a@b.com', swedishPersonalNumber: '199001011234' },
          dataAggregation: {
            filter: { rules: [{ field: 'registrationNo', value: 'ABC123' }] },
          },
        }
      )
    ).not.toThrow();
  });

  it('accepts the locking prefill form', () => {
    expect(() =>
      validateSettings(valid, {
        user: { username: { value: 'u', inputField: 'disabled' } },
      })
    ).not.toThrow();
  });

  it('rejects an unknown key with a readable path', () => {
    // @ts-expect-error deliberately invalid
    expect(() => validateSettings({ ...valid, notAField: true })).toThrow(
      /notAField/
    );
  });

  it('rejects an unsupported language', () => {
    // @ts-expect-error deliberately invalid
    expect(() => validateSettings({ ...valid, language: 'xx' })).toThrow(
      /language/
    );
  });

  it('is a no-op outside __DEV__', () => {
    const original = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    try {
      expect(() =>
        // @ts-expect-error deliberately invalid
        validateSettings({ ...valid, notAField: true })
      ).not.toThrow();
    } finally {
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = original;
    }
  });
});

describe('warnOnUnreachableResults', () => {
  const warn = jest
    .spyOn(console, 'warn')
    .mockImplementation(() => undefined) as jest.Mock<
    (...args: unknown[]) => void
  >;

  afterEach(() => {
    warn.mockClear();
  });

  it('warns when sendPostMessages is false and onResults is set', () => {
    warnOnUnreachableResults(false, true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/sendPostMessages/);
    expect(String(warn.mock.calls[0]![0])).toMatch(/onResults/);
  });

  it('stays quiet without an onResults handler', () => {
    warnOnUnreachableResults(false, false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays quiet when sendPostMessages is unset or true', () => {
    warnOnUnreachableResults(undefined, true);
    warnOnUnreachableResults(true, true);
    expect(warn).not.toHaveBeenCalled();
  });
});
