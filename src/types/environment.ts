// Copyright © 2026 Insurely AB. All rights reserved.

/** Which Blocks deployment the WebView loads. */
export type InsurelyEnvironment =
  'production' | 'staging' | 'test' | { url: string };

const NAMED_ENVIRONMENTS = {
  production: 'https://blocks.insurely.com',
  staging: 'https://blocks.staging.insurely.com',
  test: 'https://blocks.test.insurely.com',
} as const;

export function resolveEnvironmentUrl(
  environment: InsurelyEnvironment
): string {
  const url =
    typeof environment === 'string'
      ? NAMED_ENVIRONMENTS[environment]
      : environment.url;
  return url.replace(/\/+$/, '');
}

/**
 * Insurely-hosted deployments serve the built bootstrap; a local Blocks dev
 * server serves the TypeScript source. Mirrors `Bootstrapper.assetFile` in the
 * iOS SDK.
 */
export function bootstrapAssetFile(
  baseUrl: string
): 'mobile-bootstrap.js' | 'mobile-bootstrap.ts' {
  // Extract hostname from URL. Use regex since URL may not be available in
  // all React Native runtimes.
  const hostMatch = baseUrl.match(/^https?:\/\/([^/:?#]+)/);
  if (!hostMatch || !hostMatch[1]) return 'mobile-bootstrap.ts';
  const host = hostMatch[1];
  const isInsurelyHost =
    host === 'insurely.com' || host.endsWith('.insurely.com');
  return isInsurelyHost ? 'mobile-bootstrap.js' : 'mobile-bootstrap.ts';
}
