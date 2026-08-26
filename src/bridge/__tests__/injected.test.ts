// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it, jest } from '@jest/globals';
import { buildInjectedScript, buildPagePostScript } from '../injected';

const config = { customerId: 'c1', configName: 'cfg' };

describe('buildInjectedScript', () => {
  it('embeds config and prefill under window.insurely', () => {
    const script = buildInjectedScript({
      baseUrl: 'https://blocks.test.insurely.com',
      config,
    });
    expect(script).toContain('"customerId":"c1"');
    expect(script).toContain('"configName":"cfg"');
  });

  it('injects agent: { type: "sdk" } so Blocks does not divert same-device BankID banks to the companion app', () => {
    // Regression guard: Blocks decides whether to redirect a collection into the
    // Insurely Connect companion app using `usingSdk = !!agent?.type`
    // (Blocks reads it as `usingSdk`). Without this field, any bank
    // supporting SWEDISH_MOBILE_BANKID_SAME_DEVICE_CLIENT_SIDE_AUTHENTICATION on
    // a mobile device is wrongly diverted to the companion app instead of doing
    // client-side auth in the WebView, which `InsurelyHttp` already implements.
    const script = buildInjectedScript({
      baseUrl: 'https://blocks.test.insurely.com',
      config,
    });
    const match = /window\.insurely = (\{[\s\S]*?\});\n/.exec(script);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]!) as { config: { agent?: unknown } };
    expect(payload.config.agent).toEqual({ type: 'sdk' });
  });

  it('does not let a developer-supplied config override the injected agent', () => {
    const script = buildInjectedScript({
      baseUrl: 'https://blocks.test.insurely.com',
      // `agent` is not part of the public `InsurelyConfig` type; cast to bypass
      // that and prove the SDK's own value wins regardless.
      config: { ...config, agent: { type: 'companion-app' } } as never,
    });
    const match = /window\.insurely = (\{[\s\S]*?\});\n/.exec(script);
    const payload = JSON.parse(match![1]!) as { config: { agent?: unknown } };
    expect(payload.config.agent).toEqual({ type: 'sdk' });
  });

  it('points at the built asset for Insurely hosts', () => {
    const script = buildInjectedScript({
      baseUrl: 'https://blocks.test.insurely.com',
      config,
    });
    expect(script).toContain(
      'https://blocks.test.insurely.com/assets/mobile-bootstrap.js'
    );
  });

  it('points at the source asset for a local Blocks server', () => {
    const script = buildInjectedScript({
      baseUrl: 'http://localhost:3000',
      config,
    });
    expect(script).toContain(
      'http://localhost:3000/assets/mobile-bootstrap.ts'
    );
  });

  it('ends with true so react-native-webview does not warn', () => {
    expect(
      buildInjectedScript({
        baseUrl: 'https://blocks.insurely.com',
        config,
      }).trimEnd()
    ).toMatch(/true;$/);
  });

  it('escapes a closing script tag in config values', () => {
    const script = buildInjectedScript({
      baseUrl: 'https://blocks.insurely.com',
      config: { ...config, configName: '</script><script>alert(1)</script>' },
    });
    expect(script).not.toContain('</script>');
  });

  it('forwards postMessage calls to the React Native bridge', () => {
    const posted: string[] = [];
    const original = jest.fn();
    const scriptEl: Record<string, unknown> = {};
    const win = {
      insurely: undefined as unknown,
      postMessage: original,
      ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
      sessionStorage: { setItem: jest.fn() },
      document: {
        createElement: () => scriptEl,
        head: { appendChild: jest.fn() },
      },
    };

    const script = buildInjectedScript({
      baseUrl: 'https://blocks.insurely.com',
      config,
    });
    // eslint-disable-next-line no-new-func
    new Function('window', `with (window) { ${script} }`)(win);

    expect(win.postMessage).not.toBe(original);
    win.postMessage({ name: 'APP_LOADED' }, '*');

    expect(original).toHaveBeenCalledWith({ name: 'APP_LOADED' }, '*');
    expect(posted).toEqual([JSON.stringify({ name: 'APP_LOADED' })]);
    expect(scriptEl.src).toBe(
      'https://blocks.insurely.com/assets/mobile-bootstrap.js'
    );
  });

  it('keeps the pre-patch postMessage for the SDK to post through', () => {
    // The bridge forwards everything the page posts, on purpose. What keeps the
    // SDK's *own* injections out of that stream is this reference, not a filter
    // at the parser — see the invariant in `bridge/parse.ts`.
    const win = stubWindow();
    run(
      buildInjectedScript({ baseUrl: 'https://blocks.insurely.com', config }),
      win
    );

    expect(typeof win.__insurelyPostMessage).toBe('function');
    (win.__insurelyPostMessage as (data: unknown) => void)({
      name: 'SIGNING_FINISHED',
    });

    expect(win.original).toHaveBeenCalledWith({ name: 'SIGNING_FINISHED' });
    expect(win.forwarded).toEqual([]);
  });

  it('does not throw when a message cannot be serialized', () => {
    const win = {
      insurely: undefined as unknown,
      postMessage: jest.fn(),
      ReactNativeWebView: { postMessage: jest.fn() },
      sessionStorage: { setItem: jest.fn() },
      document: { createElement: () => ({}), head: { appendChild: jest.fn() } },
    };
    const script = buildInjectedScript({
      baseUrl: 'https://blocks.insurely.com',
      config,
    });
    // eslint-disable-next-line no-new-func
    new Function('window', `with (window) { ${script} }`)(win);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => win.postMessage(circular, '*')).not.toThrow();
    expect(win.ReactNativeWebView.postMessage).not.toHaveBeenCalled();
  });
});

describe('buildPagePostScript', () => {
  const payload = { name: 'SIGNING_FINISHED' };

  it('reaches the page without passing through the bridge', () => {
    const win = stubWindow();
    run(
      buildInjectedScript({ baseUrl: 'https://blocks.insurely.com', config }),
      win
    );
    // The forwarder is installed and is what the page now calls.
    expect(win.postMessage).not.toBe(win.original);

    run(buildPagePostScript(payload), win);

    // The page's own listeners saw it; React Native never did. `forwarded` is
    // fed only by the patched postMessage, so an empty array is proof the
    // injection did not pass through the bridge.
    expect(win.original).toHaveBeenCalledWith(payload);
    expect(win.forwarded).toEqual([]);
  });

  it('falls back to window.postMessage when the bridge was never installed', () => {
    // No injected script on this page, so window.postMessage is still the
    // page's own and cannot round-trip back to React Native either.
    const win = stubWindow();

    run(buildPagePostScript(payload), win);

    expect(win.original).toHaveBeenCalledWith(payload);
    expect(win.forwarded).toEqual([]);
  });

  it('never throws when there is nothing to post through', () => {
    const win = stubWindow();
    win.postMessage = undefined as unknown as jest.Mock;
    win.__insurelyPostMessagePatched = true;

    expect(() => run(buildPagePostScript(payload), win)).not.toThrow();
  });

  it('escapes a closing script tag in the payload', () => {
    expect(
      buildPagePostScript({
        name: 'X',
        value: '</script><script>alert(1)</script>',
      })
    ).not.toContain('</script>');
  });
});

interface StubWindow {
  insurely: unknown;
  original: jest.Mock;
  postMessage: jest.Mock;
  forwarded: string[];
  __insurelyPostMessage?: unknown;
  __insurelyPostMessagePatched?: boolean;
  ReactNativeWebView: { postMessage: (data: string) => void };
  sessionStorage: { setItem: jest.Mock };
  document: {
    createElement: () => Record<string, unknown>;
    head: { appendChild: jest.Mock };
  };
}

/**
 * A stand-in for the page. `original` is the same mock as the initial
 * `postMessage`, kept under its own name so an assertion can still reach it
 * after the injected script has replaced `postMessage` with the forwarder.
 */
function stubWindow(): StubWindow {
  const original = jest.fn();
  const forwarded: string[] = [];
  return {
    insurely: undefined,
    original,
    postMessage: original,
    forwarded,
    ReactNativeWebView: { postMessage: (data: string) => forwarded.push(data) },
    sessionStorage: { setItem: jest.fn() },
    document: {
      createElement: () => ({}),
      head: { appendChild: jest.fn() },
    },
  };
}

function run(script: string, win: StubWindow): void {
  // eslint-disable-next-line no-new-func
  new Function('window', `with (window) { ${script} }`)(win);
}
