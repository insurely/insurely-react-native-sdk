// Copyright © 2026 Insurely AB. All rights reserved.

import type { InsurelyConfig, InsurelyPrefill } from '../types/config';
import { bootstrapAssetFile } from '../types/environment';

export interface InjectedScriptOptions {
  baseUrl: string;
  config: InsurelyConfig;
  prefill?: InsurelyPrefill;
}

/**
 * Mirrors `Bootstrapper.bootstrapScript` (iOS) and
 * `JavaScriptMessageProcessor.getBootstrapJavaScript` (Android).
 *
 * Ordering matters: `window.insurely` and the postMessage patch must both be in
 * place before mobile-bootstrap runs, because mobile-bootstrap reads the config
 * immediately and navigates. It self-guards on the `moduleInput` query
 * parameter, so re-running this on the resulting page load is safe.
 */
export function buildInjectedScript({
  baseUrl,
  config,
  prefill,
}: InjectedScriptOptions): string {
  // `agent: { type: 'sdk' }` is not part of the public `InsurelyConfig` type —
  // it is supplied by the SDK itself, the same way Blocks' own
  // `mobile-bootstrap.ts` adds `parentOrigin`/`parentUrl`/`isWebView` on top of
  // whatever config it finds on `window.insurely`. Both native SDKs default
  // `agent` to `.sdk`/`Sdk` on every payload (`InsurelyConfiguration.swift`,
  // `Conversion.kt`), and Blocks relies on `agent?.type` being present to know
  // the client can do same-device BankID auth itself (Blocks reads it as
  // `usingSdk` when choosing the auth route). Without it, a bank that
  // supports `SWEDISH_MOBILE_BANKID_SAME_DEVICE_CLIENT_SIDE_AUTHENTICATION` is
  // wrongly diverted into the companion-app flow
  // (`shouldRedirectToCompanionAppInfo` in `SelectCompanyView/utils.ts`), which
  // this SDK does not need — client-side auth is exactly what `InsurelyHttp`
  // implements. `comingFromPlayStore` (the other field the contract's
  // `agentConfigSchema` allows) is Android-companion-app-specific and is
  // deliberately never sent here.
  const payload = jsonForInlineScript({
    config: { ...config, agent: { type: 'sdk' } },
    prefill,
  });
  const assetUrl = `${baseUrl}/assets/${bootstrapAssetFile(baseUrl)}`;

  return `(function() {
  window.insurely = ${payload};

  if (!window.__insurelyPostMessagePatched) {
    window.__insurelyPostMessagePatched = true;
    var originalPostMessage = window.postMessage;
    // INVARIANT (the other end is parseMessage in \`bridge/parse.ts\`): this
    // forwards EVERY window.postMessage call made by the page to React Native
    // without inspecting it, including messages this SDK version has no typed
    // shape for. Deliberately so: a new Blocks message must reach the
    // integrator the day it ships, and Blocks has senders that stamp no origin
    // at all (\`usePostMessageUnsafe\`, which is how its error boundaries report
    // NON_RECOVERABLE_ERROR). parseMessage therefore filters nothing.
    //
    // What keeps the SDK's own injections out of the bridge is \`__insurelyPostMessage\`
    // below, not a filter: it is the pre-patch postMessage, captured here at the
    // moment of patching. \`instructions/executor.ts\` (SUPPLEMENTAL_INFORMATION)
    // and \`InsurelyView.tsx\` (SIGNING_FINISHED) post through it, so they reach
    // the page's own listeners without passing through this forwarder — which is
    // why a bank's response body and its \`Set-Cookie\` array cannot round-trip
    // back out to \`onEvent\` or into the log. Anything the SDK injects that needs
    // to post a message must use \`__insurelyPostMessage\` for the same reason.
    window.__insurelyPostMessage = function(data) {
      var rest = Array.prototype.slice.call(arguments, 1);
      originalPostMessage.apply(window, [data].concat(rest));
    };
    window.postMessage = function(data) {
      var rest = Array.prototype.slice.call(arguments, 1);
      originalPostMessage.apply(window, [data].concat(rest));
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      } catch (error) {
        // A message that cannot be serialized must not break the web app.
      }
    };
  }

  try {
    window.sessionStorage.setItem('insurely_data_collection-preferredSigningMethod', 'SAME');
  } catch (error) {
    // Session storage can be unavailable; signing method selection is not critical.
  }

  if (!window.__insurelyBootstrapInjected) {
    window.__insurelyBootstrapInjected = true;
    var bootstrapScript = document.createElement('script');
    bootstrapScript.id = 'insurely-bootstrap-script';
    bootstrapScript.type = 'module';
    bootstrapScript.src = ${JSON.stringify(assetUrl)};
    document.head.appendChild(bootstrapScript);
  }
})();
true;
`;
}

/**
 * Builds a script that hands `payload` to the page's own `message` listeners
 * *without* it passing through the bridge the injected script installs.
 *
 * This is the mechanism that keeps the SDK's own injections out of the
 * integrator's callbacks and out of the log. It posts through
 * `window.__insurelyPostMessage` — the pre-patch `window.postMessage`, captured
 * by `buildInjectedScript` at the moment it patches — so nothing the SDK sends
 * into the page can come back out of it.
 *
 * The reference is absent only when the injected script has not run on this
 * page, in which case `window.postMessage` is still the page's own and cannot
 * round-trip either; that is the only case in which it is used. Both lookups
 * are guarded, because a missing reference must never throw inside the page.
 */
export function buildPagePostScript(payload: unknown): string {
  return `(function() {
  var post = window.__insurelyPostMessage;
  if (typeof post !== 'function' && !window.__insurelyPostMessagePatched) {
    post = window.postMessage;
  }
  if (typeof post === 'function') {
    post.call(window, ${jsonForInlineScript(payload)});
  }
})(); true;`;
}

/**
 * `</script>` inside a value would close the injected script element, and `<!--`
 * would start an HTML comment. Neither can reach the page intact.
 */
function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
