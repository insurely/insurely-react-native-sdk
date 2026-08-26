# @insurely/react-native-sdk

Insurely's Blocks collection flow — company selection, bank authentication
(including Swedish BankID), and result retrieval — as a React Native
component. Works in both Expo and bare React Native apps.

## Install

```sh
npx expo install @insurely/react-native-sdk react-native-webview
```

(Bare React Native: `npm install @insurely/react-native-sdk react-native-webview && cd ios && pod install`.)

## Usage

```tsx
import { InsurelyView, type InsurelyConfig } from '@insurely/react-native-sdk';

const config: InsurelyConfig = {
  customerId: 'your-customer-id',
  configName: 'your-config-name',
  language: 'sv',
};

<InsurelyView
  style={{ flex: 1 }}
  environment="test"
  config={config}
  bankIdRedirectUrl="myapp:///"
  onResults={(results) => console.log(results.data)}
  onError={(error) => console.warn(error)}
  onEvent={(event) => console.log(event)}
/>;
```

This is enough to reach the company-selection screen. BankID authentication
needs one more step — a native URL scheme entry — covered in full in the
**[getting-started guide](https://github.com/insurely/insurely-react-native-sdk/blob/main/docs/getting-started.md)**, along with the config
plugin for Expo, the bare React Native setup, the event model, and the
imperative API (`changeLanguage`, `updateAuthToken`, `reload`).

**Expo Go cannot run this SDK.** BankID needs entries in `Info.plist` /
`AndroidManifest.xml` that Expo Go's fixed binary can't carry. Use
`npx expo run:` or an EAS development build — see the getting-started guide
for why, and for the no-Mac-required path (per EAS's documented build
infrastructure) via EAS.

## Support matrix

| | Requirement |
|---|---|
| React Native | 0.76+, **New Architecture only** — the native module is a TurboModule with no legacy-bridge wiring, so an app on the old bridge cannot resolve it at any React Native version |
| iOS | 15+ |
| Android | `minSdk` 24 |
| Expo | SDK versions matching the React Native range above; config plugin included |

## Learn more

- **[Getting started](https://github.com/insurely/insurely-react-native-sdk/blob/main/docs/getting-started.md)** — install through first
  screen, events, the imperative API, and the configuration reference.
- **[End-to-end flows](https://github.com/insurely/insurely-react-native-sdk/blob/main/e2e/README.md)** — the Maestro suite used to verify
  this SDK against a live Blocks environment.

## License

Proprietary — see [LICENSE](https://github.com/insurely/insurely-react-native-sdk/blob/main/LICENSE). The source is published so you
can read it, debug against it, and audit what runs in your app; we do not
accept outside pull requests. Found a problem? Open an issue or contact
support@insurely.com.

Working on the SDK itself? See [docs/development.md](https://github.com/insurely/insurely-react-native-sdk/blob/main/docs/development.md).
