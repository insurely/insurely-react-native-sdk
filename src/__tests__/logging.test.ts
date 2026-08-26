// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it } from '@jest/globals';
import { redact } from '../logging';

describe('redact', () => {
  it('redacts autostartToken by key', () => {
    expect(redact({ autostartToken: 'super-secret-token' })).toEqual({
      autostartToken: '[redacted]',
    });
  });

  it('masks the query string of a URL that carries one', () => {
    expect(redact('bankid:///?autostarttoken=abc-123&redirect=myapp://')).toBe(
      'bankid:///?[redacted]'
    );

    expect(redact('https://app.insurely.com/bankid?token=super-secret')).toBe(
      'https://app.insurely.com/bankid?[redacted]'
    );
  });

  it('preserves a URL with no query string', () => {
    expect(redact('bankid:///')).toBe('bankid:///');
    expect(redact('https://app.insurely.com/bankid')).toBe(
      'https://app.insurely.com/bankid'
    );
  });

  it('recurses through nested objects and arrays', () => {
    expect(
      redact({
        event: {
          type: 'OPEN_SWEDISH_BANKID',
          url: 'bankid:///?autostarttoken=abc-123',
          autostartToken: 'abc-123',
        },
        related: [
          { authToken: 'xyz', note: 'ok' },
          'https://example.com/x?a=1',
        ],
      })
    ).toEqual({
      event: {
        type: 'OPEN_SWEDISH_BANKID',
        url: 'bankid:///?[redacted]',
        autostartToken: '[redacted]',
      },
      related: [
        { authToken: '[redacted]', note: 'ok' },
        'https://example.com/x?[redacted]',
      ],
    });
  });

  it('redacts cookies and response bodies by key', () => {
    expect(
      redact({
        headers: {
          'Set-Cookie': ['sid=secret; Path=/; HttpOnly'],
          'set-cookie': ['sid=secret'],
          'Cookie': 'sid=secret',
          'content-type': ['text/html'],
        },
        setCookie: ['sid=secret'],
        cookies: [{ name: 'sid', value: 'secret' }],
        response: '<html>bank session</html>',
      })
    ).toEqual({
      headers: {
        'Set-Cookie': '[redacted]',
        'set-cookie': '[redacted]',
        'Cookie': '[redacted]',
        'content-type': ['text/html'],
      },
      setCookie: '[redacted]',
      cookies: '[redacted]',
      response: '[redacted]',
    });
  });

  it('leaves a non-URL string untouched', () => {
    expect(redact('hello world')).toBe('hello world');
    expect(redact('NON_RECOVERABLE_ERROR')).toBe('NON_RECOVERABLE_ERROR');
  });
});
