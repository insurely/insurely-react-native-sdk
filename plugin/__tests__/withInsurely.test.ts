// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it } from '@jest/globals';
import {
  addBankIdQueries,
  addBankIdScheme,
  addAndroidQueries,
  type InsurelyAndroidManifest,
} from '../withInsurely';

describe('addBankIdQueries', () => {
  it('adds the bankid scheme so canOpenURL can succeed on iOS', () => {
    expect(addBankIdQueries({}).LSApplicationQueriesSchemes).toEqual([
      'bankid',
    ]);
  });

  it('does not duplicate an existing entry', () => {
    const result = addBankIdQueries({
      LSApplicationQueriesSchemes: ['bankid', 'mitid'],
    });
    expect(result.LSApplicationQueriesSchemes).toEqual(['bankid', 'mitid']);
  });

  it('preserves unrelated schemes', () => {
    expect(
      addBankIdQueries({ LSApplicationQueriesSchemes: ['other'] })
        .LSApplicationQueriesSchemes
    ).toEqual(['other', 'bankid']);
  });
});

describe('addBankIdScheme', () => {
  it('registers the redirect scheme as a url type', () => {
    const result = addBankIdScheme({}, 'myapp');
    expect(result.CFBundleURLTypes).toEqual([
      { CFBundleURLSchemes: ['myapp'] },
    ]);
  });

  it('leaves the plist untouched when no scheme is configured', () => {
    expect(addBankIdScheme({}, undefined)).toEqual({});
  });

  it('does not duplicate an already registered scheme', () => {
    const existing = { CFBundleURLTypes: [{ CFBundleURLSchemes: ['myapp'] }] };
    expect(addBankIdScheme(existing, 'myapp')).toEqual(existing);
  });

  it('appends the scheme when CFBundleURLTypes contains an unrelated scheme', () => {
    const existing = {
      CFBundleURLTypes: [{ CFBundleURLSchemes: ['com.example.deeplink'] }],
    };
    const result = addBankIdScheme(existing, 'myapp');
    expect(result.CFBundleURLTypes).toEqual([
      { CFBundleURLSchemes: ['com.example.deeplink'] },
      { CFBundleURLSchemes: ['myapp'] },
    ]);
  });

  it('remains idempotent when appending to an existing unrelated scheme', () => {
    const existing = {
      CFBundleURLTypes: [{ CFBundleURLSchemes: ['com.example.deeplink'] }],
    };
    const first = addBankIdScheme(existing, 'myapp');
    const second = addBankIdScheme(first, 'myapp');
    expect(second).toEqual(first);
  });
});

describe('addAndroidQueries', () => {
  it('adds a bankid intent query', () => {
    const manifest: InsurelyAndroidManifest = { manifest: {} };
    const result = addAndroidQueries(manifest);
    expect(
      result.manifest.queries![0]!.intent![0]!.data![0]!.$!['android:scheme']
    ).toBe('bankid');
  });

  it('is idempotent', () => {
    const manifest: InsurelyAndroidManifest = { manifest: {} };
    expect(
      addAndroidQueries(addAndroidQueries(manifest)).manifest.queries
    ).toHaveLength(1);
  });

  it('appends the bankid intent when manifest already has an unrelated queries entry', () => {
    const manifest: InsurelyAndroidManifest = {
      manifest: {
        queries: [
          {
            package: [{ $: { 'android:name': 'com.example.package' } }],
          },
        ],
      },
    };
    const result = addAndroidQueries(manifest);
    expect(result.manifest.queries).toHaveLength(2);
    expect(
      result.manifest.queries![1]!.intent![0]!.data![0]!.$!['android:scheme']
    ).toBe('bankid');
  });

  it('remains idempotent when appending to an unrelated queries entry', () => {
    const manifest: InsurelyAndroidManifest = {
      manifest: {
        queries: [
          {
            package: [{ $: { 'android:name': 'com.example.package' } }],
          },
        ],
      },
    };
    const first = addAndroidQueries(manifest);
    const second = addAndroidQueries(first);
    expect(second.manifest.queries).toHaveLength(2);
    expect(first).toEqual(second);
  });
});
