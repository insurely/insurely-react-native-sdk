// Copyright © 2026 Insurely AB. All rights reserved.

import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { InsurelyConfig } from '@insurely/react-native-sdk';

import { PRESETS, type Preset } from './presets';

export const LANGUAGES = ['sv', 'en', 'da', 'no', 'et', 'fr'] as const;
const THEME_MODES = ['light', 'dark', 'system'] as const;

export function SettingsPanel({
  preset,
  config,
  onSelectPreset,
  onChangeConfig,
  onStart,
  onOpenDiagnostics,
}: {
  preset: Preset;
  config: InsurelyConfig;
  onSelectPreset: (preset: Preset) => void;
  onChangeConfig: (config: InsurelyConfig) => void;
  onStart: () => void;
  onOpenDiagnostics: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Preset</Text>
      {PRESETS.map((candidate) => (
        <Pressable
          key={candidate.name}
          onPress={() => onSelectPreset(candidate)}
        >
          <Text
            style={[
              styles.option,
              candidate.name === preset.name && styles.selected,
            ]}
          >
            {candidate.name}
          </Text>
        </Pressable>
      ))}

      <Text style={styles.heading}>Language</Text>
      <View style={styles.row}>
        {LANGUAGES.map((language) => (
          <Pressable
            key={language}
            onPress={() => onChangeConfig({ ...config, language })}
          >
            <Text
              style={[
                styles.chip,
                config.language === language && styles.selected,
              ]}
            >
              {language}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.heading}>Theme mode</Text>
      <View style={styles.row}>
        {THEME_MODES.map((themeMode) => (
          <Pressable
            key={themeMode}
            onPress={() => onChangeConfig({ ...config, themeMode })}
          >
            <Text
              style={[
                styles.chip,
                config.themeMode === themeMode && styles.selected,
              ]}
            >
              {themeMode}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Close button</Text>
        <Switch
          value={config.showCloseButton ?? false}
          onValueChange={(showCloseButton) =>
            onChangeConfig({ ...config, showCloseButton })
          }
        />
      </View>

      <Text style={styles.heading}>Payload preview (reconstructed)</Text>
      <Text style={styles.note}>
        Not a capture of the real injection — this is what the SDK will send,
        rebuilt here from the settings above for preview only.
      </Text>
      <Text style={styles.payload}>
        {JSON.stringify({ config, prefill: preset.prefill }, null, 2)}
      </Text>

      <Pressable onPress={onOpenDiagnostics} testID="open-diagnostics">
        <Text style={styles.option}>Diagnostics: instruction probe</Text>
      </Pressable>

      <Pressable
        onPress={onStart}
        style={styles.start}
        testID="start-collection"
      >
        <Text style={styles.startLabel}>Start collection</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  heading: { fontWeight: '700', marginTop: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  option: { paddingVertical: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#eee',
  },
  selected: { backgroundColor: '#0ea5e9', color: '#fff' },
  label: { flex: 1 },
  note: { fontSize: 11, color: '#666', fontStyle: 'italic' },
  payload: {
    fontFamily: 'Courier',
    fontSize: 11,
    backgroundColor: '#f5f5f5',
    padding: 8,
  },
  start: {
    backgroundColor: '#0ea5e9',
    padding: 14,
    borderRadius: 8,
    marginTop: 16,
  },
  startLabel: { color: '#fff', textAlign: 'center', fontWeight: '700' },
});
