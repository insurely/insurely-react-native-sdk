// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it } from '@jest/globals';
import { buildBankIdUrl } from '../bankId';

describe('buildBankIdUrl', () => {
  it('returns the url unchanged when no redirect is configured', () => {
    expect(buildBankIdUrl('bankid:///?autostarttoken=abc')).toBe(
      'bankid:///?autostarttoken=abc'
    );
  });

  it('appends an encoded redirect parameter', () => {
    expect(buildBankIdUrl('bankid:///?autostarttoken=abc', 'myapp:///')).toBe(
      'bankid:///?autostarttoken=abc&redirect=myapp%3A%2F%2F%2F'
    );
  });

  it('encodes characters encodeURIComponent would leave alone', () => {
    // Swift allows only alphanumerics and "."; hyphen and underscore must encode.
    expect(buildBankIdUrl('bankid:///', 'my-app_x://cb')).toBe(
      'bankid:///?redirect=my%2Dapp%5Fx%3A%2F%2Fcb'
    );
  });

  it('keeps dots unencoded', () => {
    expect(buildBankIdUrl('bankid:///', 'https://a.example')).toContain(
      'a.example'
    );
  });

  it('replaces any redirect the web app already put on the url', () => {
    expect(
      buildBankIdUrl('bankid:///?autostarttoken=abc&redirect=null', 'myapp:///')
    ).toBe('bankid:///?autostarttoken=abc&redirect=myapp%3A%2F%2F%2F');
  });

  it('strips an existing redirect even when none is configured', () => {
    expect(buildBankIdUrl('bankid:///?autostarttoken=abc&redirect=null')).toBe(
      'bankid:///?autostarttoken=abc'
    );
  });

  it('handles a url with no query string', () => {
    expect(buildBankIdUrl('bankid:///', 'myapp:///')).toBe(
      'bankid:///?redirect=myapp%3A%2F%2F%2F'
    );
  });
});
