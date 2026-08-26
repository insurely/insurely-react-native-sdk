// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it, jest } from '@jest/globals';
import { buildInjectedScript } from '../../bridge/injected';
import { InstructionExecutor } from '../executor';
import type { InstructionRequest } from '../../bridge/parse';
import type { HttpRequest, HttpResult } from '../../native/NativeInsurelyHttp';

// `@jest/globals`' `jest.Mock` defaults its generic to a function returning
// `unknown`, so `mockResolvedValue`/`mockRejectedValue` would otherwise only
// accept `never`. Pinning the real signature keeps the mocks usable under
// strict mode without changing any assertion below.
type Execute = (request: HttpRequest) => Promise<HttpResult>;

const request: InstructionRequest = {
  url: 'https://bank.example/api',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"a":1}',
  cookies: [
    {
      name: 'sid',
      value: 'x',
      domain: 'bank.example',
      path: '/',
      secure: true,
      httpOnly: true,
    },
  ],
  etag: 'etag-1',
};

/** Only needed to build the real injected script in `payloadFrom`. */
const config = { customerId: 'c1', configName: 'cfg' };

const ok: HttpResult = {
  status: 200,
  headers: { 'content-type': ['application/json'] },
  body: '{"status":"COMPLETE"}',
  finalUrl: 'https://bank.example/api/final',
  setCookie: ['sid=y; Path=/'],
};

describe('InstructionExecutor', () => {
  it('passes the request through to native', async () => {
    const execute = jest.fn<Execute>().mockResolvedValue(ok);
    await new InstructionExecutor({ execute }).execute(request);

    expect(execute).toHaveBeenCalledWith({
      url: request.url,
      method: 'POST',
      headers: request.headers,
      body: request.body,
      cookies: request.cookies,
    });
  });

  it('parses a JSON body into an object, per the ResponseObject contract', async () => {
    const execute = jest.fn<Execute>().mockResolvedValue(ok);
    const result = await new InstructionExecutor({ execute }).execute(request);
    const payload = payloadFrom(result);

    expect(payload.type).toBe('RESPONSE_OBJECT');
    expect(payload.response).toEqual({ status: 'COMPLETE' });
  });

  it('keeps a non-JSON body as a string', async () => {
    const execute = jest
      .fn<Execute>()
      .mockResolvedValue({ ...ok, body: '<html>hi</html>' });
    const payload = payloadFrom(
      await new InstructionExecutor({ execute }).execute(request)
    );

    expect(payload.response).toBe('<html>hi</html>');
  });

  it('reports the final url and set-cookie as header arrays', async () => {
    const execute = jest.fn<Execute>().mockResolvedValue(ok);
    const payload = payloadFrom(
      await new InstructionExecutor({ execute }).execute(request)
    );

    expect(payload.headers['x-final-url']).toEqual([
      'https://bank.example/api/final',
    ]);
    expect(payload.headers['Set-Cookie']).toEqual(['sid=y; Path=/']);
    expect(payload.headers['content-type']).toEqual(['application/json']);
  });

  it('omits Set-Cookie entirely when there are no cookies', async () => {
    const execute = jest
      .fn<Execute>()
      .mockResolvedValue({ ...ok, setCookie: [] });
    const payload = payloadFrom(
      await new InstructionExecutor({ execute }).execute(request)
    );

    expect(payload.headers['Set-Cookie']).toBeUndefined();
  });

  it('skips a repeated etag', async () => {
    const execute = jest.fn<Execute>().mockResolvedValue(ok);
    const executor = new InstructionExecutor({ execute });

    expect(await executor.execute(request)).not.toBeNull();
    expect(await executor.execute(request)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('runs an instruction with a different etag', async () => {
    const execute = jest.fn<Execute>().mockResolvedValue(ok);
    const executor = new InstructionExecutor({ execute });

    await executor.execute(request);
    await executor.execute({ ...request, etag: 'etag-2' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('reports metadata for a successful instruction', async () => {
    const execute = jest.fn<Execute>().mockResolvedValue(ok);
    const result = await new InstructionExecutor({ execute }).execute(request);

    // Metadata only: no headers, no body, no cookies.
    expect(result).toEqual({
      script: expect.any(String),
      info: {
        url: 'https://bank.example/api',
        status: 200,
        finalUrl: 'https://bank.example/api/final',
      },
    });
  });

  it('runs a repeated etag again after reset', async () => {
    // reload() starts a fresh Blocks session in the same component, and Blocks
    // is free to reissue an ETag from the session being torn down. Without the
    // reset the repeat is deduped away and the new collection stalls silently.
    const execute = jest.fn<Execute>().mockResolvedValue(ok);
    const executor = new InstructionExecutor({ execute });

    expect(await executor.execute(request)).not.toBeNull();
    expect(await executor.execute(request)).toBeNull();

    executor.reset();

    expect(await executor.execute(request)).not.toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('discards a result that lands after a reset', async () => {
    // reload() while an instruction is in flight. Its ETag has already been
    // forgotten, so the fresh session will reissue whatever it still needs; the
    // response now in flight belongs to a session that no longer exists and
    // must not be injected into its replacement, nor reach onInstruction.
    let settle: (result: HttpResult) => void = () => {};
    const execute = jest.fn<Execute>().mockReturnValue(
      new Promise<HttpResult>((resolve) => {
        settle = resolve;
      })
    );
    const executor = new InstructionExecutor({ execute });

    const inFlight = executor.execute(request);
    executor.reset();
    settle(ok);

    expect(await inFlight).toBeNull();
  });

  it('discards a failure that lands after a reset', async () => {
    // Same for the error path: an INSTRUCTION_FAILED from the torn-down session
    // would otherwise surface as an error against the new one.
    let fail: (error: Error) => void = () => {};
    const execute = jest.fn<Execute>().mockReturnValue(
      new Promise<HttpResult>((_resolve, reject) => {
        fail = reject;
      })
    );
    const executor = new InstructionExecutor({ execute });

    const inFlight = executor.execute(request);
    executor.reset();
    fail(new Error('offline'));

    expect(await inFlight).toBeNull();
  });

  it('still runs the reissued instruction in the new session', async () => {
    // The discard must not cost the new session its instruction: reset() forgot
    // the ETag, so the reissue runs and is reported normally.
    let settle: (result: HttpResult) => void = () => {};
    const execute = jest
      .fn<Execute>()
      .mockReturnValueOnce(
        new Promise<HttpResult>((resolve) => {
          settle = resolve;
        })
      )
      .mockResolvedValue(ok);
    const executor = new InstructionExecutor({ execute });

    const inFlight = executor.execute(request);
    executor.reset();
    settle(ok);
    expect(await inFlight).toBeNull();

    expect(await executor.execute(request)).not.toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('returns an error for a non-2xx status', async () => {
    const execute = jest
      .fn<Execute>()
      .mockResolvedValue({ ...ok, status: 401 });
    const result = await new InstructionExecutor({ execute }).execute(request);

    expect(result).toEqual({
      error: {
        code: 'INSTRUCTION_FAILED',
        url: request.url,
        status: 401,
        message: 'HTTP 401',
      },
    });
  });

  it('returns an error when native rejects', async () => {
    const execute = jest.fn<Execute>().mockRejectedValue(new Error('offline'));
    const result = await new InstructionExecutor({ execute }).execute(request);

    expect(result).toEqual({
      error: {
        code: 'INSTRUCTION_FAILED',
        url: request.url,
        message: 'offline',
      },
    });
  });

  it('does not retry an instruction that already failed', async () => {
    const execute = jest.fn<Execute>().mockRejectedValue(new Error('offline'));
    const executor = new InstructionExecutor({ execute });

    // First execution returns the error
    const firstResult = await executor.execute(request);
    expect(firstResult).toEqual({
      error: {
        code: 'INSTRUCTION_FAILED',
        url: request.url,
        message: 'offline',
      },
    });

    // Same instruction submitted again returns null without calling native
    const secondResult = await executor.execute(request);
    expect(secondResult).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

/**
 * Runs the executor's real script in a stand-in page that has the SDK's real
 * injected script applied to it, and returns the SUPPLEMENTAL_INFORMATION
 * payload the page's own listeners received.
 *
 * Executing both scripts rather than pattern-matching the emitted string is the
 * point: it is the only way to assert what actually happens at the bridge. The
 * bank's response body and its un-joined `Set-Cookie` array are in this
 * payload, so `forwarded` — everything the patched postMessage hands to React
 * Native — must stay empty.
 */
function payloadFrom(result: unknown): {
  type: string;
  headers: Record<string, string[]>;
  response: unknown;
} {
  const original = jest.fn();
  const forwarded: string[] = [];
  const win = {
    insurely: undefined as unknown,
    postMessage: original,
    ReactNativeWebView: { postMessage: (data: string) => forwarded.push(data) },
    sessionStorage: { setItem: jest.fn() },
    document: { createElement: () => ({}), head: { appendChild: jest.fn() } },
  };
  const run = (script: string) =>
    // eslint-disable-next-line no-new-func
    new Function('window', `with (window) { ${script} }`)(win);

  run(buildInjectedScript({ baseUrl: 'https://blocks.insurely.com', config }));
  run((result as { script: string }).script);

  expect(forwarded).toEqual([]);
  expect(original).toHaveBeenCalledTimes(1);

  const payload = original.mock.calls[0]![0] as {
    name: string;
    value: {
      type: string;
      headers: Record<string, string[]>;
      response: unknown;
    };
  };
  expect(payload.name).toBe('SUPPLEMENTAL_INFORMATION');
  return payload.value;
}
