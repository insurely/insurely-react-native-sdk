// Copyright © 2026 Insurely AB. All rights reserved.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';

import { buildInjectedScript, buildPagePostScript } from './bridge/injected';
import { parseMessage } from './bridge/parse';
import { InstructionExecutor } from './instructions/executor';
import { performAction } from './links/openUrl';
import { watchForSigningFinished } from './links/signingFinished';
import { createLogger, type InsurelyLogLevel } from './logging';
import NativeInsurelyHttp from './native/NativeInsurelyHttp';
import {
  validateSettings,
  warnOnUnreachableResults,
  type InsurelyConfig,
  type InsurelyLanguage,
  type InsurelyPrefill,
} from './types/config';
import {
  resolveEnvironmentUrl,
  type InsurelyEnvironment,
} from './types/environment';
import type {
  InsurelyError,
  InsurelyEvent,
  InsurelyInstructionInfo,
  InsurelyResults,
  OpenUrlKind,
} from './types/events';

/**
 * Structural subsets of `react-native-webview`'s own event types. That package
 * re-exports only `WebViewMessageEvent`, `WebViewNavigation` and `FileDownload`
 * from its root, so the three below are declared here rather than deep-imported
 * from `react-native-webview/lib/WebViewTypes` — a path the package makes no
 * promise about. Assignment to the real props still type-checks, because the
 * real event types are supersets of these.
 */
interface WebViewLoadErrorEvent {
  nativeEvent: { url: string; code: number; description: string };
}

interface WebViewLoadHttpErrorEvent {
  // `description` is optional because iOS never sends one — only Android's
  // `onReceivedHttpError` fills it in. The real prop type declares it
  // required; a required string is still assignable to an optional one, so
  // widening it here keeps the assignment type-checking while forcing the
  // `||` fallback below to be honest about what arrives on iOS.
  nativeEvent: { url: string; description?: string; statusCode: number };
}

interface WebViewLoadRequest {
  url: string;
  isTopFrame: boolean;
}

export interface InsurelyViewProps {
  environment: InsurelyEnvironment;
  config: InsurelyConfig;
  prefill?: InsurelyPrefill;
  /** URL scheme or universal link that returns the user to your app after BankID. */
  bankIdRedirectUrl?: string;
  onResults?: (results: InsurelyResults) => void;
  onEvent?: (event: InsurelyEvent) => void;
  /**
   * Every failure the SDK detects, including `LOAD_FAILED` when the WebView
   * cannot load Blocks at all (no network, DNS failure, or an HTTP error from
   * the Blocks host).
   */
  onError?: (error: InsurelyError) => void;
  /**
   * Fired after each HTTP instruction the SDK executes against a bank endpoint
   * on Blocks' behalf. Metadata only — never headers, body or cookies.
   */
  onInstruction?: (info: InsurelyInstructionInfo) => void;
  /** Return true to open the URL yourself; the SDK then does nothing. */
  onOpenUrl?: (url: string, kind: OpenUrlKind) => boolean;
  logLevel?: InsurelyLogLevel;
  style?: StyleProp<ViewStyle>;
}

export interface InsurelyHandle {
  changeLanguage(language: InsurelyLanguage): void;
  updateAuthToken(token?: string): void;
  reload(): void;
}

export const InsurelyView = forwardRef<InsurelyHandle, InsurelyViewProps>(
  function InsurelyViewComponent(
    {
      environment,
      config,
      prefill,
      bankIdRedirectUrl,
      onResults,
      onEvent,
      onError,
      onInstruction,
      onOpenUrl,
      logLevel,
      style,
    },
    ref
  ) {
    const webViewRef = useRef<WebView<{}>>(null);
    const cancelSigningWatch = useRef<(() => void) | null>(null);

    const level: InsurelyLogLevel = logLevel ?? (__DEV__ ? 'all' : 'none');
    const log = useMemo(() => createLogger(level), [level]);

    validateSettings(config, prefill);

    // Warn once per configuration change, not on every render: Blocks will not
    // post RESULTS at all when sendPostMessages is false, so onResults can
    // never fire and the integrator has nothing to go on.
    const sendPostMessages = config.sendPostMessages;
    const hasResultsHandler = onResults !== undefined;
    useEffect(() => {
      warnOnUnreachableResults(sendPostMessages, hasResultsHandler);
    }, [sendPostMessages, hasResultsHandler]);

    const baseUrl = useMemo(
      () => resolveEnvironmentUrl(environment),
      [environment]
    );
    const injectedJavaScript = useMemo(
      () => buildInjectedScript({ baseUrl, config, prefill }),
      [baseUrl, config, prefill]
    );
    const executor = useMemo(
      () => new InstructionExecutor(NativeInsurelyHttp),
      []
    );

    // The top frame's current URL, which is what navigation interception has to
    // compare against — not `baseUrl`. A redirect-based bank authentication
    // moves the top frame off the Blocks host for the rest of the flow, and
    // comparing against `baseUrl` would eject every navigation from that point
    // on into the system browser, permanently. Android's shipping SDK compares
    // against `view.url` for exactly this reason.
    const currentUrl = useRef(baseUrl);
    useEffect(() => {
      currentUrl.current = baseUrl;
    }, [baseUrl]);

    const post = useCallback((script: string) => {
      webViewRef.current?.injectJavaScript(script);
    }, []);

    // Cancels a pending BankID return watch on unmount so the AppState
    // listener registered by watchForSigningFinished never outlives the
    // screen the user was sent to BankID from.
    useEffect(() => () => cancelSigningWatch.current?.(), []);

    useImperativeHandle(
      ref,
      () => ({
        changeLanguage(language) {
          post(
            `(function(){ window.insurely && window.insurely.changeLanguage(${JSON.stringify(language)}); })(); true;`
          );
        },
        updateAuthToken(token) {
          post(
            `(function(){ window.insurely && window.insurely.updateAuthToken(${JSON.stringify(token ?? null)}); })(); true;`
          );
        },
        reload() {
          // A reload starts a fresh Blocks session, which is free to reuse an
          // ETag from the session being torn down. Without this the first
          // repeated instruction after a reload is deduped away and the new
          // collection stalls with no error anywhere.
          executor.reset();
          // `currentUrl` is deliberately not reset here: reload() reloads
          // whatever the top frame currently holds, and onNavigationStateChange
          // reports the result either way.
          webViewRef.current?.reload();
        },
      }),
      [executor, post]
    );

    const handleMessage = useCallback(
      (messageEvent: WebViewMessageEvent) => {
        const parsed = parseMessage(messageEvent.nativeEvent.data);
        if (!parsed) return;

        log.trace('message', parsed.dispatch);

        switch (parsed.dispatch.type) {
          case 'results':
            onResults?.(parsed.dispatch.results);
            break;
          case 'error':
            onError?.(parsed.dispatch.error);
            break;
          case 'event':
            onEvent?.(parsed.dispatch.event);
            break;
        }

        if (parsed.action) {
          const action = parsed.action;

          if (action.kind === 'bankid') {
            // One-shot, BankID only: Blocks uses SIGNING_FINISHED as a
            // Handelsbanken two-factor workaround. Firing it on every foreground
            // would post spurious two-factor codes.
            cancelSigningWatch.current?.();
            cancelSigningWatch.current = watchForSigningFinished(() => {
              cancelSigningWatch.current = null;
              // Through the page's pre-patch postMessage, not the bridge: an
              // SDK injection must never come back out to the integrator's
              // callbacks. See the invariant in `bridge/parse.ts`.
              post(buildPagePostScript({ name: 'SIGNING_FINISHED' }));
            });
          }

          performAction(action, { bankIdRedirectUrl, onOpenUrl }).then(
            (error) => {
              if (error) {
                log.error('failed to open url', error);
                onError?.(error);
              }
            }
          );
        }

        if (parsed.instruction) {
          executor.execute(parsed.instruction).then((outcome) => {
            if (!outcome) return;
            if ('error' in outcome) {
              log.error('instruction failed', outcome.error);
              onError?.(outcome.error);
              return;
            }
            post(outcome.script);
            onInstruction?.(outcome.info);
          });
        }
      },
      [
        bankIdRedirectUrl,
        executor,
        log,
        onError,
        onEvent,
        onInstruction,
        onOpenUrl,
        onResults,
        post,
      ]
    );

    const reportLoadFailure = useCallback(
      (error: InsurelyError) => {
        log.error('failed to load', error);
        onError?.(error);
      },
      [log, onError]
    );

    const handleLoadError = useCallback(
      (event: WebViewLoadErrorEvent) => {
        const { url, description, code } = event.nativeEvent;
        reportLoadFailure({
          code: 'LOAD_FAILED',
          url: url || baseUrl,
          message: description || `WebView error ${code}`,
        });
      },
      [baseUrl, reportLoadFailure]
    );

    const handleHttpError = useCallback(
      (event: WebViewLoadHttpErrorEvent) => {
        const { url, description, statusCode } = event.nativeEvent;
        reportLoadFailure({
          code: 'LOAD_FAILED',
          url: url || baseUrl,
          status: statusCode,
          message: description || `HTTP ${statusCode}`,
        });
      },
      [baseUrl, reportLoadFailure]
    );

    const handleNavigationStateChange = useCallback(
      (state: WebViewNavigation) => {
        // Only http(s) URLs, because `currentUrl` exists solely to be compared
        // by origin in `handleShouldStartLoad`. `handleShouldStartLoad`
        // deliberately lets non-http(s) top-frame navigation through, and
        // recording the `about:blank`, `data:` or `blob:` URL that results
        // would leave `originOf(currentUrl.current)` null — after which
        // `sameOrigin` is false for every later top-frame navigation and the
        // whole remaining flow is handed to the system browser.
        if (isWebUrl(state.url)) currentUrl.current = state.url;
      },
      []
    );

    const handleShouldStartLoad = useCallback(
      (request: WebViewLoadRequest) => {
        // react-native-webview fires this for sub-frame navigation too. Blocks
        // legitimately loads cross-origin iframes, and handing one to the
        // system browser would tear the user out of a live flow.
        if (!request.isTopFrame) return true;

        // Non-http(s) targets (`about:blank`, `blob:`, `data:`) are the
        // WebView's own business and are meaningless to `Linking.openURL`.
        // App-scheme launches (BankID and friends) never arrive here — Blocks
        // asks for those over the message bridge instead.
        if (!isWebUrl(request.url)) return true;

        if (sameOrigin(request.url, currentUrl.current)) return true;

        performAction(
          { kind: 'browser', url: request.url },
          { onOpenUrl }
        ).then((error) => {
          if (error) {
            log.error('failed to open url', error);
            onError?.(error);
          }
        });
        return false;
      },
      [log, onError, onOpenUrl]
    );

    return (
      <WebView<{}>
        ref={webViewRef}
        style={style}
        source={{ uri: baseUrl }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScript={injectedJavaScript}
        onMessage={handleMessage}
        onError={handleLoadError}
        onHttpError={handleHttpError}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
      />
    );
  }
);

/**
 * Origin of an http(s) URL, lowercased, or null for anything else — including
 * `about:`, `blob:`, `data:` and app schemes, none of which have an origin a
 * navigation decision can be made from.
 */
function originOf(url: string): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(url);
  if (!match) return null;
  return `${match[1]!.toLowerCase()}://${match[2]!.toLowerCase()}`;
}

function isWebUrl(url: string): boolean {
  return originOf(url) !== null;
}

function sameOrigin(candidate: string, current: string): boolean {
  const origin = originOf(candidate);
  return origin !== null && origin === originOf(current);
}
