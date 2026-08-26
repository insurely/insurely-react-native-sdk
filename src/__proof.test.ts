// Copyright © 2026 Insurely AB. All rights reserved.
import { describe, it } from '@jest/globals';
import { buildInjectedScript } from './bridge/injected';
import { buildSupplementalScript } from './instructions/executor';
import { parseMessage } from './bridge/parse';

describe('end-to-end proof', () => {
  it('prints the real bridge behaviour', () => {
    const pagePosted: unknown[] = [];
    const bridge: string[] = [];
    const page = {
      insurely: undefined as unknown,
      postMessage: (data: unknown) => pagePosted.push(data),
      ReactNativeWebView: { postMessage: (d: string) => bridge.push(d) },
      sessionStorage: { setItem: () => {} },
      document: { createElement: () => ({}), head: { appendChild: () => {} } },
    };
    const run = (script: string) =>
      // eslint-disable-next-line no-new-func
      new Function('window', `with (window) { ${script} }`)(page);

    // 1. The REAL injected script, exactly as the WebView receives it.
    run(
      buildInjectedScript({
        baseUrl: 'https://blocks.insurely.com',
        config: { customerId: 'c1', configName: 'cfg' },
      })
    );

    // 2. Blocks' error boundary crashes, posting through usePostMessageUnsafe:
    //    { name, value }, NO origin stamp, straight at window.postMessage.
    (page.postMessage as (d: unknown) => void)({
      name: 'NON_RECOVERABLE_ERROR',
      value: 'ChunkLoadError: Loading chunk 42 failed',
    });

    // 3. The REAL supplemental script the executor builds for a bank response.
    run(
      buildSupplementalScript({
        status: 200,
        headers: { 'content-type': ['text/html'] },
        body: '<html>bank session for 19900101-1234</html>',
        finalUrl: 'https://bank.example/step/final',
        setCookie: ['sid=SECRET-SESSION; Path=/; HttpOnly'],
      })
    );

    console.log('\n===== WHAT REACHED THE REACT NATIVE BRIDGE =====');
    console.log(JSON.stringify(bridge, null, 2));
    console.log('\n===== PARSED FROM EACH BRIDGE MESSAGE =====');
    for (const raw of bridge) {
      console.log(JSON.stringify(parseMessage(raw)?.dispatch, null, 2));
    }
    console.log('\n===== WHAT REACHED THE PAGE (Blocks) =====');
    console.log(
      JSON.stringify(
        pagePosted.map((p) => (p as { name?: string }).name),
        null,
        2
      )
    );
    console.log('\nbridge message count:', bridge.length);
    console.log('page message count:', pagePosted.length);
    console.log(
      'bridge carried the response body:',
      bridge.some((b) => b.includes('bank session'))
    );
    console.log(
      'bridge carried Set-Cookie:',
      bridge.some((b) => b.includes('SECRET-SESSION'))
    );
  });
});
