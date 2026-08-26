// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it } from '@jest/globals';
import { parseMessage } from '../parse';

const msg = (body: Record<string, unknown>) =>
  JSON.stringify({ origin: 'insurely', ...body });

describe('parseMessage', () => {
  it('ignores unparseable payloads', () => {
    expect(parseMessage('not json')).toBeNull();
  });

  it('ignores payloads without a name', () => {
    expect(parseMessage(msg({ value: 1 }))).toBeNull();
  });

  it('routes an unstamped NON_RECOVERABLE_ERROR to onError', () => {
    // REGRESSION. Blocks has two senders. The ordinary one stamps
    // `origin: 'insurely'`; `usePostMessageUnsafe` posts `{ name, value }` with
    // no origin at all, and it is what both of Blocks' error boundaries — the
    // app-wide one and the router's — use to report NON_RECOVERABLE_ERROR.
    // A parser that required the stamp made the SDK silent on a Blocks crash:
    // the user saw a broken screen and `onError` never fired.
    const parsed = parseMessage(
      JSON.stringify({ name: 'NON_RECOVERABLE_ERROR', value: 'boom' })
    );

    expect(parsed?.dispatch).toEqual({
      type: 'error',
      error: { code: 'NON_RECOVERABLE_ERROR', value: 'boom' },
    });
  });

  it('accepts an unstamped envelope whatever its origin field says', () => {
    // Nothing the SDK injects reaches this parser — `buildPagePostScript` posts
    // through the page's pre-patch postMessage, bypassing the forwarder — so
    // the parser has no reason to filter on an origin stamp, and every filter
    // it could apply would drop a real Blocks message.
    expect(
      parseMessage(JSON.stringify({ name: 'COLLECTION_ID', value: 'abc' }))
        ?.dispatch
    ).toEqual({
      type: 'event',
      event: { type: 'COLLECTION_ID', collectionId: 'abc' },
    });
    expect(
      parseMessage(
        JSON.stringify({ origin: 'elsewhere', name: 'RESULTS', value: [] })
      )?.dispatch.type
    ).toBe('results');
  });

  it('routes RESULTS to results', () => {
    const parsed = parseMessage(msg({ name: 'RESULTS', value: [{ id: 1 }] }));
    expect(parsed?.dispatch).toEqual({
      type: 'results',
      results: { data: [{ id: 1 }] },
    });
  });

  it('routes Blocks error names to error, not to event', () => {
    for (const name of [
      'ERROR',
      'NON_RECOVERABLE_ERROR',
      'INVALID_CREDENTIALS',
      'INVALID_AUTH_TOKEN',
    ]) {
      const parsed = parseMessage(msg({ name, value: 'boom' }));
      expect(parsed?.dispatch.type).toBe('error');
    }
  });

  it('treats QUOTE_ERROR as an event', () => {
    expect(parseMessage(msg({ name: 'QUOTE_ERROR' }))?.dispatch.type).toBe(
      'event'
    );
  });

  it('parses PAGE_VIEW and keeps the raw value', () => {
    const parsed = parseMessage(
      msg({ name: 'PAGE_VIEW', value: 'DATA_AGGREGATION_SELECT_COMPANIES' })
    );
    expect(parsed?.dispatch).toEqual({
      type: 'event',
      event: {
        type: 'PAGE_VIEW',
        page: 'SELECT_COMPANIES',
        raw: 'DATA_AGGREGATION_SELECT_COMPANIES',
      },
    });
  });

  it('falls back to OTHER for unknown page views without losing the raw value', () => {
    const parsed = parseMessage(
      msg({ name: 'PAGE_VIEW', value: 'SOMETHING_NEW' })
    );
    expect(parsed?.dispatch).toEqual({
      type: 'event',
      event: { type: 'PAGE_VIEW', page: 'OTHER', raw: 'SOMETHING_NEW' },
    });
  });

  it('parses collection status, including multi-word Blocks values', () => {
    const cases: Array<[string, string]> = [
      ['RUNNING', 'RUNNING'],
      ['TWO FACTOR PENDING', 'TWO_FACTOR_PENDING'],
      ['COMPLETED PARTIAL', 'COMPLETED_PARTIAL'],
      ['WAITING FOR AUTHENTICATION', 'WAITING_FOR_AUTHENTICATION'],
    ];
    for (const [raw, status] of cases) {
      const parsed = parseMessage(
        msg({ name: 'COLLECTION_STATUS', value: raw })
      );
      expect(parsed?.dispatch).toEqual({
        type: 'event',
        event: { type: 'COLLECTION_STATUS', status, raw },
      });
    }
  });

  it('parses COMPLETED case-insensitively', () => {
    // The Android SDK matches the literal "Completed" while iOS matches
    // "COMPLETED". Accept either rather than inherit one of the two bugs.
    for (const raw of ['COMPLETED', 'Completed']) {
      const parsed = parseMessage(
        msg({ name: 'COLLECTION_STATUS', value: raw })
      );
      expect(
        (parsed?.dispatch as { event: { status: string } }).event.status
      ).toBe('COMPLETED');
    }
  });

  it('produces a bankid action carrying the autostart token', () => {
    const parsed = parseMessage(
      msg({
        name: 'OPEN_SWEDISH_BANKID',
        value: { url: 'bankid:///?autostarttoken=abc', autostartToken: 'abc' },
      })
    );
    expect(parsed?.action).toEqual({
      kind: 'bankid',
      url: 'bankid:///?autostarttoken=abc',
      autostartToken: 'abc',
    });
    expect(parsed?.dispatch.type).toBe('event');
  });

  it('produces actions for the auth methods the native SDKs ignore', () => {
    const cases: Array<[string, unknown, string]> = [
      ['OPEN_DANISH_MITID', { url: 'mitid://x' }, 'mitid'],
      ['OPEN_FRENCH_TRUST_ME', { url: 'https://trustme/x' }, 'auth-app'],
      ['OPEN_AUTHENTICATION_APP', { url: 'https://auth/x' }, 'auth-app'],
      ['REDIRECT', { url: 'https://example.com' }, 'redirect'],
    ];
    for (const [name, value, kind] of cases) {
      expect(parseMessage(msg({ name, value }))?.action?.kind).toBe(kind);
    }
  });

  it('accepts RETURN_TO_BROWSER and OPEN_COMPANION_APP as bare string values', () => {
    expect(
      parseMessage(
        msg({ name: 'RETURN_TO_BROWSER', value: 'https://example.com' })
      )?.action
    ).toEqual({
      kind: 'browser',
      url: 'https://example.com',
    });
    expect(
      parseMessage(msg({ name: 'OPEN_COMPANION_APP', value: 'https://app' }))
        ?.action
    ).toEqual({
      kind: 'companion-app',
      url: 'https://app',
    });
  });

  it('extracts an INSTRUCTIONS_V2 request from extraInformation', () => {
    const parsed = parseMessage(
      msg({
        name: 'COLLECTION_STATUS',
        value: 'COLLECTING',
        extraInformation: {
          INSTRUCTIONS_V2: {
            request: {
              url: 'https://bank.example/api',
              method: 'POST',
              etag: 'e1',
              headers: { 'content-type': 'application/json' },
              body: '{}',
              cookies: [
                {
                  name: 'a',
                  value: 'b',
                  domain: 'bank.example',
                  path: '/',
                  secure: true,
                  httpOnly: true,
                },
              ],
            },
          },
        },
      })
    );
    expect(parsed?.instruction).toEqual({
      url: 'https://bank.example/api',
      method: 'POST',
      etag: 'e1',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      cookies: [
        {
          name: 'a',
          value: 'b',
          domain: 'bank.example',
          path: '/',
          secure: true,
          httpOnly: true,
        },
      ],
    });
    expect(parsed?.dispatch.type).toBe('event');
  });

  it('forwards unknown messages instead of dropping them', () => {
    const parsed = parseMessage(
      msg({ name: 'SOME_FUTURE_MESSAGE', value: { a: 1 } })
    );
    expect(parsed?.dispatch).toEqual({
      type: 'event',
      event: {
        type: 'UNKNOWN',
        name: 'SOME_FUTURE_MESSAGE',
        value: { a: 1 },
        extraInformation: undefined,
      },
    });
  });

  it('forwards known-but-untyped messages as UNKNOWN, keeping the real name', () => {
    const parsed = parseMessage(
      msg({ name: 'CONTACT_DETAILS', value: { email: 'a@b.com' } })
    );
    expect(
      (parsed?.dispatch as { event: { type: string; name: string } }).event
    ).toMatchObject({
      type: 'UNKNOWN',
      name: 'CONTACT_DETAILS',
    });
  });

  const instructionRequest = (overrides: Record<string, unknown> = {}) => ({
    url: 'https://bank.example/api',
    method: 'POST',
    etag: 'e1',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    cookies: [
      {
        name: 'a',
        value: 'b',
        domain: 'bank.example',
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ],
    ...overrides,
  });

  const withInstruction = (request: Record<string, unknown>) =>
    parseMessage(
      msg({
        name: 'COLLECTION_STATUS',
        value: 'COLLECTING',
        extraInformation: { INSTRUCTIONS_V2: { request } },
      })
    );

  it('refuses an instruction whose headers contain a non-string value', () => {
    const parsed = withInstruction(
      instructionRequest({ headers: { 'x-count': 3 } })
    );
    expect(parsed?.instruction).toBeUndefined();
  });

  it('refuses an instruction whose cookies are missing a required field', () => {
    const parsed = withInstruction(
      instructionRequest({
        cookies: [
          { name: 'a', value: 'b', path: '/', secure: true, httpOnly: true },
        ],
      })
    );
    expect(parsed?.instruction).toBeUndefined();
  });

  it('refuses an instruction whose cookie has a non-boolean secure flag', () => {
    const parsed = withInstruction(
      instructionRequest({
        cookies: [
          {
            name: 'a',
            value: 'b',
            domain: 'bank.example',
            path: '/',
            secure: 'true',
            httpOnly: true,
          },
        ],
      })
    );
    expect(parsed?.instruction).toBeUndefined();
  });

  it('refuses an instruction with an empty-string url', () => {
    const parsed = withInstruction(instructionRequest({ url: '' }));
    expect(parsed?.instruction).toBeUndefined();
  });

  it('refuses an instruction with an empty-string etag', () => {
    const parsed = withInstruction(instructionRequest({ etag: '' }));
    expect(parsed?.instruction).toBeUndefined();
  });

  it('still parses a well-formed instruction with headers and cookies', () => {
    const parsed = withInstruction(instructionRequest());
    expect(parsed?.instruction).toEqual({
      url: 'https://bank.example/api',
      method: 'POST',
      etag: 'e1',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      cookies: [
        {
          name: 'a',
          value: 'b',
          domain: 'bank.example',
          path: '/',
          secure: true,
          httpOnly: true,
        },
      ],
    });
  });

  it('accepts headers: null as "no headers" and parses to empty object', () => {
    const parsed = withInstruction(instructionRequest({ headers: null }));
    expect(parsed?.instruction).toBeDefined();
    expect(parsed?.instruction?.headers).toEqual({});
  });

  it('accepts cookies: null as "no cookies" and parses to undefined', () => {
    const parsed = withInstruction(instructionRequest({ cookies: null }));
    expect(parsed?.instruction).toBeDefined();
    expect(parsed?.instruction?.cookies).toBeUndefined();
  });

  it('refuses an instruction with headers set to a non-null malformed value', () => {
    const parsed = withInstruction(
      instructionRequest({ headers: 'not-an-object' })
    );
    expect(parsed?.instruction).toBeUndefined();
  });
});
