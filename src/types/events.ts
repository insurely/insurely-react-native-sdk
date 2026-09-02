// Copyright © 2026 Insurely AB. All rights reserved.

/** Parsed page identity; `raw` is always the string Blocks sent. */
export type PageView =
  | 'SELECT_COMPANIES'
  | 'SELECT_AUTHENTICATION'
  | 'ADDITIONAL_INFO'
  | 'COLLECT_DATA'
  | 'FAILED_COLLECTION'
  | 'RESULTS'
  | 'EMPTY_RESULT'
  | 'INSURANCE_DETAILS'
  | 'OTHER';

export type CollectionStatus =
  | 'RUNNING'
  | 'LOGIN'
  | 'TWO_FACTOR_PENDING'
  | 'COLLECTING'
  | 'COMPLETED_PARTIAL'
  | 'COMPLETED'
  | 'COMPLETED_EMPTY'
  | 'USER_INPUT'
  | 'FAILED'
  | 'WAITING_FOR_AUTHENTICATION'
  | 'INCORRECT_CREDENTIALS'
  | 'OTHER';

export type OpenUrlKind =
  'bankid' | 'mitid' | 'auth-app' | 'browser' | 'redirect' | 'companion-app';

/**
 * The collection payload, handed over exactly as the Insurely API returned it —
 * the SDK does not reshape it. It is a flat array of the raw items collected
 * across every company in the session.
 *
 * Its schema is the Wealth/Insurance/Pension API response schema for the API
 * version pinned in your Blocks configuration, which is why the SDK cannot
 * narrow it: the same SDK build serves configs on different versions and
 * different markets. See https://docs.insurely.com for the schema of yours.
 *
 * Supply your own type to skip the cast:
 *
 * ```tsx
 * <InsurelyView<MyCollectedItem[]>
 *   onResults={(results) => save(results.data)} // results.data: MyCollectedItem[]
 * />
 * ```
 *
 * Note that changing your configuration's API version changes this payload.
 */
export interface InsurelyResults<TData = unknown> {
  data: TData;
}

export type InsurelyEvent =
  | { type: 'APP_CLOSE'; value?: unknown }
  | { type: 'APP_LOADED'; value?: unknown }
  | { type: 'WAITING_FOR_INITIALIZATION'; value?: unknown }
  | { type: 'PAGE_VIEW'; page: PageView; raw: string }
  | { type: 'COLLECTION_STATUS'; status: CollectionStatus; raw: string }
  | { type: 'COLLECTION_ID'; collectionId: string }
  | { type: 'COLLECTION_INITIATED'; personalNumber?: string }
  | { type: 'SELECTED_COMPANY'; company: string }
  | { type: 'DESELECTED_COMPANY'; company: string }
  | { type: 'SELECTED_AUTHENTICATION_METHOD'; method: string }
  | { type: 'SKIP_PRESSED'; value?: unknown }
  | { type: 'CANCEL_COLLECTION_PRESSED'; value?: unknown }
  | { type: 'AUTH_TOKEN_EXPIRING_SOON'; value?: unknown }
  | { type: 'VALID_AUTH_TOKEN'; value?: unknown }
  | { type: 'SIGNING_FINISHED'; value?: unknown }
  | { type: 'OPEN_SWEDISH_BANKID'; url: string; autostartToken?: string }
  | { type: 'OPEN_DANISH_MITID'; url: string }
  | { type: 'OPEN_FRENCH_TRUST_ME'; url: string }
  | { type: 'OPEN_AUTHENTICATION_APP'; url: string }
  | { type: 'OPEN_COMPANION_APP'; url: string }
  | { type: 'REDIRECT'; url: string }
  | { type: 'RETURN_TO_BROWSER'; url: string }
  /**
   * Any message the SDK has no typed member for, including ones Blocks adds
   * after this release. Never dropped — unlike the iOS and Android SDKs.
   */
  | {
      type: 'UNKNOWN';
      name: string;
      value?: unknown;
      extraInformation?: unknown;
    };

/**
 * Metadata about one successfully executed HTTP instruction — the only place
 * this SDK contacts a third party (a bank endpoint) from the integrator's app,
 * under their bundle identifier.
 *
 * Deliberately metadata only: never request or response headers, never a body,
 * never cookies. It exists so an integrator can tell "no instruction was ever
 * issued" apart from "instructions are running fine", which are opposite
 * diagnoses for the same stuck-collection symptom.
 */
export interface InsurelyInstructionInfo {
  /** The URL Blocks asked the SDK to request. */
  url: string;
  /** HTTP status of the final response. */
  status: number;
  /** The URL the redirect chain settled on. */
  finalUrl: string;
}

export type InsurelyError =
  | { code: 'ERROR'; value?: unknown }
  | { code: 'NON_RECOVERABLE_ERROR'; value?: unknown }
  | { code: 'INVALID_CREDENTIALS'; value?: unknown }
  | { code: 'INVALID_AUTH_TOKEN'; value?: unknown }
  | { code: 'BANKID_NOT_INSTALLED'; url: string }
  | { code: 'AUTH_APP_NOT_AVAILABLE'; url: string }
  | {
      code: 'INSTRUCTION_FAILED';
      url: string;
      status?: number;
      message: string;
    }
  /**
   * The WebView could not load Blocks at all — no network, DNS failure, TLS
   * failure, or an HTTP error response from the Blocks host. Without this the
   * integrator gets a blank view and no signal whatsoever.
   *
   * `status` is present only for an HTTP error response (`onHttpError`); a
   * transport-level failure (`onError`) has no status.
   */
  | {
      code: 'LOAD_FAILED';
      url: string;
      status?: number;
      message: string;
    };
