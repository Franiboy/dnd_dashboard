import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type ReactQuill from 'react-quill-new';
import type Quill from 'quill';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { useEntityMappings } from '../hooks/useEntityMappings';
import { useError } from '../hooks/useError';
import { useStoryArcs } from '../hooks/useStoryArcs';
import { useDiaryEntries } from '../hooks/useDiaryEntries';
import { useDiaryDrafts } from '../hooks/useDiaryDrafts';
import { useDiaryAiStatus } from '../hooks/useDiaryAiStatus';
import { arcMatchesFilter } from '../lib/storyArcs';
import { splitEntityLabel } from '../lib/entityLabels';
import { applyEntityHighlights } from '../components/EntityQuillBlot';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { SideDrawer, SideDrawerItem } from '../components/SideDrawer';
import { QuillWithEntityMention } from '../components/QuillWithEntityMention';
import { DiaryCreateModal } from '../components/diary/DiaryCreateModal';
import { DiarySummaryPanel } from '../components/diary/DiarySummaryPanel';
import { isEmptyHtml, normalizeDraftHtml } from '../lib/diaryDraft';
import { ensureHtml, stripHtml, quillFormats, quillModules } from '../components/quillConfig';

import type { DiaryEntry, EntityType } from '../../shared/types';
import 'react-quill-new/dist/quill.snow.css';

const SUMMARY_MAX_LENGTH = 500;

interface BadgeListProps {
  items: string[];
  variant: 'person' | 'organization' | 'location' | 'item';
}

const badgeStyles = {
  person: 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20',
  organization: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  location: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  item: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
};

const badgeTypeMap: Record<BadgeListProps['variant'], EntityType> = {
  person: 'persons',
  organization: 'organizations',
  location: 'locations',
  item: 'items',
};

function BadgeList({ items, variant }: BadgeListProps) {
  const { openEntity } = useEntityDialog();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {items.map((item) => {
        // Items are qualified labels ("Name (Qualifier)") - parse before
        // opening so homonyms resolve to the exact entity.
        const { name, qualifier } = splitEntityLabel(item);
        return (
          <span
            key={item}
            onClick={() => openEntity(name, badgeTypeMap[variant], undefined, qualifier)}
            title="Öffnen"
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:brightness-110 transition ${badgeStyles[variant]}`}
          >
            {item}
          </span>
        );
      })}
    </div>
  );
}

export function Diary() {
  const { request } = useApi();
  const { user } = useAuth();
  const { mappings } = useEntityMappings();
  const { showSuccess, showError } = useError();
  const [searchParams] = useSearchParams();
  const [working, setWorking] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    entries,
    entriesRef,
    loading,
    aiEnabled,
    loadEntries,
    setEntries,
    replaceEntry,
    addEntry,
    removeEntry,
  } = useDiaryEntries();
  const { aiStatus, setAiStatus, aiOperation, setAiOperation, sseReadyRef } = useDiaryAiStatus();
  const { arcs: storyArcs, selectedArcId } = useStoryArcs();

  const visibleEntries = useMemo(
    () => entries.filter((entry) => arcMatchesFilter(selectedArcId, entry.arcId)),
    [entries, selectedArcId]
  );

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingRewrittenIds, setViewingRewrittenIds] = useState<Set<number>>(new Set());
  const [editingSummaryId, setEditingSummaryId] = useState<number | null>(null);
  const [editingSummaryText, setEditingSummaryText] = useState('');
  const [processingSummaryId, setProcessingSummaryId] = useState<number | null>(null);
  const [processingRewriteId, setProcessingRewriteId] = useState<number | null>(null);
  const [processingCommandId, setProcessingCommandId] = useState<number | null>(null);
  const [rewriteCommands, setRewriteCommands] = useState<Record<number, string>>({});
  const entryRefs = useRef<Record<number, HTMLElement>>({});
  const quillRefs = useRef<Record<number, ReactQuill>>({});
  const highlightTimeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  function quillRefOf(entryId: number): Quill | undefined {
    return quillRefs.current[entryId]?.getEditor();
  }

  function scheduleEntityHighlights(quill: Quill, entryId: number) {
    const existing = highlightTimeouts.current[entryId];
    if (existing) clearTimeout(existing);
    highlightTimeouts.current[entryId] = setTimeout(() => {
      applyEntityHighlights(quill, mappings);
      delete highlightTimeouts.current[entryId];
    }, 300);
  }

  const {
    draftOriginal,
    draftRewritten,
    draftRawRefs,
    getDraftKey,
    getEditingContent,
    cancelEntryEdit,
    primeDraftsFromStorage,
    purgeDrafts,
    clearServerSaveTimeout,
    saveOriginalToServer,
    handleQuillChange,
  } = useDiaryDrafts({
    userId: user?.id,
    entriesRef,
    setEntries,
    viewingRewrittenIds,
    onUserQuillInput: scheduleEntityHighlights,
  });

  // Deep link (?entry=<id>): expand, prefer the KI version and scroll into view.
  // Both adjustments are derived during render instead of syncing state in an
  // effect, so no cascading render is needed.
  const deepLinkEntryId = useMemo(() => {
    const raw = searchParams.get('entry');
    const id = raw === null ? NaN : Number(raw);
    return Number.isFinite(id) ? id : null;
  }, [searchParams]);

  const effectiveExpandedIds = useMemo(() => {
    if (deepLinkEntryId === null || !entries.some((e) => e.id === deepLinkEntryId)) {
      return expandedIds;
    }
    return new Set(expandedIds).add(deepLinkEntryId);
  }, [expandedIds, deepLinkEntryId, entries]);

  const effectiveViewingRewrittenIds = useMemo(() => {
    if (deepLinkEntryId === null) return viewingRewrittenIds;
    const entry = entries.find((e) => e.id === deepLinkEntryId);
    if (!entry || !(entry.rewrittenContent || entry.rewrittenFilePath)) return viewingRewrittenIds;
    return new Set(viewingRewrittenIds).add(deepLinkEntryId);
  }, [viewingRewrittenIds, deepLinkEntryId, entries]);

  useEffect(() => {
    if (deepLinkEntryId === null || entries.length === 0) return;
    if (!entries.some((e) => e.id === deepLinkEntryId)) return;

    const entryId = deepLinkEntryId;
    const timer = setTimeout(() => {
      const element = entryRefs.current[entryId];
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        element.classList.add('ring-2', 'ring-[var(--accent)]');
        setTimeout(() => element.classList.remove('ring-2', 'ring-[var(--accent)]'), 2000);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [deepLinkEntryId, loading, entries]);

  // Re-apply entity highlights when mappings or the expanded set changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const id of expandedIds) {
        const entry = entriesRef.current.find((e) => e.id === id);
        if (!entry) continue;
        const reactQuill = quillRefs.current[id];
        if (!reactQuill) continue;
        const quill = reactQuill.getEditor();
        if (quill) applyEntityHighlights(quill, mappings);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [mappings, expandedIds, entriesRef]);

  async function handleDelete(id: number) {
    setWorking(true);
    const { error } = await request(`/api/diary/entries/${id}`, { method: 'DELETE' });
    setWorking(false);
    if (!error) {
      removeEntry(id);
      purgeDrafts(id);
      showSuccess('Eintrag gelöscht.');
    }
  }

  async function handleArcChange(entry: DiaryEntry, arcId: number | null) {
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arcId }),
    });
    if (data) {
      replaceEntry(data.entry);
      showSuccess('Story Arc gespeichert.');
    } else if (error) {
      showError(error);
    }
  }

  /** Shared sequence for AI actions: wait for the SSE stream, flag busy. */
  async function beginAiAction(status: string) {
    setAiOperation(true);
    setAiStatus(status);
    await Promise.race([
      sseReadyRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    setWorking(true);
  }

  function endAiAction() {
    setWorking(false);
    setAiOperation(false);
  }

  function setViewRewritten(id: number, showRewritten: boolean) {
    setViewingRewrittenIds((prev) => {
      const next = new Set(prev);
      if (showRewritten) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleRewrite(entry: DiaryEntry) {
    setProcessingRewriteId(entry.id);
    await beginAiAction('Text wird von KI umgeschrieben...');
    const { data, error } = await request<{ entry: DiaryEntry }>(
      `/api/diary/entries/${entry.id}/rewrite`,
      {
        method: 'POST',
      }
    );
    endAiAction();
    setProcessingRewriteId(null);
    if (data) {
      cancelEntryEdit(entry, 'rewritten');
      replaceEntry(data.entry);
      setViewRewritten(entry.id, true);
      setAiStatus(null);
      showSuccess('KI-Version aktualisiert.');
    } else if (error) {
      setAiStatus(null);
      showError(error);
    }
  }

  async function handleRewriteCommand(entry: DiaryEntry, command: string) {
    if (!command.trim() || !entry.rewriteSessionId) return;
    setProcessingCommandId(entry.id);
    await beginAiAction('KI führt Befehl aus...');
    const { data, error } = await request<{ entry: DiaryEntry }>(
      `/api/diary/entries/${entry.id}/rewrite-command`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command.trim() }),
      }
    );
    endAiAction();
    setProcessingCommandId(null);
    if (data) {
      cancelEntryEdit(entry, 'rewritten');
      replaceEntry(data.entry);
      setViewRewritten(entry.id, true);
      setRewriteCommands((prev) => ({ ...prev, [entry.id]: '' }));
      setAiStatus(null);
      showSuccess('KI-Version angepasst.');
    } else if (error) {
      setAiStatus(null);
      showError(error);
    }
  }

  async function handleGenerateSummary(entry: DiaryEntry) {
    setProcessingSummaryId(entry.id);
    await beginAiAction('Zusammenfassung und Personen werden neu generiert...');
    const { data, error } = await request<{ entry: DiaryEntry }>(
      `/api/diary/entries/${entry.id}/summarize`,
      {
        method: 'POST',
      }
    );
    endAiAction();
    setProcessingSummaryId(null);
    if (data) {
      replaceEntry(data.entry);
      setAiStatus(null);
      showSuccess('Zusammenfassung erstellt.');
    } else if (error) {
      showError(error);
    }
  }

  async function handleAcceptRewritten(entry: DiaryEntry) {
    const rawDraft =
      draftRewritten[entry.id]?.raw ?? localStorage.getItem(getDraftKey(entry.id, 'rewritten'));
    const content = rawDraft
      ? normalizeDraftHtml(rawDraft)
      : normalizeDraftHtml(entry.rewrittenContent ?? '');
    if (!entry.rewrittenFilePath || isEmptyHtml(content)) return;
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ensureHtml(content), rewrittenContent: null }),
    });
    setWorking(false);
    if (data) {
      replaceEntry(data.entry);
      setViewRewritten(entry.id, false);
      cancelEntryEdit(entry);
      setTimeout(() => {
        const reactQuill = quillRefs.current[entry.id];
        const quill = reactQuill?.getEditor();
        if (quill) applyEntityHighlights(quill, mappings);
      }, 50);
      showSuccess('Überarbeitung übernommen.');
    } else if (error) {
      showError(error);
    }
  }

  async function handleDiscardRewritten(entry: DiaryEntry) {
    if (entry.sessionDraftFor && isEmptyHtml(entry.content)) {
      await handleDelete(entry.id);
      return;
    }
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewrittenContent: null }),
    });
    setWorking(false);
    if (data) {
      replaceEntry(data.entry);
      setViewRewritten(entry.id, false);
      cancelEntryEdit(entry, 'rewritten');
      setTimeout(() => {
        const reactQuill = quillRefs.current[entry.id];
        const quill = reactQuill?.getEditor();
        if (quill) applyEntityHighlights(quill, mappings);
      }, 50);
    } else if (error) {
      showError(error);
    }
  }

  async function toggleExpanded(id: number) {
    const isExpanding = !expandedIds.has(id);
    if (isExpanding) {
      const entry = entries.find((e) => e.id === id);
      if (entry?.rewrittenFilePath && !entry.rewrittenContent) {
        const { data } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${id}`);
        if (data) {
          replaceEntry(data.entry);
        }
      }
      const currentEntry = entriesRef.current.find((e) => e.id === id);
      if (currentEntry?.sessionDraftFor) {
        setViewRewritten(id, true);
      }
      primeDraftsFromStorage(id);
    } else {
      const entry = entriesRef.current.find((e) => e.id === id);
      const rawDraft =
        draftRawRefs.current.original[id] ??
        draftOriginal[id]?.raw ??
        localStorage.getItem(getDraftKey(id, 'original'));
      if (entry && rawDraft) {
        clearServerSaveTimeout(id);
        await saveOriginalToServer(entry, rawDraft, false);
      }
    }
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startSummaryEdit(entry: DiaryEntry) {
    setEditingSummaryId(entry.id);
    setEditingSummaryText(entry.summary || '');
  }

  function cancelSummaryEdit() {
    setEditingSummaryId(null);
    setEditingSummaryText('');
  }

  async function saveSummaryEdit(entry: DiaryEntry) {
    if (editingSummaryText.trim().length > SUMMARY_MAX_LENGTH) {
      showError(`Zusammenfassung darf maximal ${SUMMARY_MAX_LENGTH} Zeichen haben`);
      return;
    }

    setWorking(true);
    const { data } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: editingSummaryText.trim() || null }),
    });
    setWorking(false);

    if (data) {
      replaceEntry(data.entry);
      showSuccess('Zusammenfassung aktualisiert.');
      cancelSummaryEdit();
    }
    // Errors are already displayed by useApi.
  }

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      <SideDrawer side="right">
        <SideDrawerItem
          id="create"
          label="Neuer Eintrag"
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
        >
          <div className="p-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="w-full px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition"
            >
              Neuer Eintrag
            </button>
          </div>
        </SideDrawerItem>
      </SideDrawer>

      {aiStatus && (
        <div className="fixed bottom-4 right-4 bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3 shadow-lg z-50 max-w-md">
          {aiOperation ? (
            <Loading size="sm" text={aiStatus} />
          ) : (
            <p className="text-sm text-slate-400 break-words">{aiStatus}</p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto -mx-6 px-6">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">Noch keine Tagebucheinträge vorhanden.</p>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">Keine Einträge im gewählten Story Arc vorhanden.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleEntries.map((entry) => (
              <article
                key={entry.id}
                ref={(el) => {
                  if (el) entryRefs.current[entry.id] = el;
                }}
                className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 transition"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <h3 className="text-lg font-semibold text-[var(--text-h)]">
                      Spieltag {entry.gameDay ?? '—'}
                    </h3>
                    {storyArcs.length > 0 && (
                      <select
                        value={entry.arcId ?? ''}
                        onChange={(e) =>
                          void handleArcChange(
                            entry,
                            e.target.value === '' ? null : Number(e.target.value)
                          )
                        }
                        title="Story Arc zuweisen"
                        aria-label="Story-Arc-Zuweisung"
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-900 border border-[var(--border)] text-slate-300 focus:outline-none focus:border-[var(--accent)] max-w-[12rem] cursor-pointer"
                      >
                        <option value="">Ohne Arc</option>
                        {storyArcs.map((arc) => (
                          <option key={arc.id} value={arc.id}>
                            {arc.name}
                            {arc.status === 'active' ? ' ▶' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {entry.sessionDraftFor && (
                      <Link
                        to={`/sessions?session=${entry.sessionDraftFor}`}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/30 transition"
                        title={
                          entry.sessionDraftForName
                            ? `Springe zu Session „${entry.sessionDraftForName}“`
                            : 'Springe zur Session'
                        }
                      >
                        {entry.sessionDraftForName
                          ? `Session: ${entry.sessionDraftForName}`
                          : 'Session-Vorschlag'}
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(entry.id)}
                      disabled={working}
                    >
                      Löschen
                    </Button>
                  </div>
                </div>

                <DiarySummaryPanel
                  entry={entry}
                  working={working}
                  processing={processingSummaryId === entry.id}
                  editing={editingSummaryId === entry.id}
                  editText={editingSummaryText}
                  onEditText={setEditingSummaryText}
                  onGenerate={() => handleGenerateSummary(entry)}
                  onStartEdit={() => startSummaryEdit(entry)}
                  onSave={() => saveSummaryEdit(entry)}
                  onCancel={cancelSummaryEdit}
                  mappings={mappings}
                />

                <BadgeList items={entry.persons} variant="person" />
                <BadgeList items={entry.organizations} variant="organization" />
                <BadgeList items={entry.locations} variant="location" />
                <BadgeList items={entry.items} variant="item" />

                {effectiveExpandedIds.has(entry.id) ? (
                  <>
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      {entry.rewrittenFilePath ? (
                        <div className="inline-flex rounded-lg bg-slate-800 p-1 border border-[var(--border)]">
                          <button
                            type="button"
                            onClick={() => setViewRewritten(entry.id, false)}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                              !effectiveViewingRewrittenIds.has(entry.id)
                                ? 'bg-[var(--accent)] text-slate-900'
                                : 'text-slate-300 hover:text-[var(--text-h)]'
                            }`}
                          >
                            Original
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewRewritten(entry.id, true)}
                            disabled={working}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                              viewingRewrittenIds.has(entry.id)
                                ? 'bg-[var(--accent)] text-slate-900'
                                : 'text-slate-300 hover:text-[var(--text-h)]'
                            }`}
                          >
                            KI-Version
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">Original</span>
                      )}
                      <div className="flex items-center gap-2">
                        {aiEnabled && (
                          <Button
                            variant="secondary"
                            onClick={() => handleRewrite(entry)}
                            disabled={working || processingRewriteId === entry.id}
                            title={
                              entry.rewrittenFilePath
                                ? 'Weitere Verbesserung der KI-Version anfordern'
                                : undefined
                            }
                            icon={
                              processingRewriteId === entry.id ? (
                                <svg
                                  className="animate-spin"
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                  <path d="M21 4v6h-6" />
                                </svg>
                              )
                            }
                          >
                            {processingRewriteId === entry.id
                              ? 'Wird verarbeitet...'
                              : entry.rewrittenFilePath
                                ? 'KI verbessern'
                                : 'KI umschreiben'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {effectiveViewingRewrittenIds.has(entry.id) && entry.rewrittenFilePath ? (
                      <div className="rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/30 p-4 mb-4">
                        <form
                          className="flex items-center gap-2 mb-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const text = rewriteCommands[entry.id] || '';
                            if (text.trim()) handleRewriteCommand(entry, text);
                          }}
                        >
                          <input
                            type="text"
                            value={rewriteCommands[entry.id] || ''}
                            onChange={(e) =>
                              setRewriteCommands((prev) => ({
                                ...prev,
                                [entry.id]: e.target.value,
                              }))
                            }
                            placeholder="Befehl für KI (z. B. formeller)"
                            className="px-2 py-1 rounded-md text-sm bg-slate-900 border border-[var(--border)] text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-full max-w-md"
                            disabled={working || processingCommandId === entry.id}
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            disabled={
                              working ||
                              processingCommandId === entry.id ||
                              !(rewriteCommands[entry.id] || '').trim()
                            }
                          >
                            {processingCommandId === entry.id ? 'Wird verarbeitet...' : 'Ausführen'}
                          </Button>
                        </form>
                        <QuillWithEntityMention
                          quillRef={(el) => {
                            if (el) quillRefs.current[entry.id] = el;
                          }}
                          mappings={mappings}
                          theme="snow"
                          value={getEditingContent(entry)}
                          onChange={(value, _delta, source) =>
                            handleQuillChange(
                              entry,
                              value,
                              source,
                              'rewritten',
                              quillRefOf(entry.id)
                            )
                          }
                          modules={quillModules}
                          formats={quillFormats}
                          readOnly={working}
                          className="diary-editor bg-slate-900 text-[var(--text-h)] rounded border border-[var(--accent)]/30 mb-4"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="accent"
                            onClick={() => handleAcceptRewritten(entry)}
                            disabled={working || !stripHtml(getEditingContent(entry)).trim()}
                          >
                            Übernehmen
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handleDiscardRewritten(entry)}
                            disabled={working}
                          >
                            Verwerfen
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4">
                        <QuillWithEntityMention
                          quillRef={(el) => {
                            if (el) quillRefs.current[entry.id] = el;
                          }}
                          mappings={mappings}
                          theme="snow"
                          value={getEditingContent(entry)}
                          onChange={(value, _delta, source) =>
                            handleQuillChange(
                              entry,
                              value,
                              source,
                              'original',
                              quillRefOf(entry.id)
                            )
                          }
                          modules={quillModules}
                          formats={quillFormats}
                          readOnly={working}
                          className="diary-editor bg-slate-900 text-[var(--text-h)] rounded border border-[var(--border)] mb-2"
                        />
                      </div>
                    )}

                    <Button variant="ghost" onClick={() => toggleExpanded(entry.id)}>
                      Weniger anzeigen
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => toggleExpanded(entry.id)}>
                    Mehr anzeigen
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <DiaryCreateModal
        isOpen={isModalOpen}
        entries={entries}
        working={working}
        aiOperation={aiOperation}
        aiStatus={aiStatus}
        onClose={() => setIsModalOpen(false)}
        onCreated={(entry) => {
          showSuccess('Eintrag erstellt.');
          setAiStatus(null);
          addEntry(entry);
          void loadEntries();
        }}
        onWorkingChange={setWorking}
        onAiStart={(status) => {
          setAiOperation(true);
          setAiStatus(status);
        }}
        onAiEnd={() => {
          setAiOperation(false);
        }}
        sseReadyRef={sseReadyRef}
        mappings={mappings}
      />
    </div>
  );
}
