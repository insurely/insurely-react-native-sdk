// Copyright © 2026 Insurely AB. All rights reserved.

/**
 * Ported from `SwedishBankID.open(url:redirectURL:)` in the iOS SDK.
 *
 * BankID requires the redirect value percent-encoded far more aggressively than
 * standard URL encoding: everything except alphanumerics and `.`. The iOS SDK
 * works around Foundation's laxer encoding with a placeholder substitution; here
 * the query string is built directly, which achieves the same result.
 *
 * Note: fragments (`#...`) are not handled separately; if present, they fold
 * into the last query parameter's value. This is acceptable because the BankID
 * deep links produced by Blocks do not include fragments.
 */
export function buildBankIdUrl(url: string, redirectUrl?: string): string {
  const [base, query = ''] = splitOnce(url, '?');

  const params = query
    .split('&')
    .filter((pair) => pair.length > 0 && !pair.startsWith('redirect='));

  if (redirectUrl !== undefined) {
    params.push(`redirect=${encodeBankIdValue(redirectUrl)}`);
  }

  return params.length > 0 ? `${base}?${params.join('&')}` : base;
}

function splitOnce(value: string, separator: string): [string, string?] {
  const index = value.indexOf(separator);
  if (index === -1) return [value];
  return [value.slice(0, index), value.slice(index + 1)];
}

function encodeBankIdValue(value: string): string {
  // encodeURIComponent leaves -_.!~*'() alone; BankID needs all but "." encoded.
  return encodeURIComponent(value).replace(
    /[!'()*\-_~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
