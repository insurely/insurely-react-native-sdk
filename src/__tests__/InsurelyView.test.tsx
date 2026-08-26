// Copyright © 2026 Insurely AB. All rights reserved.

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { createRef } from 'react';
import { AppState } from 'react-native';

import { InsurelyView, type InsurelyHandle } from '../InsurelyView';
import { performAction } from '../links/openUrl';
import type { OpenUrlAction } from '../bridge/parse';
import type { PerformActionOptions } from '../links/openUrl';
import type { HttpRequest, HttpResult } from '../native/NativeInsurelyHttp';
import type { InsurelyError } from '../types/events';

// `@jest/globals`' `jest.Mock` defaults its generic to a function returning
// `unknown`, so `mockResolvedValue` would otherwise only accept `never`.
// Pinning the real signature keeps the mock usable under strict mode without
// changing any assertion below.
type PerformAction = (
  action: OpenUrlAction,
  options: PerformActionOptions
) => Promise<InsurelyError | null>;

// `jest.fn()` records the actual props React passes at call time regardless of
// the implementation's declared signature, and no test below ever queries the
// rendered tree — every assertion reads `WebView.mock.calls` — so the mock does
// not spread its props onto `<View>`.
//
// It does have to honour `ref`, though. React 19 hands `ref` to a function
// component as an ordinary prop, so the mock can expose the imperative handle
// InsurelyView drives: `injectJavaScript` for every script the SDK posts back
// into the page, `reload` for the public handle. The earlier mock did not, so
// `webViewRef.current` stayed null and every `post(...)` was a silent no-op —
// which is why deleting the whole instruction block used to leave tests green.
const mockWebViewInstance = {
  injectJavaScript: jest.fn(),
  reload: jest.fn(),
};

jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  const { useImperativeHandle } = require('react');
  return {
    WebView: jest.fn((props: { ref?: unknown }) => {
      useImperativeHandle(props.ref, () => mockWebViewInstance);
      return <View testID="webview" />;
    }),
  };
});
jest.mock('../links/openUrl', () => ({
  performAction: jest.fn<PerformAction>().mockResolvedValue(null),
}));
jest.mock('../native/NativeInsurelyHttp', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

const { WebView } = require('react-native-webview');
const nativeHttp = require('../native/NativeInsurelyHttp').default as {
  execute: jest.Mock<(request: HttpRequest) => Promise<HttpResult>>;
};
const config = { customerId: 'c1', configName: 'cfg' };

const props = () => WebView.mock.calls.at(-1)[0];

/** Delivers a raw bridge payload, exactly as the page would post it. */
const emitRaw = (raw: string) => {
  props().onMessage({ nativeEvent: { data: raw } });
};

const emit = (body: Record<string, unknown>) => {
  emitRaw(JSON.stringify({ origin: 'insurely', ...body }));
};

/** A COLLECTION_STATUS message carrying an INSTRUCTIONS_V2 request. */
const instructionMessage = (etag: string) => ({
  name: 'COLLECTION_STATUS',
  value: 'RUNNING',
  extraInformation: {
    INSTRUCTIONS_V2: {
      request: {
        url: 'https://bank.example/step',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
        etag,
      },
    },
  },
});

const httpResult: HttpResult = {
  status: 200,
  headers: { 'content-type': ['application/json'] },
  body: '{"ok":true}',
  finalUrl: 'https://bank.example/step/final',
  setCookie: ['sid=secret; Path=/; HttpOnly'],
};

/**
 * Captures the AppState listener `watchForSigningFinished` registers, so a
 * BankID round trip can be simulated without a real app lifecycle.
 */
function captureAppState() {
  const listeners: ((state: string) => void)[] = [];
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    listener: (state: string) => void
  ) => {
    listeners.push(listener);
    return { remove };
  }) as unknown as typeof AppState.addEventListener);
  return {
    remove,
    emit: (state: string) => listeners.forEach((listener) => listener(state)),
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  nativeHttp.execute.mockReset();
  (performAction as jest.Mock<PerformAction>).mockResolvedValue(null);
});

describe('InsurelyView', () => {
  it('loads the environment url and injects the bootstrap', async () => {
    await render(<InsurelyView environment="test" config={config} />);

    expect(props().source).toEqual({ uri: 'https://blocks.test.insurely.com' });
    expect(props().injectedJavaScript).toContain('mobile-bootstrap.js');
    expect(props().injectedJavaScript).toContain('"customerId":"c1"');
  });

  it('delivers results', async () => {
    const onResults = jest.fn();
    await render(
      <InsurelyView environment="test" config={config} onResults={onResults} />
    );
    emit({ name: 'RESULTS', value: [{ id: 1 }] });
    expect(onResults).toHaveBeenCalledWith({ data: [{ id: 1 }] });
  });

  it('delivers typed events', async () => {
    const onEvent = jest.fn();
    await render(
      <InsurelyView environment="test" config={config} onEvent={onEvent} />
    );
    emit({ name: 'COLLECTION_ID', value: 'abc' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'COLLECTION_ID',
      collectionId: 'abc',
    });
  });

  it('forwards messages it has no type for', async () => {
    const onEvent = jest.fn();
    await render(
      <InsurelyView environment="test" config={config} onEvent={onEvent} />
    );
    emit({ name: 'A_BRAND_NEW_MESSAGE', value: 7 });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'UNKNOWN',
      name: 'A_BRAND_NEW_MESSAGE',
      value: 7,
      extraInformation: undefined,
    });
  });

  it('routes Blocks errors to onError and not to onEvent', async () => {
    const onEvent = jest.fn();
    const onError = jest.fn();
    await render(
      <InsurelyView
        environment="test"
        config={config}
        onEvent={onEvent}
        onError={onError}
      />
    );
    emit({ name: 'NON_RECOVERABLE_ERROR', value: 'bad' });

    expect(onError).toHaveBeenCalledWith({
      code: 'NON_RECOVERABLE_ERROR',
      value: 'bad',
    });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('opens BankID with the configured redirect', async () => {
    await render(
      <InsurelyView
        environment="test"
        config={config}
        bankIdRedirectUrl="myapp:///"
      />
    );
    emit({
      name: 'OPEN_SWEDISH_BANKID',
      value: { url: 'bankid:///', autostartToken: 'a' },
    });

    expect(performAction).toHaveBeenCalledWith(
      { kind: 'bankid', url: 'bankid:///', autostartToken: 'a' },
      expect.objectContaining({ bankIdRedirectUrl: 'myapp:///' })
    );
  });

  it('opens MitID, which the native SDKs ignore', async () => {
    await render(<InsurelyView environment="test" config={config} />);
    emit({ name: 'OPEN_DANISH_MITID', value: { url: 'mitid://x' } });
    expect(performAction).toHaveBeenCalledWith(
      { kind: 'mitid', url: 'mitid://x' },
      expect.anything()
    );
  });

  it('ignores messages that are not valid JSON', async () => {
    const onEvent = jest.fn();
    await render(
      <InsurelyView environment="test" config={config} onEvent={onEvent} />
    );
    expect(() => emitRaw('garbage')).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('throws on an invalid config in development', async () => {
    await expect(
      render(
        // @ts-expect-error deliberately invalid
        <InsurelyView environment="test" config={{ ...config, nope: 1 }} />
      )
    ).rejects.toThrow(/nope/);
  });

  it('reports a Blocks crash the error boundary posted without an origin', async () => {
    // REGRESSION. Blocks' two error boundaries report NON_RECOVERABLE_ERROR
    // through `usePostMessageUnsafe`, which posts `{ name, value }` with no
    // origin stamp — it exists precisely for contexts where the allowed origin
    // is not reachable. A parser that required the stamp left the SDK silent on
    // exactly the failure the integrator most needs to hear about: the user saw
    // a broken screen and `onError` never fired.
    const onError = jest.fn();
    await render(
      <InsurelyView environment="test" config={config} onError={onError} />
    );

    emitRaw(JSON.stringify({ name: 'NON_RECOVERABLE_ERROR', value: 'boom' }));

    expect(onError).toHaveBeenCalledWith({
      code: 'NON_RECOVERABLE_ERROR',
      value: 'boom',
    });
  });

  it('never lets its own supplemental injection back into a callback', async () => {
    // The end-to-end version of the leak the origin filter was introduced for,
    // run against the real scripts rather than a hand-written envelope: the
    // real injected script installs the real bridge in a stand-in page whose
    // `ReactNativeWebView.postMessage` feeds straight back into `onMessage`,
    // and the real supplemental script is then executed in it.
    nativeHttp.execute.mockResolvedValue(httpResult);
    const onEvent = jest.fn();
    const onError = jest.fn();
    const onResults = jest.fn();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await render(
      <InsurelyView
        environment="test"
        config={config}
        logLevel="all"
        onEvent={onEvent}
        onError={onError}
        onResults={onResults}
      />
    );

    await act(async () => {
      emit(instructionMessage('etag-1'));
    });

    // The COLLECTION_STATUS that carried the instruction is a real Blocks
    // message and legitimately reached onEvent and the log. Everything after
    // this point is the SDK talking to itself.
    onEvent.mockClear();
    log.mockClear();

    const supplemental = mockWebViewInstance.injectJavaScript.mock
      .calls[0]![0] as string;
    // `pagePostMessage` is the page's own postMessage. The injected script
    // replaces `page.postMessage` with the forwarder, so the assertion below
    // has to hold the original separately to see what Blocks received.
    const pagePostMessage = jest.fn();
    // Everything the patched postMessage hands to React Native, recorded and
    // then delivered to the component exactly as it would be on a device.
    const forwarded: string[] = [];
    const page = {
      insurely: undefined as unknown,
      postMessage: pagePostMessage,
      ReactNativeWebView: {
        postMessage: (data: string) => {
          forwarded.push(data);
          emitRaw(data);
        },
      },
      sessionStorage: { setItem: jest.fn() },
      document: { createElement: () => ({}), head: { appendChild: jest.fn() } },
    };
    const run = (script: string) =>
      // eslint-disable-next-line no-new-func
      new Function('window', `with (window) { ${script} }`)(page);

    run(props().injectedJavaScript as string);
    run(supplemental);

    // Blocks got its response...
    expect(pagePostMessage).toHaveBeenCalledTimes(1);
    expect(page.postMessage).not.toBe(pagePostMessage);
    // ...and it never entered the bridge in the first place. This is the
    // assertion that pins the fix: an origin filter at the parser would leave
    // the response body and Set-Cookie array sitting in `forwarded`, discarded
    // only afterwards and only for as long as nobody relaxes the filter.
    expect(forwarded).toEqual([]);
    // Nothing reached a callback or the log either.
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onResults).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('sid=secret');
  });

  describe('instructions', () => {
    it('executes an INSTRUCTIONS_V2 request and injects the response', async () => {
      nativeHttp.execute.mockResolvedValue(httpResult);
      const onInstruction = jest.fn();
      await render(
        <InsurelyView
          environment="test"
          config={config}
          onInstruction={onInstruction}
        />
      );

      await act(async () => {
        emit(instructionMessage('etag-1'));
      });

      expect(nativeHttp.execute).toHaveBeenCalledWith({
        url: 'https://bank.example/step',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
        cookies: undefined,
      });

      const script = mockWebViewInstance.injectJavaScript.mock
        .calls[0]![0] as string;
      expect(script).toContain('SUPPLEMENTAL_INFORMATION');
      expect(script).toContain('x-final-url');

      expect(onInstruction).toHaveBeenCalledWith({
        url: 'https://bank.example/step',
        status: 200,
        finalUrl: 'https://bank.example/step/final',
      });
    });

    it('never puts headers, body or cookies into onInstruction', async () => {
      nativeHttp.execute.mockResolvedValue(httpResult);
      const onInstruction = jest.fn();
      await render(
        <InsurelyView
          environment="test"
          config={config}
          onInstruction={onInstruction}
        />
      );

      await act(async () => {
        emit(instructionMessage('etag-1'));
      });

      const info = onInstruction.mock.calls[0]![0] as Record<string, unknown>;
      expect(Object.keys(info).sort()).toEqual(['finalUrl', 'status', 'url']);
      expect(JSON.stringify(info)).not.toContain('secret');
    });

    it('reports a failed instruction through onError', async () => {
      nativeHttp.execute.mockRejectedValue(new Error('offline'));
      const onError = jest.fn();
      const onInstruction = jest.fn();
      await render(
        <InsurelyView
          environment="test"
          config={config}
          onError={onError}
          onInstruction={onInstruction}
        />
      );

      await act(async () => {
        emit(instructionMessage('etag-1'));
      });

      expect(onError).toHaveBeenCalledWith({
        code: 'INSTRUCTION_FAILED',
        url: 'https://bank.example/step',
        message: 'offline',
      });
      expect(onInstruction).not.toHaveBeenCalled();
      expect(mockWebViewInstance.injectJavaScript).not.toHaveBeenCalled();
    });

    it('re-runs a repeated etag after reload', async () => {
      nativeHttp.execute.mockResolvedValue(httpResult);
      const ref = createRef<InsurelyHandle>();
      await render(
        <InsurelyView ref={ref} environment="test" config={config} />
      );

      await act(async () => {
        emit(instructionMessage('etag-1'));
      });
      await act(async () => {
        emit(instructionMessage('etag-1'));
      });
      expect(nativeHttp.execute).toHaveBeenCalledTimes(1);

      ref.current?.reload();
      expect(mockWebViewInstance.reload).toHaveBeenCalledTimes(1);

      // A fresh Blocks session may reissue an ETag from the previous one.
      await act(async () => {
        emit(instructionMessage('etag-1'));
      });
      expect(nativeHttp.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('SIGNING_FINISHED', () => {
    it('posts SIGNING_FINISHED once the app returns from BankID', async () => {
      const appState = captureAppState();
      await render(<InsurelyView environment="test" config={config} />);

      emit({ name: 'OPEN_SWEDISH_BANKID', value: { url: 'bankid:///' } });
      expect(mockWebViewInstance.injectJavaScript).not.toHaveBeenCalled();

      appState.emit('background');
      appState.emit('active');

      expect(mockWebViewInstance.injectJavaScript).toHaveBeenCalledTimes(1);
      const script = mockWebViewInstance.injectJavaScript.mock
        .calls[0]![0] as string;
      expect(script).toContain('{"name":"SIGNING_FINISHED"}');
      // Posted through the page's pre-patch postMessage, never through the
      // bridge — an SDK injection must not come back out to the integrator.
      expect(script).toContain('window.__insurelyPostMessage');
    });

    it('does not register the watcher for a non-BankID action', async () => {
      const appState = captureAppState();
      await render(<InsurelyView environment="test" config={config} />);

      emit({ name: 'OPEN_DANISH_MITID', value: { url: 'mitid://x' } });
      appState.emit('background');
      appState.emit('active');

      expect(mockWebViewInstance.injectJavaScript).not.toHaveBeenCalled();
    });
  });

  describe('onShouldStartLoadWithRequest', () => {
    const load = (request: { url: string; isTopFrame?: boolean }) =>
      props().onShouldStartLoadWithRequest({
        isTopFrame: true,
        ...request,
      }) as boolean;

    it('never intercepts sub-frame navigation', async () => {
      await render(<InsurelyView environment="test" config={config} />);
      expect(
        load({ url: 'https://ads.example/frame', isTopFrame: false })
      ).toBe(true);
      expect(performAction).not.toHaveBeenCalled();
    });

    it('keeps same-origin top-frame navigation in the WebView', async () => {
      await render(<InsurelyView environment="test" config={config} />);
      expect(load({ url: 'https://blocks.test.insurely.com/x' })).toBe(true);
      expect(performAction).not.toHaveBeenCalled();
    });

    it('hands a cross-origin top-frame navigation to the browser', async () => {
      await render(<InsurelyView environment="test" config={config} />);
      expect(load({ url: 'https://elsewhere.example/x' })).toBe(false);
      expect(performAction).toHaveBeenCalledWith(
        { kind: 'browser', url: 'https://elsewhere.example/x' },
        expect.anything()
      );
    });

    it('follows the top frame once a bank redirect moves it off Blocks', async () => {
      await render(<InsurelyView environment="test" config={config} />);

      // The bank auth redirect the SDK allowed through.
      // Only mutates a ref; no React state update, so no act() wrapper.
      props().onNavigationStateChange({ url: 'https://bank.example/auth' });

      // Everything after it is same-origin with the bank, not with Blocks.
      expect(load({ url: 'https://bank.example/auth/step2' })).toBe(true);
      expect(performAction).not.toHaveBeenCalled();
    });

    it('does not record a non-http(s) url as the current one', async () => {
      // `currentUrl` exists only to be compared by origin. Recording
      // `about:blank` (or `data:`/`blob:`, all of which this handler
      // deliberately allows through) would leave it with no origin at all,
      // after which every later top-frame navigation looks cross-origin and the
      // whole rest of the flow is ejected into the system browser.
      await render(<InsurelyView environment="test" config={config} />);

      props().onNavigationStateChange({ url: 'https://bank.example/auth' });
      for (const url of [
        'about:blank',
        'data:text/html,<p>hi</p>',
        'blob:https://bank.example/abc',
      ]) {
        expect(load({ url })).toBe(true);
        props().onNavigationStateChange({ url });
      }

      // The bank is still the top frame's origin as far as the SDK knows.
      expect(load({ url: 'https://bank.example/auth/step2' })).toBe(true);
      expect(performAction).not.toHaveBeenCalled();

      // And a genuinely cross-origin navigation is still handed over.
      expect(load({ url: 'https://elsewhere.example/x' })).toBe(false);
    });

    it('never hands a non-http(s) url to the system browser', async () => {
      await render(<InsurelyView environment="test" config={config} />);
      for (const url of [
        'about:blank',
        'data:text/html,<p>hi</p>',
        'blob:https://blocks.test.insurely.com/abc',
      ]) {
        expect(load({ url })).toBe(true);
      }
      expect(performAction).not.toHaveBeenCalled();
    });

    it('reports a failed browser hand-off through onError', async () => {
      const failure: InsurelyError = {
        code: 'AUTH_APP_NOT_AVAILABLE',
        url: 'https://elsewhere.example/x',
      };
      (performAction as jest.Mock<PerformAction>).mockResolvedValue(failure);
      const onError = jest.fn();
      await render(
        <InsurelyView environment="test" config={config} onError={onError} />
      );

      expect(load({ url: 'https://elsewhere.example/x' })).toBe(false);
      // performAction's promise settles on the microtask queue.
      await Promise.resolve();
      expect(onError).toHaveBeenCalledWith(failure);
    });
  });

  describe('load failures', () => {
    it('reports a transport failure through onError', async () => {
      const onError = jest.fn();
      await render(
        <InsurelyView environment="test" config={config} onError={onError} />
      );

      props().onError({
        nativeEvent: {
          url: 'https://blocks.test.insurely.com',
          code: -1009,
          description: 'The Internet connection appears to be offline.',
        },
      });

      expect(onError).toHaveBeenCalledWith({
        code: 'LOAD_FAILED',
        url: 'https://blocks.test.insurely.com',
        message: 'The Internet connection appears to be offline.',
      });
    });

    it('reports an HTTP error from the Blocks host through onError', async () => {
      const onError = jest.fn();
      await render(
        <InsurelyView environment="test" config={config} onError={onError} />
      );

      props().onHttpError({
        nativeEvent: {
          url: 'https://blocks.test.insurely.com',
          statusCode: 503,
          description: 'Service Unavailable',
        },
      });

      expect(onError).toHaveBeenCalledWith({
        code: 'LOAD_FAILED',
        url: 'https://blocks.test.insurely.com',
        status: 503,
        message: 'Service Unavailable',
      });
    });
  });

  it('warns when sendPostMessages is false alongside onResults', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await render(
      <InsurelyView
        environment="test"
        config={{ ...config, sendPostMessages: false }}
        onResults={jest.fn()}
      />
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/sendPostMessages/);
  });

  it('stays quiet when sendPostMessages is false without onResults', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await render(
      <InsurelyView
        environment="test"
        config={{ ...config, sendPostMessages: false }}
      />
    );

    expect(warn).not.toHaveBeenCalled();
  });
});
