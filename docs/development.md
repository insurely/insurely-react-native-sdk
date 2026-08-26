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

We use [release-it](https://github.com/release-it/release-it) to make it easier to publish new versions. It handles common tasks like bumping version based on semver, creating tags and releases etc.

To publish new versions, run the following:

```sh
yarn release
```


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
