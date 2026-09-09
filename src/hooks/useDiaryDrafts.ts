import { useCallback, useEffect, useRef, useState } from 'react';
import type Quill from 'quill';
import { useApi } from './useApi';
import { useError } from './useError';
import { ensureHtml } from '../components/quillConfig';
import { DRAFT_KEY_PREFIX, isEmptyHtml, normalizeDraftHtml } from '../lib/diaryDraft';
import type { DiaryEntry } from '../../shared/types';

const SERVER_SAVE_DELAY_MS = 1500;
const DRAFT_SAVE_DELAY_MS = 500;

interface DraftState {
  raw: string;
  normalized: string;
}

interface UseDiaryDraftsOptions {
  /** Authenticated user id; drafts are namespaced per user in localStorage. */
  userId?: string;
  entriesRef: { readonly current: DiaryEntry[] };
  setEntries: React.Dispatch<React.SetStateAction<DiaryEntry[]>>;
  /** Entries currently showing the KI version instead of the original. */
  viewingRewrittenIds: Set<number>;
  /** Called after user input so the page can debounce entity highlights. */
  onUserQuillInput?: (quill: Quill, entryId: number) => void;
}

/**
 * Draft persistence for diary editors: unsaved edits live in localStorage
 * (per user, entry and original/KI version) and the original text is saved
 * to the server with a debounce. Also flushes pending drafts on page unload.
 */
export function useDiaryDrafts(options: UseDiaryDraftsOptions) {
  const { userId, entriesRef, setEntries, viewingRewrittenIds, onUserQuillInput } = options;
  const { request } = useApi();
  const { showError } = useError();

  const draftKeyPrefix = userId ? `${DRAFT_KEY_PREFIX}${userId}-` : DRAFT_KEY_PREFIX;
  const getDraftKey = useCallback(
    (entryId: number, kind: 'original' | 'rewritten') => `${draftKeyPrefix}${entryId}-${kind}`,
    [draftKeyPrefix]
  );

  const [draftOriginal, setDraftOriginal] = useState<Record<number, DraftState>>({});
  const [draftRewritten, setDraftRewritten] = useState<Record<number, DraftState>>({});
  const autoSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const serverSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const draftRawRefs = useRef<{
    original: Record<number, string>;
    rewritten: Record<number, string>;
  }>({ original: {}, rewritten: {} });

  useEffect(() => {
    function flushServerSaves() {
      for (const [id, raw] of Object.entries(draftRawRefs.current.original)) {
        const content = normalizeDraftHtml(raw);
        const current = entriesRef.current.find((e) => e.id === Number(id));
        if (!current || content === normalizeDraftHtml(current.content) || isEmptyHtml(content))
          continue;
        try {
          fetch(`/api/diary/entries/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: ensureHtml(content) }),
            credentials: 'include',
            keepalive: true,
          });
        } catch {
          // Best-effort flush on page unload.
        }
      }
    }

    function savePendingDrafts() {
      for (const kind of ['original', 'rewritten'] as const) {
        for (const [id, raw] of Object.entries(draftRawRefs.current[kind])) {
          const key = `${draftKeyPrefix}${id}-${kind}`;
          if (isEmptyHtml(normalizeDraftHtml(raw))) {
            localStorage.removeItem(key);
          } else {
            try {
              localStorage.setItem(key, raw);
            } catch {
              // ignore quota errors
            }
          }
        }
      }
      flushServerSaves();
    }
    window.addEventListener('beforeunload', savePendingDrafts);
    return () => {
      window.removeEventListener('beforeunload', savePendingDrafts);
    };
  }, [draftKeyPrefix, entriesRef]);

  /** Current editor content for an entry: draft, then stored entry text. */
  function getEditingContent(entry: DiaryEntry): string {
    if (viewingRewrittenIds.has(entry.id) && entry.rewrittenFilePath) {
      const raw =
        draftRewritten[entry.id]?.raw ?? localStorage.getItem(getDraftKey(entry.id, 'rewritten'));
      return raw ?? entry.rewrittenContent ?? '';
    }
    const raw =
      draftOriginal[entry.id]?.raw ?? localStorage.getItem(getDraftKey(entry.id, 'original'));
    return raw ?? entry.content;
  }

  /** Drops local drafts and pending save timers for an entry. */
  function cancelEntryEdit(entry: DiaryEntry, kind?: 'original' | 'rewritten') {
    const kinds: Array<'original' | 'rewritten'> = kind ? [kind] : ['original', 'rewritten'];
    for (const k of kinds) {
      const key = getDraftKey(entry.id, k);
      localStorage.removeItem(key);
      const timeoutKey = `${entry.id}-${k}`;
      clearTimeout(autoSaveTimeouts.current[timeoutKey]);
      delete autoSaveTimeouts.current[timeoutKey];
      if (k === 'original') {
        const serverKey = `${entry.id}-original`;
        clearTimeout(serverSaveTimeouts.current[serverKey]);
        delete serverSaveTimeouts.current[serverKey];
      }
      delete draftRawRefs.current[k][entry.id];
      if (k === 'original') {
        setDraftOriginal((prev) => {
          if (!prev[entry.id]) return prev;
          const next = { ...prev };
          delete next[entry.id];
          return next;
        });
      } else {
        setDraftRewritten((prev) => {
          if (!prev[entry.id]) return prev;
          const next = { ...prev };
          delete next[entry.id];
          return next;
        });
      }
    }
  }

  /** Loads persisted drafts into editor state when an entry is expanded. */
  function primeDraftsFromStorage(id: number) {
    setDraftOriginal((prev) => {
      if (prev[id]) return prev;
      const saved = localStorage.getItem(getDraftKey(id, 'original'));
      if (!saved) return prev;
      return { ...prev, [id]: { raw: saved, normalized: normalizeDraftHtml(saved) } };
    });
    setDraftRewritten((prev) => {
      if (prev[id]) return prev;
      const saved = localStorage.getItem(getDraftKey(id, 'rewritten'));
      if (!saved) return prev;
      return { ...prev, [id]: { raw: saved, normalized: normalizeDraftHtml(saved) } };
    });
  }

  function scheduleDraftSave(
    entry: DiaryEntry,
    kind: 'original' | 'rewritten',
    raw: string,
    normalized: string
  ) {
    const key = getDraftKey(entry.id, kind);
    const timeoutKey = `${entry.id}-${kind}`;
    clearTimeout(autoSaveTimeouts.current[timeoutKey]);
    const canonical = normalizeDraftHtml(
      kind === 'original' ? entry.content : (entry.rewrittenContent ?? '')
    );
    if (normalized === canonical || isEmptyHtml(normalized)) {
      localStorage.removeItem(key);
      delete autoSaveTimeouts.current[timeoutKey];
      delete draftRawRefs.current[kind][entry.id];
      return;
    }
    autoSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      try {
        localStorage.setItem(key, raw);
      } catch {
        // ignore quota errors
      }
      delete autoSaveTimeouts.current[timeoutKey];
    }, DRAFT_SAVE_DELAY_MS);
  }

  function clearServerSaveTimeout(entryId: number) {
    const timeoutKey = `${entryId}-original`;
    clearTimeout(serverSaveTimeouts.current[timeoutKey]);
    delete serverSaveTimeouts.current[timeoutKey];
  }

  function scheduleServerSave(entry: DiaryEntry, raw: string) {
    const timeoutKey = `${entry.id}-original`;
    clearTimeout(serverSaveTimeouts.current[timeoutKey]);
    serverSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      delete serverSaveTimeouts.current[timeoutKey];
      void saveOriginalToServer(entry, raw, false);
    }, SERVER_SAVE_DELAY_MS);
  }

  /** Debounced persistence of the original text to the server. */
  async function saveOriginalToServer(
    entry: DiaryEntry,
    rawDraft: string,
    notifyError = true
  ): Promise<boolean> {
    const content = normalizeDraftHtml(rawDraft);
    const currentEntry = entriesRef.current.find((e) => e.id === entry.id) ?? entry;
    const canonical = normalizeDraftHtml(currentEntry.content);
    if (content === canonical || isEmptyHtml(content)) return false;

    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ensureHtml(content) }),
    });

    if (error) {
      if (notifyError) showError(error);
      return false;
    }

    if (data?.entry) {
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== entry.id) return e;
          if (e.updatedAt && data.entry.updatedAt < e.updatedAt) return e;
          return data.entry;
        })
      );
      const rawAtSend = draftRawRefs.current.original[entry.id] ?? rawDraft;
      const noNewerChanges = draftRawRefs.current.original[entry.id] === rawAtSend;
      const savedMatchesDraft =
        noNewerChanges && normalizeDraftHtml(rawAtSend) === normalizeDraftHtml(data.entry.content);
      if (noNewerChanges) {
        localStorage.removeItem(getDraftKey(entry.id, 'original'));
        delete draftRawRefs.current.original[entry.id];
      }
      if (!savedMatchesDraft) {
        setDraftOriginal((prev) => {
          if (!prev[entry.id]) return prev;
          const next = { ...prev };
          delete next[entry.id];
          return next;
        });
      }
      return true;
    }

    return false;
  }

  function handleQuillChange(
    entry: DiaryEntry,
    value: string,
    source: string,
    kind: 'original' | 'rewritten',
    quill?: Quill
  ) {
    const setDraft = kind === 'original' ? setDraftOriginal : setDraftRewritten;
    const normalized = normalizeDraftHtml(value);
    setDraft((prev) => {
      if (prev[entry.id]?.raw === value) return prev;
      return { ...prev, [entry.id]: { raw: value, normalized } };
    });
    if (source === 'user') {
      draftRawRefs.current[kind][entry.id] = value;
      scheduleDraftSave(entry, kind, value, normalized);
      if (kind === 'original') {
        scheduleServerSave(entry, value);
      }
      if (quill) onUserQuillInput?.(quill, entry.id);
    }
  }

  return {
    draftOriginal,
    draftRewritten,
    draftRawRefs,
    getDraftKey,
    getEditingContent,
    cancelEntryEdit,
    primeDraftsFromStorage,
    clearServerSaveTimeout,
    saveOriginalToServer,
    handleQuillChange,
  };
}
