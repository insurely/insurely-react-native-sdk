# Development

How to work on the SDK itself. If you are *using* the SDK in an app, you want
[getting-started.md](./getting-started.md) instead.

This SDK is proprietary software — see [LICENSE](../LICENSE). The source is
published so integrators can read it, debug against it, and audit what runs
in their app, but we do not accept outside pull requests. If you are
integrating and something is wrong, open an issue or contact
support@insurely.com rather than sending a patch.

## Development workflow

This project is a monorepo managed using [Yarn workspaces](https://yarnpkg.com/features/workspaces). It contains the following packages:

- The library package in the root directory.
- An example app in the `example/` directory.

To get started with the project, make sure you have the correct version of [Node.js](https://nodejs.org/) installed. See the [`.nvmrc`](../.nvmrc) file for the version used in this project.

Run `yarn` in the root directory to install the required dependencies for each package:

```sh
yarn
```

> Since the project relies on Yarn workspaces, you cannot use [`npm`](https://github.com/npm/cli) for development without manually migrating.

The [example app](../example/) demonstrates usage of the library. You need to run it to test any changes you make.

It is configured to use the local version of the library, so any changes you make to the library's source code will be reflected in the example app. Changes to the library's JavaScript code will be reflected in the example app without a rebuild, but native code changes will require a rebuild of the example app.

If you want to use Android Studio or Xcode to edit the native code, you can open the `example/android` or `example/ios` directories respectively in those editors. To edit the Objective-C or Swift files, open `example/ios/ReactNativeSdkExample.xcworkspace` in Xcode and find the source files at `Pods > Development Pods > @insurely/react-native-sdk`.

To edit the Java or Kotlin files, open `example/android` in Android studio and find the source files at `insurely-react-native-sdk` under `Android`.

You can use various commands from the root directory to work with the project.

To start the packager:

```sh
yarn example start
```

To run the example app on Android:

```sh
yarn example android
```

To run the example app on iOS:

```sh
yarn example ios
```

To confirm that the app is running with the new architecture, you can check the Metro logs for a message like this:

```sh
Running "ReactNativeSdkExample" with {"fabric":true,"initialProps":{"concurrentRoot":true},"rootTag":1}
```

Note the `"fabric":true` and `"concurrentRoot":true` properties.

To run the example app on Web:

```sh
yarn example web
```

Make sure your code passes TypeScript:

```sh
yarn typecheck
```

To check for linting errors, run the following:

```sh
yarn lint
```

To fix formatting errors, run the following:

```sh
yarn lint --fix
```

Remember to add tests for your change if possible. Run the unit tests by:

```sh
yarn test
```


### Commit message convention

We follow the [conventional commits specification](https://www.conventionalcommits.org/en) for our commit messages:

- `fix`: bug fixes, e.g. fix crash due to deprecated method.
- `feat`: new features, e.g. add new method to the module.
- `refactor`: code refactor, e.g. migrate from class components to hooks.
- `docs`: changes into documentation, e.g. add usage example for the module.
- `test`: adding or updating tests, e.g. add integration tests using detox.
- `chore`: tooling changes, e.g. change CI config.

Our pre-commit hooks verify that your commit message matches this format when committing.


### Publishing to npm

Releases go through GitHub Actions, not from a laptop. Publishing to the public
npm registry is irreversible — `npm unpublish` works only within 72 hours and
only while nothing depends on the package — so the flow puts a reviewed pull
request in front of it.

Three workflows, chained by branch name:

1. **`Release — prepare`** (`release.yml`) — run it manually from the Actions
   tab. It bumps the version and regenerates `CHANGELOG.md` from the
   conventional commits since the last release, then pushes a
   `release/X.Y.Z` branch. `main` is never pushed by it.
2. **`Release — open PR`** (`release-pr.yml`) — fires on that push and opens a
   PR to `main`. It refuses to open one if the branch changes anything beyond
   `package.json` and `CHANGELOG.md`: source changes must land through a normal
   review first, then be released.
3. **`Release — publish`** (`publish.yml`) — fires when that PR is **merged**.
   It re-runs the whole CI suite (calling `ci.yml` rather than copying it, so
   the gate cannot drift), refuses to republish an existing version, then
   publishes, tags `vX.Y.Z` and creates the GitHub release.

So: run the workflow, review the changelog on the PR, merge it. Merging is
what publishes.

A major bump is a product decision, not something a stray `BREAKING CHANGE:`
footer should trigger, so `release.yml` refuses one unless its `allow_major`
input is explicitly checked. That applies both to leaving `0.x` — where the
API is still allowed to move and npm consumers read that correctly — and to
any later major, where consumers must act to upgrade.

Note what `1.0.0` commits you to: under semver, every breaking change after
it needs the next major. While the surface is still settling, `0.x` is the
honest signal.

**Required configuration:**

Publishing uses npm **trusted publishing** (OIDC). There is no `NPM_TOKEN`:
npm is configured to trust this repository, this workflow file and this
environment, and the runner exchanges a short-lived credential at publish
time. Nothing long-lived exists to rotate, leak, or lose when someone leaves
the company.

On npmjs.com, under the package's (or org's) **Trusted Publisher** settings:

| Field | Value |
| --- | --- |
| Organization | `insurely` |
| Repository | `insurely-react-native-sdk` |
| Workflow filename | `publish.yml` — filename only, no path |
| Environment | leave blank |

On GitHub:

| Setting | Why |
| --- | --- |
| Ruleset on `main` | Requires a pull request and all five CI checks before anything merges, and blocks force-pushes and deletion. This is what makes merging the release PR a real gate. |
| `RELEASE_GITHUB_TOKEN` | **Not required.** An optional PAT, only if you would rather the release PR were opened by a user than by the bot. GitHub ignores workflow triggers caused by its own `GITHUB_TOKEN`, so a bot-opened PR does not start CI on its own — `release-pr.yml` works around that by dispatching `ci.yml` onto the release branch directly, which is the one event the default token may trigger. No personal credential is needed anywhere in the release flow. |

**Renaming `publish.yml` breaks publishing** until the npmjs.com config is
updated to match. That filename pin is also what stops some other workflow
from publishing.

There is deliberately no deployment environment: merging the release PR is
the human gate, and a second approval seconds later by the same person added
little. Worth revisiting once a second maintainer exists — GitHub forbids
approving your own PR but allows approving your own deployment, so an
environment becomes the gate that works when the ruleset's approval count
goes above zero.

Provenance attestations are generated automatically when publishing this way,
so nothing sets `NPM_CONFIG_PROVENANCE`. The attestation only becomes visible
once the repository is public.

The publish job runs Node 22 and upgrades npm before publishing: trusted
publishing needs Node >= 22.14.0 and npm >= 11.5.1, and Node 20 ships npm 10,
which has no OIDC support at all.

The first publish of a scoped package also needs `--access public`, which
`publish.yml` passes on every publish.

`yarn release` still runs release-it locally, but should only be used for a
dry run (`yarn release-it --dry-run`). Do not publish from a laptop.


### Scripts

The `package.json` file contains various scripts for common tasks:

- `yarn`: setup project by installing dependencies.
- `yarn typecheck`: type-check files with TypeScript.
- `yarn lint`: lint files with [ESLint](https://eslint.org/).
- `yarn test`: run unit tests with [Jest](https://jestjs.io/).
- `yarn check-contract`: verify this SDK's types still match the Blocks
  `moduleInput` contract. Needs an `insurely-blocks` checkout — see the
  script for how the baseline works.
- `yarn check-tarball`: assert the published package contains only what it
  should. A publish cannot be undone, so this runs in CI before every
  packaged-install job.
- `yarn e2e`: run the Maestro end-to-end suite (see [`e2e/README.md`](../e2e/README.md)).
- `yarn build:plugin`: build the Expo config plugin.
- `yarn clean`: remove build artefacts.
- `yarn example start`: start the Metro server for the example app.
- `yarn example android`: run the example app on Android.
- `yarn example ios`: run the example app on iOS.
