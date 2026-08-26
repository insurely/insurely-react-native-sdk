// Copyright © 2026 Insurely AB. All rights reserved.

import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface HttpRequest {
  url: string;
  method: string;
  headers: { [key: string]: string };
  body?: string;
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
  }>;
}

export interface HttpResult {
  status: number;
  /** Values are always arrays; Set-Cookie must never be comma-joined. */
  headers: { [key: string]: string[] };
  body: string;
  finalUrl: string;
  setCookie: string[];
}

export interface Spec extends TurboModule {
  execute(request: HttpRequest): Promise<HttpResult>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('InsurelyHttp');
