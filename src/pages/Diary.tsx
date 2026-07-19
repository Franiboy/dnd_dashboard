import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useError } from '../hooks/useError';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import ReactQuill from 'react-quill-new';
import type { DiaryEntry, VersionInfo } from '../../shared/types';
import 'react-quill-new/dist/quill.snow.css';

interface DiaryFormData {
  title: string;
  content: string;
}

function getDayFromCreatedAt(createdAt: string): string {
  return createdAt.slice(0, 10);
}

function formatDateLabel(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function groupByDay(entries: DiaryEntry[]): Record<string, DiaryEntry[]> {
  const groups: Record<string, DiaryEntry[]> = {};
  for (const entry of entries) {
    const day = getDayFromCreatedAt(entry.createdAt);
    if (!groups[day]) groups[day] = [];
    groups[day].push(entry);
  }
  return groups;
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

const MAX_HEIGHT = 192;

function stripHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

export function Diary() {
  const { request } = useApi();
  const { showSuccess } = useError();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<DiaryFormData>({ title: '', content: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<Set<number>>(new Set());
  const [expandedRewritten, setExpandedRewritten] = useState<Set<number>>(new Set());
  const [needsExpandContent, setNeedsExpandContent] = useState<Set<number>>(new Set());
  const [needsExpandRewritten, setNeedsExpandRewritten] = useState<Set<number>>(new Set());
  const contentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rewrittenRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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
    const contentSet = new Set<number>();
    const rewrittenSet = new Set<number>();
    contentRefs.current.forEach((el: HTMLDivElement, id: number) => {
      if (el.scrollHeight > MAX_HEIGHT) contentSet.add(id);
    });
    rewrittenRefs.current.forEach((el: HTMLDivElement, id: number) => {
      if (el.scrollHeight > MAX_HEIGHT) rewrittenSet.add(id);
    });
    setNeedsExpandContent(contentSet);
    setNeedsExpandRewritten(rewrittenSet);
  }, [entries, expandedContent, expandedRewritten]);

  const grouped = useMemo(() => groupByDay(entries), [entries]);
  const sortedDays = useMemo(() => Object.keys(grouped).sort().reverse(), [grouped]);

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

  function toggleContent(id: number) {
    setExpandedContent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRewritten(id: number) {
    setExpandedRewritten((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

    setWorking(true);

    let res;
    if (editingId !== null) {
      res = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } else {
      res = await request<{ entry: DiaryEntry }>('/api/diary/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    }

    setWorking(false);

    if (res.error) {
      setFormError(res.error);
      return;
    }

    if (res.data) {
      showSuccess(editingId !== null ? 'Eintrag aktualisiert.' : 'Eintrag erstellt.');
      setEntries((prev) => {
        if (editingId !== null) {
          return prev.map((e) => (e.id === editingId ? res.data!.entry : e));
        }
        return [res.data!.entry, ...prev];
      });
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
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}/rewrite`, {
      method: 'POST',
    });
    setWorking(false);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      showSuccess('KI-Version erstellt.');
    } else if (error) {
      setFormError(error);
    }
  }

  async function handleAcceptRewritten(entry: DiaryEntry) {
    if (!entry.rewrittenContent) return;
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: entry.rewrittenContent, rewrittenContent: null }),
    });
    setWorking(false);
    if (data) {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
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
    } else if (error) {
      setFormError(error);
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
        disabled={working || !form.title.trim() || !form.content.replace(/<[^>]+>/g, '').trim()}
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
    <div className="min-h-full p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Tagebuch</h1>
        <Button variant="accent" onClick={openCreate}>
          Neuer Eintrag
        </Button>
      </div>

      {entries.length === 0 && (
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 text-center">
          <p className="text-slate-400">Noch keine Tagebucheinträge vorhanden.</p>
        </div>
      )}

      <div className="space-y-8">
        {sortedDays.map((day) => (
          <section key={day}>
            <h2 className="text-xl font-semibold text-[var(--text-h)] mb-3 sticky top-0 bg-[var(--bg)]/90 backdrop-blur py-2 z-10">
              {formatDateLabel(day)}
            </h2>
            <div className="space-y-4">
              {grouped[day].map((entry) => (
                <article
                  key={entry.id}
                  className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <h3 className="text-lg font-semibold text-[var(--text-h)]">{entry.title}</h3>
                    <div className="flex flex-wrap gap-2 justify-end">
                      {aiEnabled && (
                        <Button
                          variant="secondary"
                          onClick={() => handleRewrite(entry)}
                          disabled={working}
                        >
                          KI umschreiben
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
                      <Button variant="danger" onClick={() => handleDelete(entry.id)} disabled={working}>
                        Löschen
                      </Button>
                    </div>
                  </div>

                  <div
                    ref={(el) => { if (el) contentRefs.current.set(entry.id, el); }}
                    className={`text-slate-300 diary-content mb-4 ${expandedContent.has(entry.id) ? '' : 'max-h-48 overflow-hidden'}`}
                    dangerouslySetInnerHTML={{ __html: entry.content }}
                  />
                  {needsExpandContent.has(entry.id) && (
                    <button
                      type="button"
                      onClick={() => toggleContent(entry.id)}
                      className="text-sm text-[var(--accent)] hover:underline mb-4"
                    >
                      {expandedContent.has(entry.id) ? 'Weniger anzeigen' : 'Mehr anzeigen'}
                    </button>
                  )}

                  {entry.rewrittenContent && (
                    <div className="rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/30 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-[var(--accent)]">KI-Version</span>
                        <div className="flex gap-2">
                          <Button
                            variant="accent"
                            onClick={() => handleAcceptRewritten(entry)}
                            disabled={working}
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
                      <div
                        ref={(el) => { if (el) rewrittenRefs.current.set(entry.id, el); }}
                        className={`text-slate-300 whitespace-pre-wrap ${expandedRewritten.has(entry.id) ? '' : 'max-h-48 overflow-hidden'}`}
                      >
                        {entry.rewrittenContent}
                      </div>
                      {needsExpandRewritten.has(entry.id) && (
                        <button
                          type="button"
                          onClick={() => toggleRewritten(entry.id)}
                          className="text-sm text-[var(--accent)] hover:underline mt-2"
                        >
                          {expandedRewritten.has(entry.id) ? 'Weniger anzeigen' : 'Mehr anzeigen'}
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Modal isOpen={isModalOpen} title={editingId !== null ? 'Eintrag bearbeiten' : 'Neuer Eintrag'} onClose={closeModal} actions={modalActions}>
        {formError && (
          <div className="mb-4 p-3 rounded bg-red-900/30 text-red-400 border border-red-700">
            {formError}
          </div>
        )}
        <form id="diary-form" onSubmit={handleSubmit} className="space-y-4">
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
          <div>
            <label className="block text-sm text-slate-400 mb-1">Inhalt</label>
            <ReactQuill
              theme="snow"
              value={form.content}
              onChange={(value) => setForm((prev) => ({ ...prev, content: value }))}
              modules={quillModules}
              formats={quillFormats}
              readOnly={working}
              className="bg-slate-900 text-[var(--text-h)] rounded border border-[var(--border)]"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
