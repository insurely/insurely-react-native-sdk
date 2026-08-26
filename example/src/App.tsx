// Copyright © 2026 Insurely AB. All rights reserved.

import { useRef, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import {
  InsurelyView,
  type InsurelyHandle,
  type InsurelyConfig,
} from '@insurely/react-native-sdk';

import { EventLog, type LogEntry } from './EventLog';
import { InstructionProbe } from './InstructionProbe';
import { SettingsPanel, LANGUAGES } from './SettingsPanel';
import { PRESETS, type Preset } from './presets';

const ACTED_ON = new Set([
  'OPEN_SWEDISH_BANKID',
  'OPEN_DANISH_MITID',
  'OPEN_FRENCH_TRUST_ME',
  'OPEN_AUTHENTICATION_APP',
  'OPEN_COMPANION_APP',
  'REDIRECT',
  'RETURN_TO_BROWSER',
]);

/** Retained log entries are capped so the log stays responsive during a long
 * collection; the oldest entries are dropped first. */
const MAX_LOG_ENTRIES = 500;

/** Placeholder value used to exercise `updateAuthToken` — this app has no
 * real token to rotate to, only the API call to verify. */
const PLACEHOLDER_AUTH_TOKEN = 'example-updated-auth-token';

export default function App() {
  const [preset, setPreset] = useState<Preset>(PRESETS[0]!);
  const [config, setConfig] = useState<InsurelyConfig>(PRESETS[0]!.config);
  const [running, setRunning] = useState(false);
  const [probing, setProbing] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const insurely = useRef<InsurelyHandle>(null);
  const nextId = useRef(0);
  const totalLogged = useRef(0);
  const languageIndex = useRef(0);

  const append = (
    channel: LogEntry['channel'],
    label: string,
    payload: unknown,
    acted = false
  ) => {
    totalLogged.current += 1;
    setEntries((current) => {
      const updated = [
        { id: nextId.current++, channel, label, payload, acted },
        ...current,
      ];
      return updated.length > MAX_LOG_ENTRIES
        ? updated.slice(0, MAX_LOG_ENTRIES)
        : updated;
    });
  };

  const droppedCount = Math.max(0, totalLogged.current - entries.length);

  const handleChangeLanguage = () => {
    languageIndex.current = (languageIndex.current + 1) % LANGUAGES.length;
    const next = LANGUAGES[languageIndex.current]!;
    insurely.current?.changeLanguage(next);
    append('event', `LOCAL: changeLanguage(${next})`, { language: next });
  };

  const handleUpdateAuthToken = () => {
    insurely.current?.updateAuthToken(PLACEHOLDER_AUTH_TOKEN);
    append('event', 'LOCAL: updateAuthToken(...)', {
      token: PLACEHOLDER_AUTH_TOKEN,
    });
  };

  const handleReload = () => {
    insurely.current?.reload();
    append('event', 'LOCAL: reload()', {});
  };

  if (!running) {
    return (
      <SafeAreaView style={styles.container}>
        {probing ? (
          <InstructionProbe onClose={() => setProbing(false)} />
        ) : (
          <SettingsPanel
            preset={preset}
            config={config}
            onSelectPreset={(next) => {
              setPreset(next);
              setConfig(next.config);
            }}
            onChangeConfig={setConfig}
            onStart={() => setRunning(true)}
            onOpenDiagnostics={() => setProbing(true)}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.controls}>
        <Pressable style={styles.control} onPress={handleChangeLanguage}>
          <Text style={styles.controlLabel}>Change language</Text>
        </Pressable>
        <Pressable style={styles.control} onPress={handleUpdateAuthToken}>
          <Text style={styles.controlLabel}>Update auth token</Text>
        </Pressable>
        <Pressable style={styles.control} onPress={handleReload}>
          <Text style={styles.controlLabel}>Reload</Text>
        </Pressable>
      </View>
      <View style={styles.webview}>
        <InsurelyView
          ref={insurely}
          style={styles.fill}
          environment={preset.environment}
          config={config}
          prefill={preset.prefill}
          bankIdRedirectUrl="insurelysdkdemo:///"
          logLevel="all"
          onResults={(results) => append('result', 'RESULTS', results.data)}
          onError={(error) => append('error', error.code, error)}
          onEvent={(event) => {
            append(
              'event',
              event.type === 'UNKNOWN' ? event.name : event.type,
              event,
              ACTED_ON.has(event.type)
            );
            if (event.type === 'APP_CLOSE') setRunning(false);
          }}
        />
      </View>
      <View style={styles.log}>
        <EventLog entries={entries} droppedCount={droppedCount} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  controls: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#1c1c1c',
  },
  control: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#333',
  },
  controlLabel: {
    color: '#e5e5e5',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '600',
  },
  webview: { flex: 3 },
  log: { flex: 2 },
  fill: { flex: 1 },
});
