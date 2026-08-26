// Copyright © 2026 Insurely AB. All rights reserved.

import type {
  CollectionStatus,
  InsurelyError,
  InsurelyEvent,
  InsurelyResults,
  OpenUrlKind,
  PageView,
} from '../types/events';
import { isErrorMessage } from './names';

export interface OpenUrlAction {
  kind: OpenUrlKind;
  url: string;
  autostartToken?: string;
}

export interface InstructionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
}

export interface InstructionRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  cookies?: InstructionCookie[];
  etag: string;
}

export type Dispatch =
  | { type: 'event'; event: InsurelyEvent }
  | { type: 'results'; results: InsurelyResults }
  | { type: 'error'; error: InsurelyError };

export interface ParsedMessage {
  dispatch: Dispatch;
  action?: OpenUrlAction;
  instruction?: InstructionRequest;
}

const PAGE_VIEWS: Record<string, PageView> = {
  DATA_AGGREGATION_SELECT_COMPANIES: 'SELECT_COMPANIES',
  DATA_AGGREGATION_SELECT_AUTHENTICATION: 'SELECT_AUTHENTICATION',
  DATA_AGGREGATION_ADDITIONAL_INFO: 'ADDITIONAL_INFO',
  DATA_AGGREGATION_COLLECT_DATA: 'COLLECT_DATA',
  DATA_AGGREGATION_FAILED_COLLECTION: 'FAILED_COLLECTION',
  DATA_AGGREGATION_RESULTS: 'RESULTS',
  DATA_AGGREGATION_EMPTY_RESULT: 'EMPTY_RESULT',
  DATA_AGGREGATION_INSURANCE_DETAILS: 'INSURANCE_DETAILS',
};

const COLLECTION_STATUSES: Record<string, CollectionStatus> = {
  'RUNNING': 'RUNNING',
  'LOGIN': 'LOGIN',
  'TWO FACTOR PENDING': 'TWO_FACTOR_PENDING',
  'COLLECTING': 'COLLECTING',
  'COMPLETED PARTIAL': 'COMPLETED_PARTIAL',
  'COMPLETED': 'COMPLETED',
  'COMPLETED EMPTY': 'COMPLETED_EMPTY',
  'USER INPUT': 'USER_INPUT',
  'FAILED': 'FAILED',
  'WAITING FOR AUTHENTICATION': 'WAITING_FOR_AUTHENTICATION',
  'INCORRECT CREDENTIALS': 'INCORRECT_CREDENTIALS',
};

const ACTION_KINDS: Record<string, OpenUrlKind> = {
  OPEN_SWEDISH_BANKID: 'bankid',
  OPEN_DANISH_MITID: 'mitid',
  OPEN_FRENCH_TRUST_ME: 'auth-app',
  OPEN_AUTHENTICATION_APP: 'auth-app',
  OPEN_COMPANION_APP: 'companion-app',
  REDIRECT: 'redirect',
  RETURN_TO_BROWSER: 'browser',
};

interface Envelope {
  name?: unknown;
  value?: unknown;
  extraInformation?: unknown;
}

/**
 * INVARIANT (the other end is the postMessage patch in `bridge/injected.ts`):
 * everything that arrives here was posted by the page, never by the SDK.
 *
 * That holds by construction, not by filtering. The patch captures the page's
 * pre-patch `window.postMessage` as `window.__insurelyPostMessage`, and the
 * SDK's own injections — SUPPLEMENTAL_INFORMATION from
 * `instructions/executor.ts`, SIGNING_FINISHED from `InsurelyView.tsx`, both via
 * `buildPagePostScript` — post through *that*, bypassing the forwarder. So the
 * bank response body and `Set-Cookie` array they carry can never round-trip
 * back out to `onEvent` or into the trace log, and any new SDK-side injection
 * inherits the same property as long as it uses `buildPagePostScript`.
 *
 * Consequently this parser filters on nothing but shape. In particular it does
 * *not* require an `origin: 'insurely'` stamp: Blocks has a second sender,
 * `usePostMessageUnsafe`, which stamps no origin and is what both of its error
 * boundaries use to report NON_RECOVERABLE_ERROR. Filtering on the stamp
 * silences exactly the message the integrator most needs — a Blocks crash — and
 * a name allow-list is no substitute, because SUPPLEMENTAL_INFORMATION and
 * SIGNING_FINISHED are real Blocks message names and because dropping unknown
 * names would break the forward-compatible UNKNOWN forwarding this SDK exists
 * to provide.
 */
export function parseMessage(raw: string): ParsedMessage | null {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
  } catch {
    return null;
  }
  if (!envelope || typeof envelope.name !== 'string') return null;

  const { name, value, extraInformation } = envelope as Envelope & {
    name: string;
  };

  return {
    // dispatch and action are derived independently: a malformed action
    // payload (e.g. REDIRECT with no usable URL) still produces an event —
    // toAction suppresses the action, but the event is never dropped.
    dispatch: toDispatch(name, value, extraInformation),
    action: toAction(name, value),
    instruction: toInstruction(extraInformation),
  };
}

function toDispatch(
  name: string,
  value: unknown,
  extraInformation: unknown
): Dispatch {
  if (name === 'RESULTS') {
    return { type: 'results', results: { data: value } };
  }
  if (isErrorMessage(name)) {
    // isErrorMessage narrows `name` to the 4 literals in ERROR_MESSAGE_NAMES,
    // not to a specific InsurelyError branch, so the cast still relies on
    // each of those 4 InsurelyError variants having exactly `{ code, value? }`
    // shape — true today, but not enforced by the type system.
    return { type: 'error', error: { code: name, value } as InsurelyError };
  }
  return { type: 'event', event: toEvent(name, value, extraInformation) };
}

function toEvent(
  name: string,
  value: unknown,
  extraInformation: unknown
): InsurelyEvent {
  switch (name) {
    case 'APP_CLOSE':
    case 'APP_LOADED':
    case 'WAITING_FOR_INITIALIZATION':
    case 'SKIP_PRESSED':
    case 'CANCEL_COLLECTION_PRESSED':
    case 'AUTH_TOKEN_EXPIRING_SOON':
    case 'VALID_AUTH_TOKEN':
    case 'SIGNING_FINISHED':
      return { type: name, value };
    case 'PAGE_VIEW': {
      const raw = asString(value);
      return { type: 'PAGE_VIEW', page: PAGE_VIEWS[raw] ?? 'OTHER', raw };
    }
    case 'COLLECTION_STATUS': {
      const raw = asString(value);
      return {
        type: 'COLLECTION_STATUS',
        status: COLLECTION_STATUSES[raw.toUpperCase()] ?? 'OTHER',
        raw,
      };
    }
    case 'COLLECTION_ID':
      return { type: 'COLLECTION_ID', collectionId: asString(value) };
    case 'COLLECTION_INITIATED':
      return {
        type: 'COLLECTION_INITIATED',
        personalNumber: readString(value, 'personalNumber'),
      };
    case 'SELECTED_COMPANY':
      return { type: 'SELECTED_COMPANY', company: asString(value) };
    case 'DESELECTED_COMPANY':
      return { type: 'DESELECTED_COMPANY', company: asString(value) };
    case 'SELECTED_AUTHENTICATION_METHOD':
      return {
        type: 'SELECTED_AUTHENTICATION_METHOD',
        method: asString(value),
      };
    case 'OPEN_SWEDISH_BANKID':
      return {
        type: 'OPEN_SWEDISH_BANKID',
        url: readString(value, 'url') ?? '',
        autostartToken: readString(value, 'autostartToken'),
      };
    case 'OPEN_DANISH_MITID':
    case 'OPEN_FRENCH_TRUST_ME':
    case 'OPEN_AUTHENTICATION_APP':
    case 'OPEN_COMPANION_APP':
    case 'REDIRECT':
    case 'RETURN_TO_BROWSER':
      return { type: name, url: urlFrom(value) ?? '' };
    default:
      return { type: 'UNKNOWN', name, value, extraInformation };
  }
}

function toAction(name: string, value: unknown): OpenUrlAction | undefined {
  const kind = ACTION_KINDS[name];
  if (!kind) return undefined;
  const url = urlFrom(value);
  if (!url) return undefined;
  const action: OpenUrlAction = { kind, url };
  const autostartToken = readString(value, 'autostartToken');
  if (autostartToken !== undefined) action.autostartToken = autostartToken;
  return action;
}

function toInstruction(
  extraInformation: unknown
): InstructionRequest | undefined {
  if (!isRecord(extraInformation)) return undefined;
  const instruction = extraInformation.INSTRUCTIONS_V2;
  if (!isRecord(instruction) || !isRecord(instruction.request))
    return undefined;

  const request = instruction.request;
  if (
    typeof request.url !== 'string' ||
    request.url === '' ||
    typeof request.etag !== 'string' ||
    request.etag === ''
  )
    return undefined;

  const headers = toHeaders(request.headers);
  if (headers === undefined) return undefined;

  const cookies = toCookies(request.cookies);
  if (cookies === 'invalid') return undefined;

  return {
    url: request.url,
    method: typeof request.method === 'string' ? request.method : 'GET',
    headers,
    body: typeof request.body === 'string' ? request.body : undefined,
    cookies,
    etag: request.etag,
  };
}

/**
 * Validates `request.headers`. Returns `{}` when absent or null, the validated
 * headers when every key and value is a string, or `undefined` when present
 * but malformed — the caller must then fail the whole instruction closed.
 */
function toHeaders(headers: unknown): Record<string, string> | undefined {
  if (headers === undefined || headers === null) return {};
  if (!isRecord(headers)) return undefined;
  for (const [key, val] of Object.entries(headers)) {
    if (typeof key !== 'string' || typeof val !== 'string') return undefined;
  }
  return headers as Record<string, string>;
}

/**
 * Validates `request.cookies`. Returns `undefined` when absent or null,
 * the validated cookies when every element has the right shape, or the
 * sentinel `'invalid'` when present but malformed — the caller must then
 * fail the whole instruction closed.
 */
function toCookies(
  cookies: unknown
): InstructionCookie[] | undefined | 'invalid' {
  if (cookies === undefined || cookies === null) return undefined;
  if (!Array.isArray(cookies)) return 'invalid';
  for (const cookie of cookies) {
    if (!isValidCookie(cookie)) return 'invalid';
  }
  return cookies as InstructionCookie[];
}

function isValidCookie(cookie: unknown): cookie is InstructionCookie {
  if (!isRecord(cookie)) return false;
  return (
    typeof cookie.name === 'string' &&
    typeof cookie.value === 'string' &&
    typeof cookie.domain === 'string' &&
    typeof cookie.path === 'string' &&
    typeof cookie.secure === 'boolean' &&
    typeof cookie.httpOnly === 'boolean'
  );
}

/** Blocks sends some URLs bare and others wrapped in `{ url }`. Accept both. */
function urlFrom(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return readString(value, 'url');
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return typeof found === 'string' ? found : undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
