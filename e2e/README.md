# End-to-end flows

[Maestro](https://maestro.mobile.dev) flows that drive the playground app
(`example/`) against a **live Blocks test environment**. Unlike the unit
tests under `src/__tests__`, these exercise the real chain: script
injection into a real `WebView`, the bootstrap script, the `postMessage`
patch, the native bridge, message parsing, and a real render of the
playground UI — against Blocks itself, not a mock.

Both flows select the app's default preset (the first entry in
`example/src/presets.ts`), which points at the `test` Blocks environment.
Do not run these against `production` credentials.

The preset reads its `customerId` / `configName` from `example/.env`, which
is gitignored — see `example/src/presets.ts`. Without that file the flows
will fail at `APP_LOADED`, because Blocks rejects the placeholder config.

## What each flow proves

- **`start-collection.yaml`** — launches the app, taps "Start collection",
  and asserts that both `APP_LOADED` and `PAGE_VIEW` appear in the event
  log. `APP_LOADED` is the first message Blocks ever posts; `PAGE_VIEW`
  only appears once the WebView has actually navigated to a real Blocks
  page. Seeing both proves injection, the bootstrap script, the
  `postMessage` patch, the bridge and parsing all work end to end against a
  live server.

- **`unknown-messages-forwarded.yaml`** — guards the behaviour that most
  distinguishes this SDK from the iOS and Android SDKs: those two silently
  drop any `postMessage` they don't recognise, while this SDK forwards
  every message (unrecognised ones arrive as `InsurelyEvent` with
  `type: "UNKNOWN"` and the real name in `name` — see
  `src/types/events.ts` and `src/bridge/parse.ts`). Like the first flow,
  it asserts `APP_LOADED` appears. The incremental value is the tap-to-expand
  interaction: it taps the `APP_LOADED` row to expand its raw payload and
  asserts the expanded text contains `"type"`. That proves a logged
  message's payload is always present and readable on tap — which is what
  "not dropped" means for any row in the log, typed or `UNKNOWN` alike.
  (Which specific messages Blocks classifies as `UNKNOWN` on a given run
  isn't scriptable from here, since it depends on the live server and
  isn't something Maestro can force; the flow demonstrates the readable
  payload property against a row that's guaranteed to appear early, and
  that property holds for every row without exception.)

The event log is a virtualized `FlatList` capped at the 500 most recent
entries (`example/src/EventLog.tsx`, `example/src/App.tsx`). Selectors
target row text (`text: "..."`), which Maestro finds by reading the live
accessibility tree — including automatically scrolling to bring an
off-screen row into view. Because the list is virtualized, a row that has
scrolled far enough away is unmounted, not just off-screen, so both flows
interact with a row (`APP_LOADED`) immediately after asserting it's
visible, before enough later events can arrive to push it out of the
initial render window.

**Note on tap timeouts:** `unknown-messages-forwarded.yaml` sets an explicit
10-second timeout on the tap of `APP_LOADED`. If this timeout fails, it most
likely indicates a virtualization flake — the row scrolled out of the render
window between the `assertVisible` and the `tapOn` — rather than an SDK fault.
This can happen when events arrive faster than usual. If you see this failure,
re-run the flow; it typically passes on the next attempt.

## Prerequisites

1. **Install Maestro** (not bundled with this repo or installed by any
   script here):

   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   maestro --version
   ```

2. **Build and install a dev-client build of the playground app** on a
   simulator/emulator or device. Maestro drives an already-installed app;
   it does not build one.

   ```bash
   yarn install
   yarn example ios      # npx expo run:ios, from example/
   # or
   yarn example android  # npx expo run:android, from example/
   ```

   The bundle identifier / package must be `com.insurely.sdkdemo` (see
   `example/app.json`'s `ios.bundleIdentifier` and `android.package`) —
   both flows' `appId` is hardcoded to that value, so a mismatch means
   Maestro cannot launch the app at all.

3. **No local test server is required for these two flows.** (The
   playground's separate "Diagnostics: instruction probe" screen needs
   `node scripts/instruction-test-server.js`, but neither Maestro flow
   touches that screen.)

4. Make sure the device/simulator running the app has network access to
   the Blocks test environment, and that `example/.env` supplies a
   `customerId` / `configName` pair that is still valid for it.

## Running the flows

```bash
yarn e2e
```

This runs `maestro test e2e`, which executes every `.yaml` flow in this
directory against whichever simulator/emulator or device Maestro finds
(use `maestro test e2e --device <id>` to target a specific one when more
than one is running).

To run a single flow:

```bash
maestro test e2e/start-collection.yaml
```

## What a passing run looks like

Maestro prints a per-step checklist for each flow and exits `0`:

```
> Flow: Start Collection
  ✅ Launch app "com.insurely.sdkdemo"
  ✅ Tap on id: start-collection
  ✅ Assert visible: "APP_LOADED"
  ✅ Assert visible: "PAGE_VIEW"
```

A failure most often means one of:

- The app isn't installed, or was built with a different bundle
  identifier — Maestro fails immediately at `launchApp`.
- The device can't reach the Blocks test environment — the flows time out
  on `assertVisible` (30s) waiting for `APP_LOADED`/`PAGE_VIEW`, since
  Blocks never responds.
- The test credentials in `example/.env` were rotated, expired, or are
  missing entirely.
