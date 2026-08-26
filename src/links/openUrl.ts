// Copyright © 2026 Insurely AB. All rights reserved.

import { Linking } from 'react-native';

import type { OpenUrlAction } from '../bridge/parse';
import type { InsurelyError, OpenUrlKind } from '../types/events';
import { buildBankIdUrl } from './bankId';

export interface PerformActionOptions {
  bankIdRedirectUrl?: string;
  onOpenUrl?: (url: string, kind: OpenUrlKind) => boolean;
}

/** Auth apps are checked first so a missing app becomes a clear SDK error. */
const REQUIRES_INSTALLED_APP: readonly OpenUrlKind[] = [
  'bankid',
  'mitid',
  'auth-app',
];

export async function performAction(
  action: OpenUrlAction,
  { bankIdRedirectUrl, onOpenUrl }: PerformActionOptions
): Promise<InsurelyError | null> {
  const url =
    action.kind === 'bankid'
      ? buildBankIdUrl(action.url, bankIdRedirectUrl)
      : action.url;

  try {
    if (onOpenUrl?.(url, action.kind)) return null;
  } catch (error) {
    // A throwing callback is treated as declining to handle the URL, so the flow
    // stays deterministic and performAction never rejects. Surface it, though —
    // silently swallowing it makes a broken callback impossible to diagnose.
    console.warn(
      '[Insurely] onOpenUrl threw; treating as declined to handle',
      error
    );
  }

  const notAvailable: InsurelyError =
    action.kind === 'bankid'
      ? { code: 'BANKID_NOT_INSTALLED', url: action.url }
      : { code: 'AUTH_APP_NOT_AVAILABLE', url: action.url };

  if (REQUIRES_INSTALLED_APP.includes(action.kind)) {
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (!canOpen) return notAvailable;
  }

  try {
    await Linking.openURL(url);
    return null;
  } catch {
    return REQUIRES_INSTALLED_APP.includes(action.kind) ? notAvailable : null;
  }
}
