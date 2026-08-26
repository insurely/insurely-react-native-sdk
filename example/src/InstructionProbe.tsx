// Copyright © 2026 Insurely AB. All rights reserved.

import { useState } from 'react';
import {
  Button,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// Deep import, deliberately: the SDK's public API (`@insurely/react-native-sdk`)
// exports only InsurelyView and its types, not the native HTTP module. This
// screen exists specifically to reach past that API and drive the module
// directly, because cookie-jar isolation, redirect-chain header collection and
// Set-Cookie capture are Objective-C++/Kotlin behaviour that the executor's
// mocked unit tests cannot exercise -- only a real server, called from a real
// device, can prove they work. That is the whole reason this file exists, so
// the deep import stays here rather than becoming a reason to widen the
// public API.
//
// Since the example depends on the SDK as a workspace package (so `app.json`
// can reference the config plugin the way a real integrator does), Metro logs
// one warning for this import: the subpath is not in the package's `exports`
// map, and Metro falls back to file-based resolution. That is expected and
// deliberate -- the alternative is exporting `./src/*` publicly, which would
// defeat the encapsulation this comment is defending.
import NativeInsurelyHttp, {
  type HttpResult,
} from '@insurely/react-native-sdk/src/native/NativeInsurelyHttp';

/**
 * `localhost` does not reach the host machine from an emulator or a physical
 * device, so the target host is editable in the UI rather than hardcoded.
 *
 * - iOS simulator: `http://localhost:8787` (the default below; the simulator
 *   shares the host machine's network namespace).
 * - Android emulator: `http://10.0.2.2:8787` -- the AVD's fixed alias for the
 *   host loopback interface.
 * - Physical device (either platform): `http://<your machine's LAN IP>:8787`,
 *   with the device on the same network as the machine running the server.
 */
const DEFAULT_HOST: string =
  Platform.select({
    android: 'http://10.0.2.2:8787',
    default: 'http://localhost:8787',
  }) ?? 'http://localhost:8787';

interface Check {
  label: string;
  pass: boolean;
}

type Probe = 'redirect' | 'seeded-cookie' | 'html' | 'rotation';

/** Pulls the hostname out of an `http(s)://host[:port]` string, without
 * relying on a `URL` global that may not exist in this JS runtime. */
function hostnameOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/:]+)/i.exec(url);
  return match?.[1] ?? url;
}

/** Header lookup by name, case-insensitively -- the two native modules do not
 * agree on which casing wins when hops disagree (documented parity gap). */
function headerValues(result: HttpResult, name: string): string[] {
  const key = Object.keys(result.headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  );
  return (key ? result.headers[key] : undefined) ?? [];
}

/** Computes pass/fail checks proving the property each probe exists to
 * demonstrate, so a person tapping through does not have to eyeball JSON. */
function checksFor(probe: Probe, result: HttpResult): Check[] {
  switch (probe) {
    case 'redirect': {
      const hop = headerValues(result, 'X-Hop');
      return [
        {
          label: 'finalUrl is the last hop (ends with /final)',
          pass: result.finalUrl.endsWith('/final'),
        },
        {
          label:
            "headers['X-Hop'] is [\"first\"] -- an intermediate hop's header survives",
          pass: hop.length === 1 && hop[0] === 'first',
        },
        {
          label:
            'setCookie has hop=1, a=1 and b=2 as three separate entries, not comma-joined',
          pass:
            result.setCookie.length === 3 &&
            result.setCookie.some((cookie) => cookie.startsWith('hop=1')) &&
            result.setCookie.some((cookie) => cookie.startsWith('a=1')) &&
            result.setCookie.some((cookie) => cookie.startsWith('b=2')),
        },
      ];
    }
    case 'seeded-cookie': {
      let cookies: unknown;
      try {
        cookies = (JSON.parse(result.body) as { cookies?: unknown }).cookies;
      } catch {
        cookies = undefined;
      }
      return [
        {
          label:
            "response body's cookies field contains seeded=yes -- the seeded cookie reached the server",
          pass: typeof cookies === 'string' && cookies.includes('seeded=yes'),
        },
        {
          label: 'no other cookie is present (jar was not pre-populated)',
          pass:
            typeof cookies === 'string' &&
            cookies
              .split(';')
              .map((part) => part.trim())
              .every((part) => part === 'seeded=yes' || part === ''),
        },
      ];
    }
    case 'html': {
      let parsedAsJson = true;
      try {
        JSON.parse(result.body);
      } catch {
        parsedAsJson = false;
      }
      return [
        { label: 'status is 200', pass: result.status === 200 },
        {
          label: 'body is the raw HTML string, unmodified',
          pass: result.body === '<html>not json</html>',
        },
        {
          label: 'body was not parsed as JSON (and did not throw)',
          pass: !parsedAsJson,
        },
      ];
    }
    case 'rotation': {
      const sessionCookies = result.setCookie.filter((cookie) =>
        cookie.startsWith('session=')
      );
      const only = sessionCookies.length === 1 ? sessionCookies[0] : undefined;
      return [
        {
          label: 'setCookie has exactly one "session" cookie, not two',
          pass: sessionCookies.length === 1,
        },
        {
          label:
            'that cookie carries the rotated value (new-value), not the stale one',
          pass:
            only !== undefined &&
            only.includes('new-value') &&
            !only.includes('old-value'),
        },
      ];
    }
  }
}

export function InstructionProbe({ onClose }: { onClose: () => void }) {
  const [host, setHost] = useState(DEFAULT_HOST);
  const [output, setOutput] = useState('Pick a probe below.');
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  const run = async (probe: Probe, path: string, seedCookie: boolean) => {
    setRunning(true);
    try {
      const result = await NativeInsurelyHttp.execute({
        url: `${host}${path}`,
        method: 'GET',
        headers: { accept: '*/*' },
        cookies: seedCookie
          ? [
              {
                name: 'seeded',
                value: 'yes',
                domain: hostnameOf(host),
                path: '/',
                secure: false,
                httpOnly: false,
              },
            ]
          : undefined,
      });
      setOutput(JSON.stringify(result, null, 2));
      setChecks(checksFor(probe, result));
    } catch (error) {
      setOutput(String(error));
      setChecks([]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={onClose} testID="close-diagnostics">
        <Text style={styles.back}>{'< Back to settings'}</Text>
      </Pressable>
      <Text style={styles.heading}>Instruction probe (diagnostics)</Text>
      <Text style={styles.note}>
        Manual verification for the one thing unit tests cannot reach: run{' '}
        <Text style={styles.mono}>node scripts/instruction-test-server.js</Text>{' '}
        on this machine first.
      </Text>

      <Text style={styles.label}>Server host</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        autoCapitalize="none"
        autoCorrect={false}
        testID="probe-host"
      />
      <Text style={styles.note}>
        iOS simulator: http://localhost:8787 (default) · Android emulator:
        http://10.0.2.2:8787 · physical device: http://&lt;your machine's LAN
        IP&gt;:8787, device on the same network as the server.
      </Text>

      <View style={styles.row}>
        <Button
          title="Redirect chain"
          disabled={running}
          onPress={() => {
            run('redirect', '/redirect', false);
          }}
        />
        <Button
          title="Seeded cookie"
          disabled={running}
          onPress={() => {
            run('seeded-cookie', '/final', true);
          }}
        />
        <Button
          title="HTML body"
          disabled={running}
          onPress={() => {
            run('html', '/html', false);
          }}
        />
        <Button
          title="Cookie rotation"
          disabled={running}
          onPress={() => {
            run('rotation', '/rotate', false);
          }}
        />
      </View>
      <Text style={styles.note}>
        Jar isolation: run "Seeded cookie" twice in a row. The second run must
        still report only seeded=yes -- if a cookie from the first run shows up
        too, the jar is leaking into shared storage.
      </Text>

      {checks.map((check) => (
        <Text key={check.label} style={check.pass ? styles.pass : styles.fail}>
          {check.pass ? 'PASS' : 'FAIL'} — {check.label}
        </Text>
      ))}

      <Text style={styles.output}>{output}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  back: { color: '#0ea5e9', fontWeight: '700', marginBottom: 8 },
  heading: { fontWeight: '700', fontSize: 16 },
  label: { fontWeight: '700', marginTop: 8 },
  note: { fontSize: 11, color: '#666', fontStyle: 'italic' },
  mono: { fontFamily: 'Courier', fontStyle: 'normal' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: 'Courier',
    fontSize: 12,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  pass: { color: '#15803d', fontSize: 12 },
  fail: { color: '#b91c1c', fontSize: 12 },
  output: {
    fontFamily: 'Courier',
    fontSize: 11,
    marginTop: 16,
    backgroundColor: '#f5f5f5',
    padding: 8,
  },
});
