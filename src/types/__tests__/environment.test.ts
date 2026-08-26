// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it } from '@jest/globals';
import { resolveEnvironmentUrl, bootstrapAssetFile } from '../environment';

describe('resolveEnvironmentUrl', () => {
  it('maps named environments', () => {
    expect(resolveEnvironmentUrl('production')).toBe(
      'https://blocks.insurely.com'
    );
    expect(resolveEnvironmentUrl('staging')).toBe(
      'https://blocks.staging.insurely.com'
    );
    expect(resolveEnvironmentUrl('test')).toBe(
      'https://blocks.test.insurely.com'
    );
  });

  it('accepts a custom url and strips the trailing slash', () => {
    expect(resolveEnvironmentUrl({ url: 'http://localhost:3000/' })).toBe(
      'http://localhost:3000'
    );
  });
});

describe('bootstrapAssetFile', () => {
  it('uses the built asset on insurely.com hosts', () => {
    expect(bootstrapAssetFile('https://blocks.insurely.com')).toBe(
      'mobile-bootstrap.js'
    );
    expect(bootstrapAssetFile('https://blocks.test.insurely.com')).toBe(
      'mobile-bootstrap.js'
    );
  });

  it('uses the source asset elsewhere, for local blocks dev servers', () => {
    expect(bootstrapAssetFile('http://localhost:3000')).toBe(
      'mobile-bootstrap.ts'
    );
  });

  it('rejects hostname spoofing attempts', () => {
    // A URL with insurely.com in the path but not the hostname should not match
    expect(bootstrapAssetFile('https://evil.example.com/insurely.com/x')).toBe(
      'mobile-bootstrap.ts'
    );
  });
});
