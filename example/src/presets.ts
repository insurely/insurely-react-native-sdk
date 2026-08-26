// Copyright © 2026 Insurely AB. All rights reserved.

import type {
  InsurelyConfig,
  InsurelyEnvironment,
  InsurelyPrefill,
} from '@insurely/react-native-sdk';

export interface Preset {
  name: string;
  environment: InsurelyEnvironment;
  config: InsurelyConfig;
  prefill?: InsurelyPrefill;
}

// The real customerId/configName are not committed: this repository is public,
// and while neither value is a secret (both ship inside any binary built with
// the SDK), publishing a working test integration invites traffic against it.
//
// To run the example against a real config, create `example/.env`:
//
//   EXPO_PUBLIC_INSURELY_CUSTOMER_ID=...
//   EXPO_PUBLIC_INSURELY_CONFIG_NAME=...
//
// Expo inlines EXPO_PUBLIC_-prefixed variables at build time. `.env` is
// gitignored. Without it the app builds and runs, but Blocks rejects the
// placeholder config -- which is the expected result, not a bug.
const CUSTOMER_ID =
  process.env.EXPO_PUBLIC_INSURELY_CUSTOMER_ID ?? 'your-customer-id';
const CONFIG_NAME =
  process.env.EXPO_PUBLIC_INSURELY_CONFIG_NAME ?? 'your-config-name';

export const PRESETS: Preset[] = [
  {
    // The integration the Android sample app uses; the parity baseline.
    name: 'Swedbank (test)',
    environment: 'test',
    config: {
      customerId: CUSTOMER_ID,
      configName: CONFIG_NAME,
    },
  },
  {
    name: 'Swedbank (test) — dark',
    environment: 'test',
    config: {
      customerId: CUSTOMER_ID,
      configName: CONFIG_NAME,
      themeMode: 'dark',
    },
  },
  {
    name: 'Swedbank (test) — prefilled + locked',
    environment: 'test',
    config: {
      customerId: CUSTOMER_ID,
      configName: CONFIG_NAME,
    },
    prefill: { user: { swedishPersonalNumber: '199001011234' } },
  },
];
