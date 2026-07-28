import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useError } from '../hooks/useError';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import ReactQuill from 'react-quill-new';
import type { DiaryEntry, EntityType, VersionInfo } from '../../shared/types';
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

function createTableHtml(rows: number, cols: number): string {
  let html = '<table><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += '<td><p><br></p></td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

const quillModules = {
  toolbar: {
    container: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ indent: '-1' }, { indent: '+1' }],
      ['blockquote', 'code-block'],
      ['link'],
      ['table'],
      ['clean'],
    ],
    handlers: {
      table: function (this: { quill: { getSelection: () => { index: number } | null; clipboard: { dangerouslyPasteHTML: (index: number, html: string) => void } } }) {
        const rowsInput = prompt('Anzahl Zeilen:', '2');
        const colsInput = prompt('Anzahl Spalten:', '2');
        const rows = parseInt(rowsInput || '0', 10);
        const cols = parseInt(colsInput || '0', 10);
        if (rows > 0 && cols > 0) {
          const range = this.quill.getSelection();
          const index = range ? range.index : 0;
          this.quill.clipboard.dangerouslyPasteHTML(index, createTableHtml(rows, cols));
        }
      },
    },
  },
};

const quillFormats = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'background',
  'align',
  'list',
  'bullet',
  'indent',
  'blockquote',
  'code-block',
  'link',
  'table',
];

interface BadgeListProps {
  items: string[];
  variant: 'person' | 'organization' | 'location';
}

const badgeStyles = {
  person: 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20',
  organization: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  location: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
};

const badgeTypeMap: Record<BadgeListProps['variant'], EntityType> = {
  person: 'persons',
  organization: 'organizations',
  location: 'locations',
};

function BadgeList({ items, variant }: BadgeListProps) {
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {items.map((item) => (
        <span
          key={item}
          onClick={() => navigate('/welt', { state: { selectedEntity: { name: item, type: badgeTypeMap[variant] } } })}
          title="In Welt öffnen"
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:brightness-110 transition ${badgeStyles[variant]}`}
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
  const [form, setForm] = useState<DiaryFormData>({ title: '', content: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingRewrittenIds, setViewingRewrittenIds] = useState<Set<number>>(new Set());
  const [draftOriginal, setDraftOriginal] = useState<Record<number, string>>({});
  const [draftRewritten, setDraftRewritten] = useState<Record<number, string>>({});
  const draftOriginalRef = useRef<Record<number, string>>({});
  const draftRewrittenRef = useRef<Record<number, string>>({});
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [editingSummaryId, setEditingSummaryId] = useState<number | null>(null);
  const [editingSummaryText, setEditingSummaryText] = useState('');
  const [processingSummaryId, setProcessingSummaryId] = useState<number | null>(null);
  const [processingRewriteId, setProcessingRewriteId] = useState<number | null>(null);
  const [processingCommandId, setProcessingCommandId] = useState<number | null>(null);
  const [rewriteCommands, setRewriteCommands] = useState<Record<number, string>>({});
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiOperation, setAiOperation] = useState(false);
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


  function resetForm() {
    setForm({ title: '', content: '' });
    setFormError(null);
  }

  function openCreate() {
    resetForm();
    setIsModalOpen(true);
  }

  function closeModal() {
    if (working) return;
    setIsModalOpen(false);
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const plainText = stripHtml(form.content).trim();
    if (!form.title.trim() || !plainText) {
      setFormError('Titel und Inhalt sind erforderlich');
      return;
    }

    const payload = {
      title: form.title,
      content: form.content,
    };

    setAiOperation(true);
    setAiStatus('Eintrag wird erstellt und analysiert...');
    await Promise.race([sseReadyRef.current, new Promise<void>((resolve) => setTimeout(resolve, 500))]);
    setWorking(true);

    let res;
    try {
      res = await request<{ entry: DiaryEntry }>('/api/diary/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } finally {
      setWorking(false);
      setAiOperation(false);
    }

    if (res.error) {
      setFormError(res.error);
      return;
    }

    if (res.data) {
      showSuccess('Eintrag erstellt.');
      setAiStatus(null);
      setEntries((prev) => [res.data!.entry, ...prev]);
    }

    closeModal();
    loadEntries();
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
      cancelEntryEdit(entry);
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
      cancelEntryEdit(entry);
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

  function getEditingContent(entry: DiaryEntry): string {
    if (viewingRewrittenIds.has(entry.id) && entry.rewrittenFilePath) {
      return draftRewritten[entry.id] ?? entry.rewrittenContent ?? '';
    }
    return draftOriginal[entry.id] ?? entry.content;
  }

  function setOriginalDraft(entryId: number, value: string) {
    draftOriginalRef.current[entryId] = value;
    setDraftOriginal((prev) => ({ ...prev, [entryId]: value }));
  }

  function setRewrittenDraft(entryId: number, value: string) {
    draftRewrittenRef.current[entryId] = value;
    setDraftRewritten((prev) => ({ ...prev, [entryId]: value }));
  }

  function hasDraft(entry: DiaryEntry): boolean {
    if (viewingRewrittenIds.has(entry.id) && entry.rewrittenFilePath) {
      return draftRewritten[entry.id] !== undefined && draftRewritten[entry.id] !== (entry.rewrittenContent ?? '');
    }
    return draftOriginal[entry.id] !== undefined && draftOriginal[entry.id] !== entry.content;
  }

  function cancelEntryEdit(entry: DiaryEntry) {
    delete draftOriginalRef.current[entry.id];
    delete draftRewrittenRef.current[entry.id];
    setDraftOriginal((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    setDraftRewritten((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
  }

  async function handleSaveOriginal(entry: DiaryEntry) {
    const content = draftOriginalRef.current[entry.id] ?? entry.content;
    if (content === entry.content) {
      cancelEntryEdit(entry);
      return;
    }
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ensureHtml(content) }),
    });
    setWorking(false);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      cancelEntryEdit(entry);
      showSuccess('Eintrag gespeichert.');
    } else if (error) {
      setFormError(error);
    }
  }

  async function handleAcceptRewritten(entry: DiaryEntry) {
    const content = draftRewrittenRef.current[entry.id] ?? entry.rewrittenContent;
    if (!entry.rewrittenFilePath || !content) return;
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ensureHtml(content), rewrittenContent: null }),
    });
    setWorking(false);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setViewRewritten(entry.id, false);
      cancelEntryEdit(entry);
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
      cancelEntryEdit(entry);
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

  function startTitleEdit(entry: DiaryEntry) {
    setEditingTitleId(entry.id);
    setEditingTitleText(entry.title);
  }

  function cancelTitleEdit() {
    setEditingTitleId(null);
    setEditingTitleText('');
  }

  async function saveTitleEdit(entry: DiaryEntry) {
    const title = editingTitleText.trim();
    if (!title || title === entry.title) {
      cancelTitleEdit();
      return;
    }

    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setWorking(false);

    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      showSuccess('Titel aktualisiert.');
      cancelTitleEdit();
    } else if (error) {
      setFormError(error);
    }
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
      <button
        type="submit"
        form="diary-form"
        disabled={working || !form.title.trim() || !stripHtml(form.content).trim()}
        className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition disabled:opacity-50"
      >
        {working ? <Loading text="" size="sm" /> : 'Erstellen'}
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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Tagebuch</h1>
        <Button variant="accent" onClick={openCreate} className="text-xs px-2 py-1">
          Neuer Eintrag
        </Button>
      </div>

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
              ) : (
              <div className="space-y-4">
              {entries.map((entry) => (
                <article
                  key={entry.id}
                  className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    {editingTitleId === entry.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={editingTitleText}
                          onChange={(e) => setEditingTitleText(e.target.value)}
                          disabled={working}
                          className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-lg font-semibold"
                        />
                        <Button variant="accent" onClick={() => saveTitleEdit(entry)} disabled={working || !editingTitleText.trim()}>
                          Speichern
                        </Button>
                        <Button variant="ghost" onClick={cancelTitleEdit} disabled={working}>
                          Abbrechen
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <h3 className="text-lg font-semibold text-[var(--text-h)]">{entry.title}</h3>
                        <button
                          type="button"
                          title="Titel bearbeiten"
                          onClick={() => startTitleEdit(entry)}
                          disabled={working}
                          className="text-slate-400 hover:text-[var(--accent)] transition disabled:opacity-50"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      </div>
                    )}
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
                        {entry.rewrittenFilePath ? (
                          <div className="inline-flex rounded-lg bg-slate-800 p-1 border border-[var(--border)]">
                            <button
                              type="button"
                              onClick={() => setViewRewritten(entry.id, false)}
                              className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                                !viewingRewrittenIds.has(entry.id)
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
                        </div>
                      </div>

                      {viewingRewrittenIds.has(entry.id) && entry.rewrittenFilePath ? (
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
                          <ReactQuill
                            theme="snow"
                            value={getEditingContent(entry)}
                            onChange={(value) => setRewrittenDraft(entry.id, value)}
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
                          <ReactQuill
                            theme="snow"
                            value={getEditingContent(entry)}
                            onChange={(value) => setOriginalDraft(entry.id, value)}
                            modules={quillModules}
                            formats={quillFormats}
                            readOnly={working}
                            className="diary-editor bg-slate-900 text-[var(--text-h)] rounded border border-[var(--border)] mb-2"
                          />
                          {hasDraft(entry) && (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="accent"
                                onClick={() => handleSaveOriginal(entry)}
                                disabled={working || !stripHtml(getEditingContent(entry)).trim()}
                              >
                                Speichern
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => cancelEntryEdit(entry)}
                                disabled={working}
                              >
                                Abbrechen
                              </Button>
                            </div>
                          )}
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

      <Modal
        isOpen={isModalOpen}
        title="Neuer Eintrag"
        onClose={closeModal}
        actions={modalActions}
        className="h-[85vh] flex flex-col max-w-5xl"
        contentClassName="flex-1 min-h-0 overflow-hidden flex flex-col"
      >
        {formError && (
          <div className="mb-4 p-3 rounded bg-red-900/30 text-red-400 border border-red-700">
            {formError}
          </div>
        )}
        <form id="diary-form" onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col space-y-4 px-1">
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

        {aiOperation && aiStatus && (
          <div className="mt-4">
            <Loading size="sm" text={aiStatus} />
          </div>
        )}
      </Modal>
    </div>
  );
}
