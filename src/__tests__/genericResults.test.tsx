// Copyright © 2026 Insurely AB. All rights reserved.
//
// The generic on InsurelyResults is a type-level change, and `yarn test` strips
// types before running -- so a runtime test would pass no matter what the types
// said. These assertions are checked by `yarn typecheck`, which covers this file:
// if the generic stops narrowing, or stops defaulting to `unknown`, typecheck
// fails here rather than in an integrator's project.
import { describe, expect, it, jest } from '@jest/globals';

// Nothing here is rendered -- every assertion is checked by `yarn typecheck`,
// not at runtime. These mocks exist only so that importing the component does
// not pull in react-native-webview's untransformed ESM or reach for a native
// module that no test process has registered.
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('../native/NativeInsurelyHttp', () => ({ default: {} }));

import { InsurelyView } from '../InsurelyView';
import type { InsurelyViewProps } from '../InsurelyView';
import type { InsurelyResults } from '../types/events';

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

interface FrenchLivret {
  type: 'FRENCH_LIVRET';
  balance: number;
}

// Defaults to `unknown`, so code written before the generic still compiles.
export type _DefaultsToUnknown = Expect<
  Equal<InsurelyResults['data'], unknown>
>;

// A supplied type comes through untouched -- no cast at the call site.
export type _NarrowsToSupplied = Expect<
  Equal<InsurelyResults<FrenchLivret[]>['data'], FrenchLivret[]>
>;

// The prop carries the parameter through to the handler's argument.
export type _PropIsNarrowed = Expect<
  Equal<
    Parameters<NonNullable<InsurelyViewProps<FrenchLivret[]>['onResults']>>[0],
    InsurelyResults<FrenchLivret[]>
  >
>;

// And the un-parameterised prop still hands over `unknown`.
export type _PropDefaults = Expect<
  Equal<
    Parameters<NonNullable<InsurelyViewProps['onResults']>>[0],
    InsurelyResults<unknown>
  >
>;

describe('InsurelyResults generic', () => {
  it('narrows results.data at the call site', () => {
    // Not rendered: this exists so the JSX form is typechecked. If the generic
    // export regressed to a plain forwardRef, `<InsurelyView<FrenchLivret[]>>`
    // would stop accepting a type argument and this would fail to compile.
    const element = (
      <InsurelyView<FrenchLivret[]>
        environment="test"
        config={{ customerId: 'c1', configName: 'cfg' }}
        onResults={(results) => {
          // results.data is FrenchLivret[], so this member access is legal
          // without a cast -- which is the whole point of the change.
          results.data.reduce((sum, item) => sum + item.balance, 0);
        }}
      />
    );
    // The assertions above are compile-time; this asserts the element was
    // constructed so Jest has something to run.
    expect(element).toBeTruthy();
  });
});
