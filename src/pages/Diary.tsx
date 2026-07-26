import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useError } from '../hooks/useError';
import { Button } from '../components/Button';
import { DashboardHeader } from '../components/DashboardHeader';
import { DashboardLayout } from '../components/DashboardLayout';
import { GridPanel } from '../components/GridPanel';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import ReactQuill from 'react-quill-new';
import type { DiaryEntry, VersionInfo } from '../../shared/types';
import 'react-quill-new/dist/quill.snow.css';

const SUMMARY_MAX_LENGTH = 500;

interface DiaryFormData {
  title: string;
  content: string;
}

function stripHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

function isHtml(text: string): boolean {
  return /<[^>]+>/.test(text.trim());
}

function ensureHtml(text: string): string {
  if (isHtml(text)) return text;
  return text
    .trim()
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean'],
  ],
};

const quillFormats = ['header', 'bold', 'italic', 'underline', 'strike', 'list', 'bullet'];

interface BadgeListProps {
  items: string[];
  variant: 'person' | 'organization' | 'location';
}

const badgeStyles = {
  person: 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20',
  organization: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  location: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
};

function BadgeList({ items, variant }: BadgeListProps) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {items.map((item) => (
        <span
          key={item}
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${badgeStyles[variant]}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function Diary() {
  const { request } = useApi();
  const { showSuccess, showError } = useError();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<DiaryFormData>({ title: '', content: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingRewrittenIds, setViewingRewrittenIds] = useState<Set<number>>(new Set());
  const [editingSummaryId, setEditingSummaryId] = useState<number | null>(null);
  const [editingSummaryText, setEditingSummaryText] = useState('');
  const [processingSummaryId, setProcessingSummaryId] = useState<number | null>(null);
  const [processingRewriteId, setProcessingRewriteId] = useState<number | null>(null);
  const [processingCommandId, setProcessingCommandId] = useState<number | null>(null);
  const [rewriteCommands, setRewriteCommands] = useState<Record<number, string>>({});
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiOperation, setAiOperation] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const sseReadyRef = useRef(Promise.resolve());

  const loadEntries = useCallback(async () => {
    const { data, error } = await request<{ entries: DiaryEntry[] }>('/api/diary/entries');
    if (data) {
      setEntries(data.entries || []);
    }
    if (error) {
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [request]);

  useEffect(() => {
    request<VersionInfo>('/api/version', undefined, false).then(({ data }) => {
      if (data) setAiEnabled(data.aiEnabled);
    });
    loadEntries();
  }, [request, loadEntries]);

  useEffect(() => {
    let resolveReady: (() => void) | null = null;
    sseReadyRef.current = new Promise((resolve) => {
      resolveReady = resolve;
    });

    const es = new EventSource('/api/diary/ai-events', { withCredentials: true });
    es.addEventListener('open', () => {
      resolveReady?.();
    });
    es.addEventListener('log', (event) => {
      try {
        const { message } = JSON.parse(event.data);
        if (typeof message === 'string') {
          setAiStatus(message);
        }
      } catch {
        // ignore malformed SSE messages
      }
    });
    return () => {
      resolveReady?.();
      es.close();
    };
  }, []);


  function resetForm(entry?: DiaryEntry) {
    if (entry) {
      setForm({ title: entry.title, content: entry.content });
      setEditingId(entry.id);
    } else {
      setForm({ title: '', content: '' });
      setEditingId(null);
    }
    setFormError(null);
  }

  function openCreate() {
    resetForm();
    setIsModalOpen(true);
  }

  function openEdit(entry: DiaryEntry) {
    resetForm(entry);
    setIsModalOpen(true);
  }

  function closeModal() {
    if (working) return;
    setIsModalOpen(false);
    resetForm();
  }

  function handleResetLayout() {
    localStorage.removeItem('diary-layout-v2');
    setResetKey((k) => k + 1);
  }

  async function handleSubmit(e?: React.FormEvent): Promise<DiaryEntry | null> {
    e?.preventDefault();
    setFormError(null);

    const plainText = stripHtml(form.content).trim();
    if (!form.title.trim() || !plainText) {
      setFormError('Titel und Inhalt sind erforderlich');
      return null;
    }

    const payload = {
      title: form.title,
      content: form.content,
    };

    if (editingId === null) {
      setAiOperation(true);
      setAiStatus('Eintrag wird erstellt und analysiert...');
      await Promise.race([sseReadyRef.current, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    }
    setWorking(true);

    let res;
    try {
      if (editingId !== null) {
        res = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await request<{ entry: DiaryEntry }>('/api/diary/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    } finally {
      setWorking(false);
      setAiOperation(false);
    }

    if (res.error) {
      setFormError(res.error);
      return null;
    }

    if (res.data) {
      showSuccess(editingId !== null ? 'Eintrag aktualisiert.' : 'Eintrag erstellt.');
      setAiStatus(null);
      setEntries((prev) => {
        if (editingId !== null) {
          return prev.map((e) => (e.id === editingId ? res.data!.entry : e));
        }
        return [res.data!.entry, ...prev];
      });
    }

    closeModal();
    loadEntries();
    return res.data?.entry ?? null;
  }

  async function handleCreateAndRewrite() {
    if (editingId !== null) return;
    const entry = await handleSubmit();
    if (entry) {
      await handleRewrite(entry);
    }
  }

  async function handleDelete(id: number) {
    setWorking(true);
    const { error } = await request(`/api/diary/entries/${id}`, { method: 'DELETE' });
    setWorking(false);
    if (!error) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      showSuccess('Eintrag gelöscht.');
    }
  }

  async function handleRewrite(entry: DiaryEntry) {
    setProcessingRewriteId(entry.id);
    setAiOperation(true);
    setAiStatus('Text wird von KI umgeschrieben...');
    await Promise.race([sseReadyRef.current, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}/rewrite`, {
      method: 'POST',
    });
    setWorking(false);
    setAiOperation(false);
    setProcessingRewriteId(null);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setViewRewritten(entry.id, true);
      setAiStatus(null);
      showSuccess('KI-Version aktualisiert.');
    } else if (error) {
      setAiStatus(null);
      setFormError(error);
    }
  }

  async function handleRewriteCommand(entry: DiaryEntry, command: string) {
    if (!command.trim() || !entry.rewriteSessionId) return;
    setProcessingCommandId(entry.id);
    setAiOperation(true);
    setAiStatus('KI führt Befehl aus...');
    await Promise.race([sseReadyRef.current, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}/rewrite-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: command.trim() }),
    });
    setWorking(false);
    setAiOperation(false);
    setProcessingCommandId(null);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setViewRewritten(entry.id, true);
      setRewriteCommands((prev) => ({ ...prev, [entry.id]: '' }));
      setAiStatus(null);
      showSuccess('KI-Version angepasst.');
    } else if (error) {
      setAiStatus(null);
      setFormError(error);
    }
  }

  async function handleGenerateSummary(entry: DiaryEntry) {
    setProcessingSummaryId(entry.id);
    setAiOperation(true);
    setAiStatus('Zusammenfassung und Personen werden neu generiert...');
    await Promise.race([sseReadyRef.current, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}/summarize`, {
      method: 'POST',
    });
    setWorking(false);
    setAiOperation(false);
    setProcessingSummaryId(null);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setAiStatus(null);
      showSuccess('Zusammenfassung erstellt.');
    } else if (error) {
      setFormError(error);
    }
  }

  async function handleAcceptRewritten(entry: DiaryEntry) {
    if (!entry.rewrittenFilePath || !entry.rewrittenContent) return;
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ensureHtml(entry.rewrittenContent), rewrittenContent: null }),
    });
    setWorking(false);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setViewRewritten(entry.id, false);
      showSuccess('Überarbeitung übernommen.');
    } else if (error) {
      setFormError(error);
    }
  }

  async function handleDiscardRewritten(entry: DiaryEntry) {
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rewrittenContent: null }),
    });
    setWorking(false);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setViewRewritten(entry.id, false);
    } else if (error) {
      setFormError(error);
    }
  }

  async function toggleExpanded(id: number) {
    const isExpanding = !expandedIds.has(id);
    if (isExpanding) {
      const entry = entries.find((e) => e.id === id);
      if (entry?.rewrittenFilePath && !entry.rewrittenContent) {
        const { data } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${id}`);
        if (data) {
          setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
        }
      }
    }
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setViewRewritten(id: number, showRewritten: boolean) {
    setViewingRewrittenIds((prev) => {
      const next = new Set(prev);
      if (showRewritten) next.add(id);
      else next.delete(id);
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
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: editingSummaryText.trim() || null }),
    });
    setWorking(false);

    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      showSuccess('Zusammenfassung aktualisiert.');
      cancelSummaryEdit();
    } else if (error) {
      // Fehler wird bereits durch useApi angezeigt.
    }
  }

  const modalActions = (
    <>
      <button
        type="button"
        onClick={closeModal}
        disabled={working}
        className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
      >
        Abbrechen
      </button>
      {editingId === null && aiEnabled === true && (
        <button
          type="button"
          onClick={handleCreateAndRewrite}
          disabled={working || !form.title.trim() || !stripHtml(form.content).trim()}
          className="px-4 py-2 rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition disabled:opacity-50"
        >
          KI umschreiben
        </button>
      )}
      <button
        type="submit"
        form="diary-form"
        disabled={working || !form.title.trim() || !stripHtml(form.content).trim()}
        className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition disabled:opacity-50"
      >
        {working ? <Loading text="" size="sm" /> : editingId !== null ? 'Speichern' : 'Erstellen'}
      </button>
    </>
  );

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      <DashboardHeader title="Notizen" onReset={handleResetLayout} />

      {aiStatus && (
        <div className="fixed bottom-4 right-4 bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3 shadow-lg z-50 max-w-md">
          {aiOperation ? (
            <Loading size="sm" text={aiStatus} />
          ) : (
            <p className="text-sm text-slate-400 break-words">{aiStatus}</p>
          )}
        </div>
      )}

      <DashboardLayout
        key={resetKey}
        storageKey="diary-layout-v2"
        defaultLayout={[{ i: 'diary', x: 0, y: 0, w: 12, h: 100, minW: 3, minH: 4 }]}
        className="flex-1 min-h-0"
        fitHeight
      >
        <div key="diary">
          <GridPanel
            title="Tagebuch"
            actions={
              <Button variant="accent" onClick={openCreate} className="text-xs px-2 py-1">
                Neuer Eintrag
              </Button>
            }
          >
            <div className="flex-1 min-h-0 overflow-auto -m-4 p-4">
              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="text-slate-400">Noch keine Tagebucheinträge vorhanden.</p>
                </div>
              ) : (
              <div className="space-y-4">
              {entries.map((entry) => (
                <article
                  key={entry.id}
                  className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <h3 className="text-lg font-semibold text-[var(--text-h)]">{entry.title}</h3>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Button variant="danger" onClick={() => handleDelete(entry.id)} disabled={working}>
                        Löschen
                      </Button>
                    </div>
                  </div>

                  <div className="mb-3 p-3 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-[var(--accent)]">Zusammenfassung</p>
                      {editingSummaryId !== entry.id && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            title="Zusammenfassung neu generieren"
                            onClick={() => handleGenerateSummary(entry)}
                            disabled={working}
                            className="text-[var(--accent)] hover:text-[var(--accent-dim)] transition disabled:opacity-50"
                          >
                            {processingSummaryId === entry.id ? (
                              <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                <path d="M21 4v6h-6" />
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            title="Zusammenfassung bearbeiten"
                            onClick={() => startSummaryEdit(entry)}
                            disabled={working}
                            className="text-[var(--accent)] hover:text-[var(--accent-dim)] transition disabled:opacity-50"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {editingSummaryId === entry.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingSummaryText}
                          onChange={(e) => setEditingSummaryText(e.target.value)}
                          rows={3}
                          maxLength={SUMMARY_MAX_LENGTH}
                          disabled={working}
                          className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
                        />
                        <div className="flex gap-2">
                          <Button variant="accent" onClick={() => saveSummaryEdit(entry)} disabled={working}>
                            Speichern
                          </Button>
                          <Button variant="ghost" onClick={cancelSummaryEdit} disabled={working}>
                            Abbrechen
                          </Button>
                        </div>
                      </div>
                    ) : entry.summary ? (
                      <p className="text-slate-300 text-sm whitespace-pre-wrap">{entry.summary}</p>
                    ) : (
                      <p className="text-slate-500 text-sm italic">Noch keine Zusammenfassung vorhanden.</p>
                    )}
                  </div>

                  <BadgeList items={entry.persons} variant="person" />
                  <BadgeList items={entry.organizations} variant="organization" />
                  <BadgeList items={entry.locations} variant="location" />

                  {expandedIds.has(entry.id) ? (
                    <>
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                        <div className="inline-flex rounded-lg bg-slate-800 p-1 border border-[var(--border)]">
                          <button
                            type="button"
                            onClick={() => setViewRewritten(entry.id, false)}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                              !viewingRewrittenIds.has(entry.id) || !entry.rewrittenFilePath
                                ? 'bg-[var(--accent)] text-slate-900'
                                : 'text-slate-300 hover:text-[var(--text-h)]'
                            }`}
                          >
                            Original
                          </button>
                          <button
                            type="button"
                            onClick={() => entry.rewrittenFilePath && setViewRewritten(entry.id, true)}
                            disabled={!entry.rewrittenFilePath || working}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                              viewingRewrittenIds.has(entry.id) && entry.rewrittenFilePath
                                ? 'bg-[var(--accent)] text-slate-900'
                                : 'text-slate-300 hover:text-[var(--text-h)]'
                            }`}
                          >
                            KI-Version
                          </button>
                        </div>
                        {aiEnabled && (
                          <Button
                            variant="secondary"
                            onClick={() => handleRewrite(entry)}
                            disabled={working || processingRewriteId === entry.id}
                            title={entry.rewrittenFilePath ? 'Weitere Verbesserung der KI-Version anfordern' : undefined}
                            icon={
                              processingRewriteId === entry.id ? (
                                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                        <Button
                          variant="secondary"
                          onClick={() => openEdit(entry)}
                          disabled={working}
                          icon={(
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          )}
                        >
                          Bearbeiten
                        </Button>
                      </div>

                      {viewingRewrittenIds.has(entry.id) && entry.rewrittenFilePath ? (
                        <div className="rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/30 p-4 mb-4">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <form
                              className="flex items-center gap-2 flex-1"
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
                            <div className="flex items-center gap-2">
                              <Button
                                variant="accent"
                                onClick={() => handleAcceptRewritten(entry)}
                                disabled={working || !entry.rewrittenContent}
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
                          {entry.rewrittenContent ? (
                            isHtml(entry.rewrittenContent) ? (
                              <div
                                className="text-slate-300 diary-content"
                                dangerouslySetInnerHTML={{ __html: entry.rewrittenContent }}
                              />
                            ) : (
                              <div className="text-slate-300 whitespace-pre-wrap">{entry.rewrittenContent}</div>
                            )
                          ) : (
                            <div className="text-slate-400 text-sm">KI-Version wird geladen...</div>
                          )}
                        </div>
                      ) : (
                        <div
                          className="text-slate-300 diary-content mb-4"
                          dangerouslySetInnerHTML={{ __html: entry.content }}
                        />
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
          </GridPanel>
        </div>
      </DashboardLayout>

      <Modal
        isOpen={isModalOpen}
        title={editingId !== null ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}
        onClose={closeModal}
        actions={modalActions}
        className="h-[85vh] flex flex-col"
        contentClassName="flex-1 min-h-0 overflow-hidden flex flex-col"
      >
        {formError && (
          <div className="mb-4 p-3 rounded bg-red-900/30 text-red-400 border border-red-700">
            {formError}
          </div>
        )}
        <form id="diary-form" onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Titel</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
              disabled={working}
              className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <label className="block text-sm text-slate-400 mb-1">Inhalt</label>
            <ReactQuill
              theme="snow"
              value={form.content}
              onChange={(value) => setForm((prev) => ({ ...prev, content: value }))}
              modules={quillModules}
              formats={quillFormats}
              readOnly={working}
              className="diary-editor bg-slate-900 text-[var(--text-h)] rounded border border-[var(--border)] flex-1 min-h-0"
            />
          </div>
        </form>

        {aiOperation && editingId === null && aiStatus && (
          <div className="mt-4">
            <Loading size="sm" text={aiStatus} />
          </div>
        )}
      </Modal>
    </div>
  );
}
