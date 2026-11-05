# CLAUDE.md

Guidance for working in this repository.

## What this is

The Insurely React Native SDK, `@insurely/react-native-sdk` on npm: an
`InsurelyView` component that embeds Blocks in `react-native-webview`. It is
mostly TypeScript; the only native code is the `InsurelyHttp` module in
`ios/` and `android/`, which sends the HTTP requests Blocks asks for
(instructions). `plugin/` is the Expo config plugin and `bin/` the
`insurely-sdk-doctor` CLI.

**This repository is public.** Customers read the code, the commits and the
PRs. Keep internal material out of all of them: real customer ids and config
names, internal URLs, and anything about other customers.

## Build and test

Use `yarn` (Yarn workspaces), never `npm`. See `docs/development.md` for the
example app.

```bash
yarn typecheck
yarn lint
yarn test
yarn check-contract   # the SDK's types still match Blocks' moduleInput; needs an insurely-blocks checkout
```

CI also packs the tarball and installs it into a fresh Expo app and a fresh
bare app, the way an integrator would.

## Releasing

A release is one PR, opened by CI. Your change merges first through a normal
PR; the release PR then only bumps the version in `package.json` and adds the
changelog. **Never bump the version or edit `CHANGELOG.md` in a change PR**,
and never name a change branch `release/*`.

**Commit messages are the changelog.** It is generated from the conventional
commits since the last release (the angular preset), and integrators read it:
`feat` and `fix` commits become its lines, and a `BREAKING CHANGE:` footer
asks for a major. Write those messages for integrators.

**Before opening a PR that changes what ships (`src/`, `ios/`, `android/`,
`plugin/`, `bin/`), ask the developer whether it should be released, and say
what each answer means**:

- **Yes**: after this PR is merged, the "Release — prepare" workflow opens a
  release PR. Merging that PR publishes to npm, which can't be undone.
- **No**: the change is merged but no customer gets it until a later release,
  for example to release several changes together.

**Once the PR is merged, if the answer was yes, remind the developer of the
release** and offer to start it:

```bash
gh workflow run release.yml --repo insurely/insurely-react-native-sdk -f increment=auto
```

`auto` picks the version from the commits. Say which one it will be and why:
major for a change that breaks integrators' code, minor for a new feature,
patch for a fix. A major also needs `-f allow_major=true`, and only when the
developer has decided on one: leaving the current major is a product
decision, not something a stray footer should do.

Then the developer:

1. Clicks **Approve and run** on the release PR. A bot opened it, so its
   checks wait for a maintainer.
2. Reviews the changelog and merges. **Nothing else may be merged while the
   release PR is open**: the publish refuses, because that change would ship
   without being in the changelog.
3. `publish.yml` publishes to npm, tags `vX.Y.Z` and creates the GitHub
   release.

Never publish from a laptop: `yarn release-it --dry-run` only.

When the release changes what integrators see or configure, ask whether to
check the public docs at `https://docs.insurely.com` (the
`insurely/insurely-docs-fumadocs` repo) as well as `README.md` and
`docs/getting-started.md` here.

### When a publish fails

Nothing was published and no tag was created, but `main` already has the
version bump. Fix the cause, then run "Release — prepare" again: it bumps to
the next version and its changelog covers everything since the last release.
The failed number is skipped, never reused. `docs/development.md` has the
details.
