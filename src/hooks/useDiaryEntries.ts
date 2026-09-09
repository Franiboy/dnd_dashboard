import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './useApi';
import type { DiaryEntry, VersionInfo } from '../../shared/types';

/** Diary entry list state: loading, AI flag and entry replacement helpers. */
export function useDiaryEntries() {
  const { request } = useApi();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const entriesRef = useRef(entries);
  const [loading, setLoading] = useState(true);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const loadEntries = useCallback(async () => {
    const { data, error } = await request<{ entries: DiaryEntry[] }>('/api/diary/entries');
    if (data) {
      setEntries(data.entries || []);
    }
    setLoading(false);
    if (error) return;
  }, [request]);

  useEffect(() => {
    request<VersionInfo>('/api/version', undefined, false).then(({ data }) => {
      if (data) setAiEnabled(data.aiEnabled);
    });
    // Inline .then chain: the lint's data-flow analysis tracks promise
    // callbacks, unlike a discarded async loader call.
    request<{ entries: DiaryEntry[] }>('/api/diary/entries').then(({ data }) => {
      if (data) setEntries(data.entries || []);
      setLoading(false);
    });
  }, [request]);

  const replaceEntry = useCallback((entry: DiaryEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? entry : e)));
  }, []);

  const addEntry = useCallback((entry: DiaryEntry) => {
    setEntries((prev) => [entry, ...prev]);
  }, []);

  const removeEntry = useCallback((id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    entries,
    entriesRef,
    loading,
    aiEnabled,
    loadEntries,
    setEntries,
    replaceEntry,
    addEntry,
    removeEntry,
  };
}
