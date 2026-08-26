// Copyright © 2026 Insurely AB. All rights reserved.

import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

export interface LogEntry {
  id: number;
  channel: 'event' | 'result' | 'error';
  label: string;
  /** True when the SDK took a platform action, rather than only forwarding. */
  acted: boolean;
  payload: unknown;
}

function Row({
  entry,
  expanded,
  onToggle,
}: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <Pressable onPress={() => onToggle(entry.id)} style={styles.row}>
      <View style={styles.header}>
        <Text style={[styles.channel, styles[entry.channel]]}>
          {entry.channel}
        </Text>
        <Text style={styles.label}>{entry.label}</Text>
        {entry.acted ? <Text style={styles.acted}>acted</Text> : null}
      </View>
      {expanded ? (
        <Text style={styles.payload}>
          {JSON.stringify(entry.payload, null, 2)}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function EventLog({
  entries,
  droppedCount = 0,
}: {
  entries: LogEntry[];
  /** Number of oldest entries dropped so far because of the retention cap. */
  droppedCount?: number;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const toggle = useCallback((id: number) => {
    setExpanded((current) => (current === id ? null : id));
  }, []);

  return (
    <FlatList
      style={styles.container}
      data={entries}
      keyExtractor={(entry) => String(entry.id)}
      renderItem={({ item }) => (
        <Row entry={item} expanded={expanded === item.id} onToggle={toggle} />
      )}
      ListFooterComponent={
        droppedCount > 0 ? (
          <Text style={styles.dropped}>
            {droppedCount} older {droppedCount === 1 ? 'entry' : 'entries'}{' '}
            dropped to keep the log responsive
          </Text>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  channel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  event: { color: '#7dd3fc' },
  result: { color: '#86efac' },
  error: { color: '#fca5a5' },
  label: { color: '#e5e5e5', flex: 1, fontSize: 13 },
  acted: { color: '#fbbf24', fontSize: 10 },
  payload: {
    color: '#a3a3a3',
    fontFamily: 'Courier',
    fontSize: 11,
    marginTop: 6,
  },
  dropped: {
    color: '#737373',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 10,
  },
});
