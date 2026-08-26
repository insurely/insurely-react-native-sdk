// Copyright © 2026 Insurely AB. All rights reserved.

import { buildPagePostScript } from '../bridge/injected';
import type { InstructionRequest } from '../bridge/parse';
import type { HttpRequest, HttpResult } from '../native/NativeInsurelyHttp';
import type { InsurelyError, InsurelyInstructionInfo } from '../types/events';

export interface InsurelyHttp {
  execute(request: HttpRequest): Promise<HttpResult>;
}

export type InstructionOutcome =
  | { script: string; info: InsurelyInstructionInfo }
  | { error: InsurelyError }
  | null;

/**
 * Owns instruction policy; the native module owns transport only.
 *
 * Blocks puts an HTTP request in `extraInformation.INSTRUCTIONS_V2` that has to
 * be made outside the WebView, then expects the response posted back as
 * SUPPLEMENTAL_INFORMATION. Instructions repeat across COLLECTION_STATUS
 * messages, so the ETag dedupe is required, not an optimisation.
 */
export class InstructionExecutor {
  private readonly executed = new Set<string>();

  /**
   * Bumped by every `reset()`, captured by every `execute()`. An instruction
   * whose generation no longer matches belongs to a session that has been torn
   * down; see `isStale`.
   */
  private generation = 0;

  constructor(private readonly http: InsurelyHttp) {}

  /**
   * Forgets every ETag seen so far and invalidates any instruction still in
   * flight.
   *
   * The dedupe set is scoped to a Blocks *session*, not to the component: a
   * `reload()` starts a fresh session in the same component, and Blocks is free
   * to reissue an ETag it already used. Without this, the second collection's
   * first repeated instruction would be skipped silently and the collection
   * would stall with no error anywhere.
   */
  reset(): void {
    this.executed.clear();
    this.generation += 1;
  }

  async execute(request: InstructionRequest): Promise<InstructionOutcome> {
    if (this.executed.has(request.etag)) return null;
    // Mark the instruction as executed *before* making the request. A failed
    // instruction (rejection or non-2xx) is therefore not retried; Blocks
    // repeats instructions across polling cycles and retrying on every repeat
    // would produce a retry storm against a bank endpoint. Both production
    // native SDKs (iOS, Android) follow the same pattern. Failures reach the
    // integrator as INSTRUCTION_FAILED events through onError.
    this.executed.add(request.etag);

    // Captured before the await. A `reset()` (i.e. a `reload()`) that lands
    // while the request is in flight ends the session this instruction belongs
    // to: its response must not be injected into the session that replaced it,
    // and must not reach `onInstruction` or `onError` either. The fresh session
    // reissues whatever it still needs, having forgotten this ETag.
    const generation = this.generation;

    let result: HttpResult;
    try {
      result = await this.http.execute({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        cookies: request.cookies,
      });
    } catch (error) {
      if (this.isStale(generation)) return null;
      return {
        error: {
          code: 'INSTRUCTION_FAILED',
          url: request.url,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (this.isStale(generation)) return null;

    if (result.status < 200 || result.status > 299) {
      return {
        error: {
          code: 'INSTRUCTION_FAILED',
          url: request.url,
          status: result.status,
          message: `HTTP ${result.status}`,
        },
      };
    }

    return {
      script: buildSupplementalScript(result),
      // Metadata only, by design: this is what reaches the integrator's
      // `onInstruction`. Headers, body and cookies must never be added here.
      info: {
        url: request.url,
        status: result.status,
        finalUrl: result.finalUrl,
      },
    };
  }

  /** True once a `reset()` has happened since `generation` was captured. */
  private isStale(generation: number): boolean {
    return generation !== this.generation;
  }
}

export function buildSupplementalScript(result: HttpResult): string {
  const headers: Record<string, string[]> = { ...result.headers };
  headers['x-final-url'] = [result.finalUrl];
  if (result.setCookie.length > 0) {
    headers['Set-Cookie'] = result.setCookie;
  }

  const payload = {
    name: 'SUPPLEMENTAL_INFORMATION',
    value: {
      type: 'RESPONSE_OBJECT',
      headers,
      // "The response body, in the format it was responded, e.g. html or json."
      response: parseIfJson(result.body),
    },
  };

  // Posted through the pre-patch postMessage, never through the bridge: this
  // payload carries the bank's response body and its un-joined `Set-Cookie`
  // array, and must reach Blocks without ever coming back out to `onEvent` or
  // into the trace log.
  return buildPagePostScript(payload);
}

function parseIfJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
