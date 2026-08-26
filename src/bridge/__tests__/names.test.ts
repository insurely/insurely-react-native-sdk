// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it } from '@jest/globals';
import {
  POST_MESSAGE_NAMES,
  ERROR_MESSAGE_NAMES,
  ACTION_MESSAGE_NAMES,
} from '../names';

describe('post message names', () => {
  it('covers the messages the native SDKs already handle', () => {
    for (const name of [
      'APP_CLOSE',
      'APP_LOADED',
      'AUTH_TOKEN_EXPIRING_SOON',
      'COLLECTION_ID',
      'COLLECTION_INITIATED',
      'COLLECTION_STATUS',
      'INVALID_AUTH_TOKEN',
      'INVALID_CREDENTIALS',
      'OPEN_SWEDISH_BANKID',
      'PAGE_VIEW',
      'RESULTS',
      'RETURN_TO_BROWSER',
      'SELECTED_AUTHENTICATION_METHOD',
      'SELECTED_COMPANY',
      'SKIP_PRESSED',
      'VALID_AUTH_TOKEN',
      'WAITING_FOR_INITIALIZATION',
    ]) {
      expect(POST_MESSAGE_NAMES).toContain(name);
    }
  });

  it('covers messages Blocks sends that no native SDK handles', () => {
    for (const name of [
      'ERROR',
      'NON_RECOVERABLE_ERROR',
      'CANCEL_COLLECTION_PRESSED',
      'DESELECTED_COMPANY',
      'SIGNING_FINISHED',
      'CONTACT_DETAILS',
      'COLLECTION_GROUP_CREATED',
      'REDIRECT',
      'OPEN_DANISH_MITID',
    ]) {
      expect(POST_MESSAGE_NAMES).toContain(name);
    }
  });

  it('routes errors by Blocks naming', () => {
    expect([...ERROR_MESSAGE_NAMES].sort()).toEqual(
      [
        'ERROR',
        'INVALID_AUTH_TOKEN',
        'INVALID_CREDENTIALS',
        'NON_RECOVERABLE_ERROR',
      ].sort()
    );
  });

  it('does not treat QUOTE_ERROR as an SDK error', () => {
    expect(ERROR_MESSAGE_NAMES).not.toContain('QUOTE_ERROR');
  });

  it('lists exactly the messages needing a platform action', () => {
    expect([...ACTION_MESSAGE_NAMES].sort()).toEqual(
      [
        'OPEN_AUTHENTICATION_APP',
        'OPEN_COMPANION_APP',
        'OPEN_DANISH_MITID',
        'OPEN_FRENCH_TRUST_ME',
        'OPEN_SWEDISH_BANKID',
        'REDIRECT',
        'RETURN_TO_BROWSER',
      ].sort()
    );
  });

  it('excludes messages mobile-bootstrap handles itself', () => {
    for (const name of ['SCROLL_TO_TOP', 'SCROLL_TO_POSITION', 'APP_CENTER']) {
      expect(ACTION_MESSAGE_NAMES).not.toContain(name);
    }
  });
});
