// Copyright © 2026 Insurely AB. All rights reserved.

import {
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
} from '@expo/config-plugins';

export interface InsurelyPluginOptions {
  /** Your app's URL scheme, so BankID can return the user to your app. */
  bankIdRedirectScheme?: string;
}

/**
 * A minimal, structurally-compatible view of Info.plist. We only read and
 * write the handful of keys BankID needs, so we avoid depending on the full
 * (and much larger) plist type from `@expo/config-plugins` here.
 */
export interface InsurelyInfoPlist {
  LSApplicationQueriesSchemes?: string[];
  CFBundleURLTypes?: Array<{ CFBundleURLSchemes?: string[] }>;
  [key: string]: unknown;
}

interface AndroidManifestAttributes {
  [key: string]: string | undefined;
}

interface AndroidManifestData {
  $?: AndroidManifestAttributes;
}

interface AndroidManifestAction {
  $: AndroidManifestAttributes;
}

interface AndroidManifestIntent {
  action?: AndroidManifestAction[];
  data?: AndroidManifestData[];
}

interface AndroidManifestQuery {
  intent?: AndroidManifestIntent[];
  package?: Array<{ $: AndroidManifestAttributes }>;
}

/**
 * A minimal, structurally-compatible view of AndroidManifest.xml's parsed
 * form, scoped to the `<queries>` block BankID needs.
 */
export interface InsurelyAndroidManifest {
  manifest: {
    queries?: AndroidManifestQuery[];
    [key: string]: unknown;
  };
}

/** iOS refuses canOpenURL for undeclared schemes, so BankID must be declared. */
export function addBankIdQueries(plist: InsurelyInfoPlist): InsurelyInfoPlist {
  const schemes: string[] = plist.LSApplicationQueriesSchemes ?? [];
  if (schemes.includes('bankid')) return plist;
  return { ...plist, LSApplicationQueriesSchemes: [...schemes, 'bankid'] };
}

export function addBankIdScheme(
  plist: InsurelyInfoPlist,
  scheme?: string
): InsurelyInfoPlist {
  if (!scheme) return plist;

  const urlTypes: Array<{ CFBundleURLSchemes?: string[] }> =
    plist.CFBundleURLTypes ?? [];
  const alreadyRegistered = urlTypes.some((entry) =>
    entry.CFBundleURLSchemes?.includes(scheme)
  );
  if (alreadyRegistered) return plist;

  return {
    ...plist,
    CFBundleURLTypes: [...urlTypes, { CFBundleURLSchemes: [scheme] }],
  };
}

/** Android 11+ hides other packages unless the app declares a query for them. */
export function addAndroidQueries(
  manifest: InsurelyAndroidManifest
): InsurelyAndroidManifest {
  const root = manifest.manifest;
  const queries: AndroidManifestQuery[] = root.queries ?? [];

  const alreadyDeclared = queries.some((query) =>
    query.intent?.some((intent) =>
      intent.data?.some(
        (data) => data.$ != null && data.$['android:scheme'] === 'bankid'
      )
    )
  );
  if (alreadyDeclared) return manifest;

  queries.push({
    intent: [
      {
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': 'bankid' } }],
      },
    ],
  });

  root.queries = queries;
  return manifest;
}

const withInsurely: ConfigPlugin<InsurelyPluginOptions | undefined> = (
  config,
  options
) => {
  const scheme = options?.bankIdRedirectScheme;

  config = withInfoPlist(config, (plistConfig) => {
    plistConfig.modResults = addBankIdScheme(
      addBankIdQueries(plistConfig.modResults as unknown as InsurelyInfoPlist),
      scheme
    ) as unknown as typeof plistConfig.modResults;
    return plistConfig;
  });

  config = withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = addAndroidQueries(
      manifestConfig.modResults as unknown as InsurelyAndroidManifest
    ) as unknown as typeof manifestConfig.modResults;
    return manifestConfig;
  });

  return config;
};

export default withInsurely;
