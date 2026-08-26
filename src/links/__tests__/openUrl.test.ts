// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Linking } from 'react-native';
import type { OpenUrlKind } from '../../types/events';
import { performAction } from '../openUrl';

jest.mock('react-native', () => ({
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
}));

// `@jest/globals`' `jest.Mock` defaults its generic to a function returning
// `unknown`, so `mockResolvedValue`/`mockReturnValue` would otherwise only
// accept `never`. Pinning the real signatures keeps the mocks usable under
// strict mode without changing any assertion below.
type CanOpenURL = (url: string) => Promise<boolean>;
type OpenURL = (url: string) => Promise<void>;
type OnOpenUrl = (url: string, kind: OpenUrlKind) => boolean;

const canOpenURL = Linking.canOpenURL as jest.Mock<CanOpenURL>;
const openURL = Linking.openURL as jest.Mock<OpenURL>;

beforeEach(() => {
  jest.clearAllMocks();
  canOpenURL.mockResolvedValue(true);
  openURL.mockResolvedValue(undefined);
});

describe('performAction', () => {
  it('opens BankID with the configured redirect appended', async () => {
    const error = await performAction(
      { kind: 'bankid', url: 'bankid:///?autostarttoken=abc' },
      { bankIdRedirectUrl: 'myapp:///' }
    );
    expect(error).toBeNull();
    expect(openURL).toHaveBeenCalledWith(
      'bankid:///?autostarttoken=abc&redirect=myapp%3A%2F%2F%2F'
    );
  });

  it('reports BANKID_NOT_INSTALLED when the app cannot be opened', async () => {
    canOpenURL.mockResolvedValue(false);
    const error = await performAction(
      { kind: 'bankid', url: 'bankid:///' },
      {}
    );
    expect(error).toEqual({ code: 'BANKID_NOT_INSTALLED', url: 'bankid:///' });
    expect(openURL).not.toHaveBeenCalled();
  });

  it('reports AUTH_APP_NOT_AVAILABLE for the other auth methods', async () => {
    canOpenURL.mockResolvedValue(false);
    const error = await performAction({ kind: 'mitid', url: 'mitid://x' }, {});
    expect(error).toEqual({ code: 'AUTH_APP_NOT_AVAILABLE', url: 'mitid://x' });
  });

  it('opens browser and redirect urls without a canOpenURL gate', async () => {
    canOpenURL.mockResolvedValue(false);
    expect(
      await performAction({ kind: 'browser', url: 'https://example.com' }, {})
    ).toBeNull();
    expect(openURL).toHaveBeenCalledWith('https://example.com');
  });

  it('lets the integrator take over', async () => {
    const onOpenUrl = jest.fn<OnOpenUrl>().mockReturnValue(true);
    const error = await performAction(
      { kind: 'browser', url: 'https://example.com' },
      { onOpenUrl }
    );
    expect(error).toBeNull();
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com', 'browser');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('passes the fully built BankID url to the integrator, not the raw one', async () => {
    const onOpenUrl = jest.fn<OnOpenUrl>().mockReturnValue(true);
    await performAction(
      { kind: 'bankid', url: 'bankid:///' },
      { bankIdRedirectUrl: 'myapp:///', onOpenUrl }
    );
    expect(onOpenUrl).toHaveBeenCalledWith(
      'bankid:///?redirect=myapp%3A%2F%2F%2F',
      'bankid'
    );
  });

  it('still opens when the integrator declines to handle it', async () => {
    const onOpenUrl = jest.fn<OnOpenUrl>().mockReturnValue(false);
    await performAction(
      { kind: 'redirect', url: 'https://example.com' },
      { onOpenUrl }
    );
    expect(openURL).toHaveBeenCalledWith('https://example.com');
  });

  it('reports a failure to open as an error rather than rejecting', async () => {
    openURL.mockRejectedValue(new Error('nope'));
    const error = await performAction({ kind: 'mitid', url: 'mitid://x' }, {});
    expect(error).toEqual({ code: 'AUTH_APP_NOT_AVAILABLE', url: 'mitid://x' });
  });

  it('gates auth-app and reports AUTH_APP_NOT_AVAILABLE when unavailable', async () => {
    canOpenURL.mockResolvedValue(false);
    const error = await performAction(
      { kind: 'auth-app', url: 'auth-app://x' },
      {}
    );
    expect(error).toEqual({
      code: 'AUTH_APP_NOT_AVAILABLE',
      url: 'auth-app://x',
    });
    expect(openURL).not.toHaveBeenCalled();
  });

  it('does not gate companion-app and opens it even when canOpenURL is false', async () => {
    canOpenURL.mockResolvedValue(false);
    const error = await performAction(
      { kind: 'companion-app', url: 'https://companion.example.com' },
      {}
    );
    expect(error).toBeNull();
    expect(openURL).toHaveBeenCalledWith('https://companion.example.com');
  });

  it('treats onOpenUrl throwing as declined to handle', async () => {
    const onOpenUrl = jest.fn<OnOpenUrl>().mockImplementation(() => {
      throw new Error('callback failure');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const error = await performAction(
        { kind: 'browser', url: 'https://example.com' },
        { onOpenUrl }
      );
      expect(error).toBeNull();
      expect(onOpenUrl).toHaveBeenCalledWith('https://example.com', 'browser');
      expect(openURL).toHaveBeenCalledWith('https://example.com');
      expect(warnSpy).toHaveBeenCalledWith(
        '[Insurely] onOpenUrl threw; treating as declined to handle',
        expect.any(Error)
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
