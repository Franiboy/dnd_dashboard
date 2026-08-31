import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { useEntityMappings } from '../hooks/useEntityMappings';
import { useError } from '../hooks/useError';
import { EntityRichText } from '../components/EntityRichText';
import { applyEntityHighlights } from '../components/EntityQuillBlot';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import { SideDrawer, SideDrawerItem } from '../components/SideDrawer';
import ReactQuill from 'react-quill-new';
import type Quill from 'quill';
import { ensureHtml, quillFormats, quillModules, stripHtml } from '../components/quillConfig';
import { splitEntityLabel } from '../lib/entityLabels';
import type { CampaignDay, DiaryEntry, EntityType, VersionInfo } from '../../shared/types';
import 'react-quill-new/dist/quill.snow.css';

const SUMMARY_MAX_LENGTH = 500;
const SERVER_SAVE_DELAY_MS = 1500;

const DRAFT_KEY_PREFIX = 'diary-draft-';

interface DiaryFormData {
  content: string;
}

function normalizeDraftHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const span of Array.from(doc.querySelectorAll('span.ql-entity'))) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
  const textNodes: CharacterData[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as CharacterData);
  }
  for (const node of textNodes) {
    node.data = node.data.replace(/[\p{Zs}]/gu, ' ');
  }
  return doc.body.innerHTML.trim();
}

function isEmptyHtml(html: string): boolean {
  return !stripHtml(html).trim();
}

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
  const draftKeyPrefix = user?.id ? `${DRAFT_KEY_PREFIX}${user.id}-` : DRAFT_KEY_PREFIX;
  const getDraftKey = (entryId: number, kind: 'original' | 'rewritten') =>
    `${draftKeyPrefix}${entryId}-${kind}`;
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const entriesRef = useRef(entries);
  const entryRefs = useRef<Record<number, HTMLElement>>({});
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<DiaryFormData>({ content: '' });
  const [formError, setFormError] = useState<string | null>(null);
  // Manual diary creation picks an in-game day (campaign timeline) instead of a
  // free title.
  const [campaignDays, setCampaignDays] = useState<CampaignDay[]>([]);
  const [createDayMode, setCreateDayMode] = useState<'existing' | 'new'>('existing');
  const [createDayValue, setCreateDayValue] = useState<number | ''>('');
  const [createDayLabel, setCreateDayLabel] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [viewingRewrittenIds, setViewingRewrittenIds] = useState<Set<number>>(new Set());
  const [draftOriginal, setDraftOriginal] = useState<
    Record<number, { raw: string; normalized: string }>
  >({});
  const [draftRewritten, setDraftRewritten] = useState<
    Record<number, { raw: string; normalized: string }>
  >({});
  const quillRefs = useRef<Record<number, ReactQuill>>({});
  const highlightTimeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const autoSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const serverSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const draftRawRefs = useRef<{
    original: Record<number, string>;
    rewritten: Record<number, string>;
  }>({
    original: {},
    rewritten: {},
  });
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [editingSummaryId, setEditingSummaryId] = useState<number | null>(null);
  const [editingSummaryText, setEditingSummaryText] = useState('');
  const [gameDayDrafts, setGameDayDrafts] = useState<
    Record<number, { day: number | null; label: string | null }>
  >({});
  const [processingSummaryId, setProcessingSummaryId] = useState<number | null>(null);
  const [processingRewriteId, setProcessingRewriteId] = useState<number | null>(null);
  const [processingCommandId, setProcessingCommandId] = useState<number | null>(null);
  const [rewriteCommands, setRewriteCommands] = useState<Record<number, string>>({});
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiOperation, setAiOperation] = useState(false);
  const sseReadyRef = useRef(Promise.resolve());

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

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
  }, [draftKeyPrefix]);

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
    const entryIdParam = searchParams.get('entry');
    if (!entryIdParam || entries.length === 0) return;
    const entryId = Number(entryIdParam);
    if (!Number.isFinite(entryId)) return;

    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    setExpandedIds((prev) => new Set(prev).add(entryId));
    if (entry.rewrittenContent || entry.rewrittenFilePath) {
      setViewingRewrittenIds((prev) => new Set(prev).add(entryId));
    }

    const timer = setTimeout(() => {
      const element = entryRefs.current[entryId];
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        element.classList.add('ring-2', 'ring-[var(--accent)]');
        setTimeout(() => element.classList.remove('ring-2', 'ring-[var(--accent)]'), 2000);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchParams, loading, entries]);

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
  }, [mappings, expandedIds]);

  function resetForm() {
    setForm({ content: '' });
    setFormError(null);
    setCreateDayMode('existing');
    setCreateDayValue('');
    setCreateDayLabel('');
  }

  async function openCreate() {
    resetForm();
    setIsModalOpen(true);
    const { data } = await request<{
      days: CampaignDay[];
      currentGameDay: number | null;
      nextGameDay: number;
    }>('/api/campaign/days');
    if (data) setCampaignDays(data.days);
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
    const contentOk = !!plainText;
    const dayOk =
      createDayMode === 'existing' ? createDayValue !== '' && Number(createDayValue) > 0 : true;
    if (!contentOk || !dayOk) {
      setFormError('Wähle einen Spieltag und erfülle den Inhalt');
      return;
    }

    let gameDay: number | null;
    let gameDateLabel: string | null = null;
    if (createDayMode === 'new') {
      // Register the next free day (and optional label) on the campaign timeline.
      const label = createDayLabel.trim();
      const { data: dayData, error: dayError } = await request<{
        day: CampaignDay;
        currentGameDay: number | null;
      }>('/api/campaign/days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label || null }),
      });
      if (dayError || !dayData) {
        setFormError(dayError ?? 'Spieltag konnte nicht angelegt werden');
        return;
      }
      gameDay = dayData.day.day;
      gameDateLabel = dayData.day.label;
    } else {
      gameDay = Number(createDayValue);
      const chosenLabel =
        createDayValue !== ''
          ? (campaignDays.find((d) => d.day === Number(createDayValue))?.label ?? null)
          : null;
      gameDateLabel = chosenLabel;
    }

    const payload = {
      content: form.content,
      gameDay,
      gameDateLabel,
    };

    setAiOperation(true);
    setAiStatus('Eintrag wird erstellt und analysiert...');
    await Promise.race([
      sseReadyRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
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
      localStorage.removeItem(getDraftKey(id, 'original'));
      localStorage.removeItem(getDraftKey(id, 'rewritten'));
      delete draftRawRefs.current.original[id];
      delete draftRawRefs.current.rewritten[id];
      showSuccess('Eintrag gelöscht.');
    }
  }

  async function handleRewrite(entry: DiaryEntry) {
    setProcessingRewriteId(entry.id);
    setAiOperation(true);
    setAiStatus('Text wird von KI umgeschrieben...');
    await Promise.race([
      sseReadyRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(
      `/api/diary/entries/${entry.id}/rewrite`,
      {
        method: 'POST',
      }
    );
    setWorking(false);
    setAiOperation(false);
    setProcessingRewriteId(null);
    if (data) {
      cancelEntryEdit(entry, 'rewritten');
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
    await Promise.race([
      sseReadyRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(
      `/api/diary/entries/${entry.id}/rewrite-command`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command.trim() }),
      }
    );
    setWorking(false);
    setAiOperation(false);
    setProcessingCommandId(null);
    if (data) {
      cancelEntryEdit(entry, 'rewritten');
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
    await Promise.race([
      sseReadyRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    setWorking(true);
    const { data, error } = await request<{ entry: DiaryEntry }>(
      `/api/diary/entries/${entry.id}/summarize`,
      {
        method: 'POST',
      }
    );
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
      const raw =
        draftRewritten[entry.id]?.raw ?? localStorage.getItem(getDraftKey(entry.id, 'rewritten'));
      return raw ?? entry.rewrittenContent ?? '';
    }
    const raw =
      draftOriginal[entry.id]?.raw ?? localStorage.getItem(getDraftKey(entry.id, 'original'));
    return raw ?? entry.content;
  }

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
    }, 500);
  }

  function handleQuillChange(
    entry: DiaryEntry,
    value: string,
    source: string,
    kind: 'original' | 'rewritten'
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
      const reactQuill = quillRefs.current[entry.id];
      const quill = reactQuill?.getEditor();
      if (quill) scheduleEntityHighlights(quill, entry.id);
    }
  }

  function scheduleEntityHighlights(quill: Quill, entryId: number) {
    const existing = highlightTimeouts.current[entryId];
    if (existing) clearTimeout(existing);
    highlightTimeouts.current[entryId] = setTimeout(() => {
      applyEntityHighlights(quill, mappings);
      delete highlightTimeouts.current[entryId];
    }, 300);
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
      saveOriginalToServer(entry, raw, false);
    }, SERVER_SAVE_DELAY_MS);
  }

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

  async function saveGameDay(
    entryId: number,
    gameDay: number | null,
    gameDateLabel: string | null
  ) {
    const { data, error } = await request<{ entry: DiaryEntry }>(`/api/diary/entries/${entryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameDay, gameDateLabel }),
    });
    if (error) {
      showError(error);
      return;
    }
    if (data?.entry) {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry : e)));
      showSuccess('Spieltag gespeichert.');
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
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setViewRewritten(entry.id, false);
      cancelEntryEdit(entry);
      setTimeout(() => {
        const reactQuill = quillRefs.current[entry.id];
        const quill = reactQuill?.getEditor();
        if (quill) applyEntityHighlights(quill, mappings);
      }, 50);
      showSuccess('Überarbeitung übernommen.');
    } else if (error) {
      setFormError(error);
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
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? data.entry : e)));
      setViewRewritten(entry.id, false);
      cancelEntryEdit(entry, 'rewritten');
      setTimeout(() => {
        const reactQuill = quillRefs.current[entry.id];
        const quill = reactQuill?.getEditor();
        if (quill) applyEntityHighlights(quill, mappings);
      }, 50);
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
      const currentEntry = entries.find((e) => e.id === id);
      if (currentEntry?.sessionDraftFor) {
        setViewRewritten(id, true);
      }
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
    } else {
      const entry = entries.find((e) => e.id === id);
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
      // Error is already displayed by useApi.
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
        disabled={
          working ||
          !stripHtml(form.content).trim() ||
          (createDayMode === 'existing' && !(createDayValue !== '' && Number(createDayValue) > 0))
        }
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
              onClick={openCreate}
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
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => (
              <article
                key={entry.id}
                ref={(el) => {
                  if (el) entryRefs.current[entry.id] = el;
                }}
                className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 transition"
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
                      <Button
                        variant="accent"
                        onClick={() => saveTitleEdit(entry)}
                        disabled={working || !editingTitleText.trim()}
                      >
                        Speichern
                      </Button>
                      <Button variant="ghost" onClick={cancelTitleEdit} disabled={working}>
                        Abbrechen
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 flex-wrap">
                      <h3 className="text-lg font-semibold text-[var(--text-h)]">{entry.title}</h3>
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
                      <button
                        type="button"
                        title="Titel bearbeiten"
                        onClick={() => startTitleEdit(entry)}
                        disabled={working}
                        className="text-slate-400 hover:text-[var(--accent)] transition disabled:opacity-50"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs mt-1">
                    <label className="text-slate-400">Spieltag</label>
                    <input
                      type="number"
                      min={1}
                      value={gameDayDrafts[entry.id]?.day ?? entry.gameDay ?? ''}
                      onChange={(e) =>
                        setGameDayDrafts((prev) => ({
                          ...prev,
                          [entry.id]: {
                            day: e.target.value === '' ? null : Number(e.target.value),
                            label: prev[entry.id]?.label ?? entry.gameDateLabel ?? '',
                          },
                        }))
                      }
                      placeholder="–"
                      className="w-20 px-2 py-1 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={gameDayDrafts[entry.id]?.label ?? entry.gameDateLabel ?? ''}
                      onChange={(e) =>
                        setGameDayDrafts((prev) => ({
                          ...prev,
                          [entry.id]: {
                            day: prev[entry.id]?.day ?? entry.gameDay,
                            label: e.target.value,
                          },
                        }))
                      }
                      placeholder="Datum/Label (optional)"
                      className="w-48 px-2 py-1 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        saveGameDay(
                          entry.id,
                          gameDayDrafts[entry.id]?.day ?? entry.gameDay,
                          (gameDayDrafts[entry.id]?.label ?? entry.gameDateLabel ?? '') as
                            string | null
                        )
                      }
                      disabled={working}
                      className="px-2 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition disabled:opacity-50"
                    >
                      Speichern
                    </button>
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

                <div
                  className={`mb-3 p-3 rounded-lg border ${entry.aiDirty ? 'bg-amber-900/20 border-amber-500/30' : 'bg-[var(--accent)]/10 border-[var(--accent)]/20'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p
                      className={`text-sm font-semibold ${entry.aiDirty ? 'text-amber-500' : 'text-[var(--accent)]'}`}
                    >
                      Zusammenfassung
                    </p>
                    {editingSummaryId !== entry.id && (
                      <div className="flex items-center gap-2">
                        {entry.aiDirty || !entry.summary ? (
                          <button
                            type="button"
                            title="Zusammenfassung aktualisieren"
                            onClick={() => handleGenerateSummary(entry)}
                            disabled={working || processingSummaryId === entry.id}
                            className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition disabled:opacity-50"
                          >
                            {processingSummaryId === entry.id
                              ? 'Wird generiert...'
                              : entry.summary
                                ? 'Aktualisieren'
                                : 'Generieren'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Zusammenfassung neu generieren"
                            onClick={() => handleGenerateSummary(entry)}
                            disabled={working}
                            className="text-[var(--accent)] hover:text-[var(--accent-dim)] transition disabled:opacity-50"
                          >
                            {processingSummaryId === entry.id ? (
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
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          title="Zusammenfassung bearbeiten"
                          onClick={() => startSummaryEdit(entry)}
                          disabled={working}
                          className="text-[var(--accent)] hover:text-[var(--accent-dim)] transition disabled:opacity-50"
                        >
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
                        <Button
                          variant="accent"
                          onClick={() => saveSummaryEdit(entry)}
                          disabled={working}
                        >
                          Speichern
                        </Button>
                        <Button variant="ghost" onClick={cancelSummaryEdit} disabled={working}>
                          Abbrechen
                        </Button>
                      </div>
                    </div>
                  ) : entry.summary ? (
                    <div className="space-y-1">
                      <p className="text-slate-300 text-sm whitespace-pre-wrap">
                        <EntityRichText
                          content={entry.summary}
                          mappings={mappings}
                          isHtml={false}
                        />
                      </p>
                      {entry.aiDirty && (
                        <p className="text-xs text-amber-500 italic">
                          Zusammenfassung ist veraltet und sollte aktualisiert werden.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm italic">
                      Noch keine Zusammenfassung vorhanden.
                    </p>
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
                          ref={(el) => {
                            if (el) quillRefs.current[entry.id] = el;
                          }}
                          theme="snow"
                          value={getEditingContent(entry)}
                          onChange={(value, _delta, source) =>
                            handleQuillChange(entry, value, source, 'rewritten')
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
                        <ReactQuill
                          ref={(el) => {
                            if (el) quillRefs.current[entry.id] = el;
                          }}
                          theme="snow"
                          value={getEditingContent(entry)}
                          onChange={(value, _delta, source) =>
                            handleQuillChange(entry, value, source, 'original')
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
        <form
          id="diary-form"
          onSubmit={handleSubmit}
          className="flex-1 min-h-0 flex flex-col space-y-4 px-1"
        >
          <div>
            <label className="block text-sm text-slate-400 mb-1">Spieltag</label>
            {createDayMode === 'existing' ? (
              <div className="flex gap-2">
                <select
                  value={createDayValue}
                  onChange={(e) =>
                    setCreateDayValue(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  disabled={working}
                  required
                  className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">Spieltag wählen…</option>
                  {campaignDays.map((d) => (
                    <option key={d.day} value={d.day}>
                      Spieltag {d.day}
                      {d.label ? ` – ${d.label}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setCreateDayMode('new')}
                  disabled={working}
                  className="px-3 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50 whitespace-nowrap"
                  title="Neuen (nächsten) Spieltag anlegen"
                >
                  + Neuer Tag
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={createDayLabel}
                  onChange={(e) => setCreateDayLabel(e.target.value)}
                  disabled={working}
                  placeholder="Label (optional), z. B. Festtag des Monden"
                  className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => setCreateDayMode('existing')}
                  disabled={working}
                  className="px-3 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50 whitespace-nowrap"
                >
                  Zurück
                </button>
              </div>
            )}
            {createDayMode === 'new' && (
              <p className="mt-1 text-xs text-slate-500">
                Erstellt den nächsten freien Spieltag und setzt ihn als Titel dieses Eintrags.
              </p>
            )}
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
