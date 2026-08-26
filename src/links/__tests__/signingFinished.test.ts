// Copyright © 2026 Insurely AB. All rights reserved.

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { AppState } from 'react-native';
import { watchForSigningFinished } from '../signingFinished';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
}));

type AddEventListener = (
  event: 'change',
  listener: (state: string) => void
) => { remove: () => void };

const addEventListener =
  AppState.addEventListener as jest.Mock<AddEventListener>;

function mockAppState() {
  const remove = jest.fn();
  let handler: ((state: string) => void) | undefined;
  addEventListener.mockImplementation(
    (_event: string, listener: (state: string) => void) => {
      handler = listener;
      return { remove };
    }
  );
  return { remove, emit: (state: string) => handler?.(state) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('watchForSigningFinished', () => {
  it('fires when the app returns to active', () => {
    const { emit } = mockAppState();
    const onReturn = jest.fn();
    watchForSigningFinished(onReturn);

    emit('background');
    expect(onReturn).not.toHaveBeenCalled();

    emit('active');
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('fires only once, then unsubscribes', () => {
    const { emit, remove } = mockAppState();
    const onReturn = jest.fn();
    watchForSigningFinished(onReturn);

    emit('background');
    emit('active');
    emit('background');
    emit('active');

    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('ignores an active event that never left the foreground', () => {
    const { emit } = mockAppState();
    const onReturn = jest.fn();
    watchForSigningFinished(onReturn);

    emit('active');
    expect(onReturn).not.toHaveBeenCalled();
  });

  it('can be cancelled before it fires', () => {
    const { emit, remove } = mockAppState();
    const onReturn = jest.fn();
    const cancel = watchForSigningFinished(onReturn);

    cancel();
    emit('background');
    emit('active');

    expect(onReturn).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('cancelling twice removes the subscription only once', () => {
    const { remove } = mockAppState();
    const cancel = watchForSigningFinished(jest.fn());
    cancel();
    cancel();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
