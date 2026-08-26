# Getting started

`@insurely/react-native-sdk` embeds Insurely's Blocks collection flow — company
selection, Swedish BankID and other bank authentication, and result retrieval
— in a React Native screen. It works the same way in a bare React Native app
and in an Expo app; the difference is only in how the two native files it
needs (`Info.plist` and `AndroidManifest.xml`) get their entries.

This guide gets you from `npm install` to a working screen, then covers the
event model, the imperative API and the configuration surface.

## Before you start: Expo Go will not work

If you're on Expo, you'll be tempted to run the app in Expo Go to try this
out. Don't — it can't work, for a reason that has nothing to do with a bug in
this SDK. Swedish BankID authentication returns the user to your app through
a custom URL scheme (`bankid://...&redirect=yourapp://...`), and iOS refuses
to even *check whether the BankID app is installed* unless your app declares
`bankid` in `LSApplicationQueriesSchemes` in its `Info.plist`. Expo Go is a
fixed, pre-built binary published by Expo — it has its own `Info.plist`, and
you cannot add an entry to it. The practical symptom is that tapping "open
BankID" inside Expo Go does nothing at all, silently.

You need a **custom build** — a build of your own app, not Expo Go — for
anything BankID-related to work. Two ways to get one:

- `npx expo run:ios` / `npx expo run:android` — builds locally. Requires a
  Mac for iOS (Xcode's command-line tools, installed once), but the SDK
  handles everything else; you never open Xcode yourself.
- `eas build --profile development` — builds in Expo's cloud. **No Mac
  required for either platform** (per EAS's documented build infrastructure)
  — this is the option to reach for if nobody on your team has a Mac, or
  you'd rather not install Xcode at all. Install the resulting build on a
  simulator/device or via `eas build:run`, and `npx expo start --dev-client`
  to iterate against it exactly like Expo Go.

Bare React Native apps don't have this problem — there is no Expo Go
equivalent, so `npx react-native run:ios` / `run:android` already builds
something real.

## 1. Install

**Expo:**

```sh
npx expo install @insurely/react-native-sdk react-native-webview
```

**Bare React Native:**

```sh
npm install @insurely/react-native-sdk react-native-webview
cd ios && pod install
```

Both need `react-native-webview` — it's a peer dependency, not bundled,
because most React Native apps already have it and it's not something this
SDK should force a version of.

See the [support matrix in the README](../README.md#support-matrix) before
you start: this SDK requires the New Architecture and React Native 0.76+.
There is no path to making it work on the legacy bridge at any React Native
version — the native module is generated exclusively as a TurboModule, so an
app still on the old bridge will fail to resolve it, not merely warn.

## 2. Expo setup: the config plugin

For Expo, the [config plugin](../plugin/withInsurely.ts) is the entire native
setup — you never touch `Info.plist` or `AndroidManifest.xml` by hand. Add it
to `app.json` (or `app.config.js`), passing the URL scheme your app uses to
receive the user back after BankID authentication:

```json
{
  "expo": {
    "scheme": "myapp",
    "plugins": [
      ["@insurely/react-native-sdk/app.plugin.js", { "bankIdRedirectScheme": "myapp" }]
    ]
  }
}
```

This does two things on every prebuild:

- Declares `bankid` in iOS's `LSApplicationQueriesSchemes` and in an Android
  `<queries>` block, so both platforms let your app detect and launch the
  BankID app.
- Registers `bankIdRedirectScheme` as a `CFBundleURLTypes` entry on iOS
  (Android already receives the app's `scheme` via Expo's own manifest
  handling), so the OS knows to hand control back to your app once BankID
  finishes.

**The scheme here must be the same string you pass as `bankIdRedirectUrl` on
`InsurelyView`** (see [First screen](#3-first-screen), below) — specifically,
its scheme, before the `://`. If they don't match, BankID opens correctly but
never returns: the OS has nowhere registered to send the user back to, and
the collection silently stalls on the BankID screen forever with no error
callback, because the SDK has no way to know a redirect failed to happen.

After adding the plugin, rebuild — `npx expo prebuild` regenerates the native
projects with these entries, and `expo run:` / `eas build` do this for you
automatically. Editing `app.json` alone changes nothing until the next
prebuild.

## 3. Bare React Native setup

Without Expo there's no config plugin to run, so add the same three things
by hand.

**`ios/YourApp/Info.plist`** — add `bankid` to `LSApplicationQueriesSchemes`,
and register your own redirect scheme under `CFBundleURLTypes`:

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>bankid</string>
</array>
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>myapp</string>
    </array>
  </dict>
</array>
```

(If `CFBundleURLTypes` or `LSApplicationQueriesSchemes` already exists in
your `Info.plist` — likely, if you use other SDKs — merge into the existing
array rather than adding a second key of the same name; a duplicate key is
invalid plist and will fail to build.)

**`android/app/src/main/AndroidManifest.xml`** — add a `<queries>` block as a
direct child of `<manifest>` (not inside `<application>`):

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <queries>
    <intent>
      <action android:name="android.intent.action.VIEW" />
      <data android:scheme="bankid" />
    </intent>
  </queries>
  ...
</manifest>
```

Android 11+ hides every other app's package from yours unless you declare a
`<queries>` entry for it, so without this block `Linking.canOpenURL` for
BankID always reports `false`, even with BankID installed.

Your redirect scheme also needs an intent filter inside your main activity so
Android hands control back to your app — see the [React Native deep linking
guide](https://reactnative.dev/docs/linking) if you don't already have one
set up for `myapp://`.

**Check your work** rather than eyeballing XML/plist by hand:

```sh
npx insurely-sdk-doctor
```

This is bundled with the SDK (`bin/insurely-sdk-doctor.js`) and needs no
setup — it reads your `ios/**/Info.plist` and
`android/app/src/main/AndroidManifest.xml`, reports exactly which of the
entries above are missing, and prints the block to paste in. Run it any time
something BankID-related isn't working; a missing native entry is the most
common cause and this rules it in or out in one command, without opening
Xcode or Android Studio.

## 4. First screen

```tsx
import { useRef, useState } from 'react';
import { SafeAreaView, Button } from 'react-native';
import {
  InsurelyView,
  type InsurelyHandle,
  type InsurelyConfig,
} from '@insurely/react-native-sdk';

const config: InsurelyConfig = {
  customerId: 'your-customer-id',
  configName: 'your-config-name',
  language: 'sv',
};

export default function CollectScreen() {
  const insurely = useRef<InsurelyHandle>(null);
  const [running, setRunning] = useState(false);

  if (!running) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <Button title="Start collection" onPress={() => setRunning(true)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <InsurelyView
        ref={insurely}
        style={{ flex: 1 }}
        environment="test"
        config={config}
        bankIdRedirectUrl="myapp:///"
        onResults={(results) => console.log('results', results.data)}
        onError={(error) => console.warn('insurely error', error)}
        onEvent={(event) => {
          if (event.type === 'APP_CLOSE') setRunning(false);
        }}
      />
    </SafeAreaView>
  );
}
```

`environment` picks which Blocks deployment the view loads —
`'production' | 'staging' | 'test'`, or `{ url: 'https://...' }` to point at
a specific deployment yourself. `config` is required; **Blocks requires it to
carry one of `customerId`/`configName` or `sessionId`/`resumeCode`**, but the
SDK does not validate this — if either pair is missing, Blocks will not start
a collection, but the error will surface as inactivity (no `onEvent` or
`onError`), not as a thrown error. See [Configuration reference](#8-configuration-reference)
for the rest. `bankIdRedirectUrl` is the exact same scheme registered in step
2 or 3, as a full URL — matching what you pass as `bankIdRedirectScheme`.

This is enough to reach the company-selection screen and run a full
collection. For a fuller reference implementation exercising the imperative
API, event log and instruction probing, see [`example/src/App.tsx`](../example/src/App.tsx)
in this repository — it's the playground app this SDK is developed against.

## 5. Events, results and errors

`onEvent` receives `InsurelyEvent`, a **discriminated union** on its `type`
field (see [`src/types/events.ts`](../src/types/events.ts)) — this means a
`switch (event.type)` narrows `event`'s other fields per case, and TypeScript
will flag the switch as non-exhaustive if you add a new case and forget a
branch:

```tsx
switch (event.type) {
  case 'PAGE_VIEW':
    console.log('now on', event.page); // event.page: PageView
    break;
  case 'COLLECTION_STATUS':
    console.log('status', event.status); // event.status: CollectionStatus
    break;
  case 'UNKNOWN':
    console.log('unrecognised message', event.name, event.value);
    break;
  // ...
}
```

That last case matters: Blocks sends around sixty distinct message names,
and Blocks itself is deployed independently of this SDK, so it can add new
ones at any time. **This SDK never drops a message it doesn't recognise** —
unlike the iOS and Android SDKs, which do. An unrecognised message
arrives as `{ type: 'UNKNOWN', name, value, extraInformation }`, so a new
Blocks message is visible and usable — just not yet given its own typed
member — the day it ships, rather than silently vanishing.

A handful of message types route to `onError` instead of `onEvent`:
`ERROR`, `NON_RECOVERABLE_ERROR`, `INVALID_CREDENTIALS`,
`INVALID_AUTH_TOKEN`, plus the failures this SDK detects itself —
`BANKID_NOT_INSTALLED` and `AUTH_APP_NOT_AVAILABLE` for link handling,
`INSTRUCTION_FAILED` for a failed HTTP instruction, and `LOAD_FAILED` when
the WebView cannot load Blocks at all. Everything else —
including `PAGE_VIEW`, `COLLECTION_STATUS`, and the final `RESULTS` payload
(delivered separately via `onResults`, not through `onEvent`) — goes to
`onEvent`. See `InsurelyError` in
[`src/types/events.ts`](../src/types/events.ts) for the full list.

### When Blocks itself fails to load

`LOAD_FAILED` is the one to handle first in production. The whole component
is a remote web app in a WebView, so no network, a DNS or TLS failure, or a
5xx from the Blocks host all produce the same thing on screen: a blank view.
The SDK reports it through `onError` rather than leaving you guessing:

```tsx
onError={(error) => {
  if (error.code === 'LOAD_FAILED') {
    // error.url     — what the WebView was trying to load
    // error.status  — the HTTP status, present only for an HTTP error response
    // error.message — the platform's description of the failure
    showRetryScreen();
    return;
  }
  console.warn('insurely error', error);
}}
```

`status` is set when Blocks answered with an HTTP error (wired from the
WebView's `onHttpError`) and absent for a transport-level failure such as
being offline (wired from `onError`). Recovering usually means calling
`reload()` on the ref once connectivity is back.

### Knowing that instructions are running

During a collection the SDK makes HTTP requests to bank endpoints on Blocks'
behalf (see [Configuration reference](#8-configuration-reference)).
A failure reaches `onError` as
`INSTRUCTION_FAILED`; a success is reported through the optional
`onInstruction` prop:

```tsx
onInstruction={(info) => {
  // { url: string; status: number; finalUrl: string }
  console.log('instruction ok', info.url, info.status);
}}
```

Without it, "no instruction was ever issued" and "instructions are running
fine" look identical from the outside, and they call for opposite diagnoses
of the same stuck-collection symptom. This is also the only place the SDK
contacts a third party from your app, under your bundle identifier and your
App Store privacy declaration, so it is worth being able to see it.

`InsurelyInstructionInfo` (exported from the package root) is **metadata
only** — never request or response headers, never a body, never cookies. It
is safe to log.

## 6. Taking over link handling

Every URL this SDK would otherwise open — BankID, other bank authentication
apps, a plain browser redirect — is offered to you first via `onOpenUrl`:

```tsx
<InsurelyView
  // ...
  onOpenUrl={(url, kind) => {
    if (kind === 'browser') {
      openInMyOwnInAppBrowser(url);
      return true; // handled — the SDK does nothing further
    }
    return false; // let the SDK open it (Linking.openURL / canOpenURL)
  }}
/>
```

Return `true` to take responsibility for the URL yourself — useful if you
have your own in-app browser, or want custom handling for a particular
`OpenUrlKind` (`'bankid' | 'mitid' | 'auth-app' | 'browser' | 'redirect' |
'companion-app'`). Return `false` (or leave the callback unset) to let the
SDK open it through React Native's `Linking` API, which is the default and
correct choice for BankID in virtually every integration.

## 7. Imperative API

`InsurelyView` exposes three imperative methods via `ref`
(`InsurelyHandle`, from [`src/InsurelyView.tsx`](../src/InsurelyView.tsx)):

```tsx
const insurely = useRef<InsurelyHandle>(null);

insurely.current?.changeLanguage('en');       // switch the Blocks UI language mid-session
insurely.current?.updateAuthToken(newToken);  // rotate authToken without remounting the view
insurely.current?.reload();                    // reload the underlying WebView from scratch
```

`changeLanguage` and `updateAuthToken` call methods Blocks installs on
`window.insurely` after `APP_LOADED` — neither native SDK exposes these
today.

## 8. Configuration reference

`InsurelyConfig` and `InsurelyPrefill` (both exported from the package root)
mirror the Blocks `moduleInput` contract field-for-field, minus the handful
of fields the SDK supplies for you (`parentOrigin`, `parentUrl`, `isWebView`,
`agent`). The authoritative source is the Blocks `moduleInput` zod schema.
It is not copied into this repository; `yarn check-contract` verifies this
SDK's types against a live Blocks checkout by comparing a recorded SHA-256
(`src/types/__contract__/moduleInput.schema.sha256`), so a contract change
fails the build rather than drifting unnoticed.

One deliberate behavioural difference from Blocks itself: **an invalid
config throws in development** (`__DEV__`), rather than being silently
stripped. Blocks drops any key it doesn't recognise, which turns a typo like
`custommerId` into a config that "does nothing" with no indication why. This
SDK validates `config` and `prefill` against the same shape on every render
in development and throws immediately, naming the offending path, so a typo
surfaces at the point you made it instead of downstream in a support ticket.
This check is skipped in production builds — it exists to catch mistakes
during development, not to add runtime cost or a new failure mode for your
users.

One config field interacts with the callbacks in a way worth calling out:
`sendPostMessages: false` tells Blocks to suppress its result messages —
`RESULTS`, `RESULTS_SELECTED_ITEM` and `WEALTH_RESULT_SELECTED_ITEMS`. Other
messages still arrive, so `onEvent` and `onError` keep working, but an
`onResults` handler can never fire — the collection appears to run and then
simply produces nothing. The SDK warns on the console when it sees that
combination, rather than letting you hunt for a bug that isn't there.
