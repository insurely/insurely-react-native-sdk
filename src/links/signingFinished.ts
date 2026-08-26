// Copyright © 2026 Insurely AB. All rights reserved.

import { AppState, type AppStateStatus } from 'react-native';

/**
 * One-shot: calls `onReturn` the first time the app comes back to the
 * foreground after having left it, then unsubscribes. Mirrors the
 * `visibilitychange` listener the Blocks web bootstrap registers when it
 * receives OPEN_SWEDISH_BANKID, and which it removes after firing once.
 */
export function watchForSigningFinished(onReturn: () => void): () => void {
  let left = false;
  let finished = false;

  const subscription = AppState.addEventListener(
    'change',
    (state: AppStateStatus) => {
      if (finished) return;

      if (state !== 'active') {
        left = true;
        return;
      }

      if (!left) return;

      finished = true;
      subscription.remove();
      onReturn();
    }
  );

  return () => {
    if (finished) return;
    finished = true;
    subscription.remove();
  };
}
