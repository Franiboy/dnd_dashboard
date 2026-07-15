import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { ConfirmDialog } from './ConfirmDialog';
import Convert from 'ansi-to-html';
import type { FeatureRequest, LogEntry, SafeUser, VersionInfo } from '../../shared/types';

interface FeatureRequestsProps {
  currentUser?: SafeUser;
  featureRequestId?: number;
  compact?: boolean;
}

export function FeatureRequests({ currentUser, featureRequestId, compact }: FeatureRequestsProps) {
  const { request } = useApi();
  const isAdmin = !!currentUser?.isAdmin;
  const ansiConvert = useRef(new Convert({ escapeXML: true })).current;
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [continuePrompts, setContinuePrompts] = useState<Record<number, string>>({});
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [loadingAction, setLoadingAction] = useState<{ id: number; type: 'merge' | 'mergeFromMain' | 'continue' | 'delete' } | null>(null);
  const [logFilter, setLogFilter] = useState<Record<number, 'all' | 'ki' | 'changes' | 'system'>>();
  const logsRefs = useRef<Map<number, HTMLPreElement>>(new Map());

  const isLoading = (id: number, type: 'merge' | 'mergeFromMain' | 'continue' | 'delete') =>
    loadingAction?.id === id && loadingAction?.type === type;

  function filterLogs(entries: LogEntry[], filter: 'all' | 'ki' | 'changes' | 'system'): LogEntry[] {
    switch (filter) {
      case 'ki':
        return entries.filter((e) => e.type === 'prompt' || e.type === 'ai');
      case 'changes':
        return entries.filter((e) => e.type === 'diff');
      case 'system':
        return entries.filter((e) => e.type === 'system' || e.type === 'build' || e.type === 'error');
      default:
        return entries;
    }
  }

  useEffect(() => {
    requests.forEach((req) => {
      const pre = logsRefs.current.get(req.id);
      if (!pre) return;
      pre.scrollTop = pre.scrollHeight;
    });
  }, [requests]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: reqError } = await request<{ requests: FeatureRequest[] }>(
      '/api/ai/feature-requests',
      undefined,
      false,
    );
    if (data) {
      setRequests(data.requests || []);
      setError(null);
    } else if (reqError) {
      setError(reqError);
    }
    setLoading(false);
  }, [request]);

  useEffect(() => {
    let isMounted = true;
    let source: EventSource | null = null;

    async function init() {
      const { data: version } = await request<VersionInfo>('/api/version', undefined, false);
      if (!isMounted) return;

      if (!version?.aiEnabled) {
        setAiEnabled(false);
        setLoading(false);
        return;
      }

      setAiEnabled(true);
      await load();

      source = new EventSource('/api/ai/feature-requests/events', { withCredentials: true });
      source.addEventListener('requests', (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && Array.isArray(data.requests) && isMounted) {
            setRequests(data.requests);
            setError(null);
          }
        } catch {
          // ignore parse errors
        }
      });
      source.addEventListener('error', () => {
        // Connection errors are handled silently; the browser reconnects automatically
      });
    }

    init();
    return () => {
      isMounted = false;
      if (source) source.close();
    };
  }, [request, load]);

  async function handleMerge(id: number) {
    setLoadingAction({ id, type: 'merge' });
    const { error: reqError } = await request(
      `/api/ai/feature-requests/${id}/merge`,
      { method: 'POST' },
      false,
    );
    setLoadingAction(null);
    if (reqError) {
      setError(reqError);
    } else {
      load();
    }
  }

  async function handleMergeFromMain(id: number) {
    setLoadingAction({ id, type: 'mergeFromMain' });
    const { error: reqError } = await request(
      `/api/ai/feature-requests/${id}/merge-from-main`,
      { method: 'POST' },
      false,
    );
    setLoadingAction(null);
    if (reqError) {
      setError(reqError);
    } else {
      load();
    }
  }

  async function handleDeleteConfirm(id: number) {
    setDeleteId(null);
    setLoadingAction({ id, type: 'delete' });
    const { error: reqError } = await request(
      `/api/ai/feature-requests/${id}`,
      { method: 'DELETE' },
      false,
    );
    setLoadingAction(null);
    if (reqError) {
      setError(reqError);
    } else {
      load();
    }
  }

  async function handleContinue(id: number) {
    const prompt = continuePrompts[id] || '';
    setLoadingAction({ id, type: 'continue' });
    const { error: reqError } = await request(
      `/api/ai/feature-requests/${id}/continue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      },
      false,
    );
    setLoadingAction(null);
    if (reqError) {
      setError(reqError);
    } else {
      setContinuePrompts((prev) => ({ ...prev, [id]: '' }));
      load();
    }
  }

  function statusLabel(status: FeatureRequest['status']) {
    switch (status) {
      case 'pending':
        return 'Wartend';
      case 'running':
        return 'KI arbeitet...';
      case 'preview_ready':
        return 'Vorschau bereit';
      case 'failed':
        return 'Fehler';
      case 'merged':
        return 'Gemergt';
      default:
        return status;
    }
  }

  const canContinue = isAdmin || !!currentUser?.canAccessPreviews;

  const displayRequests = featureRequestId
    ? requests.filter((r) => r.id === featureRequestId)
    : requests;

  function renderTerminal(req: FeatureRequest, isCompact = false) {
    if (req.logs.length === 0 && (!canContinue || req.status === 'running')) {
      return null;
    }
    return (
      <details className="mt-2" open>
        <summary className="text-xs text-slate-500 cursor-pointer">Terminal</summary>
        <div className="mt-2 rounded border border-[var(--border)] bg-black/30 overflow-hidden">
          <div className="flex gap-1 p-2 border-b border-[var(--border)] bg-[var(--panel)]">
            {(['all', 'ki', 'changes', 'system'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setLogFilter((prev) => ({ ...prev, [req.id]: filter }))}
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  (logFilter?.[req.id] || 'all') === filter
                    ? 'bg-[var(--accent)] text-slate-900'
                    : 'bg-slate-700 text-[var(--text-h)] hover:bg-slate-600'
                }`}
              >
                {filter === 'all' ? 'Alle' : filter === 'ki' ? 'KI' : filter === 'changes' ? 'Änderungen' : 'System'}
              </button>
            ))}
          </div>
          <pre
            ref={(el) => { if (el) logsRefs.current.set(req.id, el); }}
            className={`p-2 text-xs text-slate-300 overflow-auto whitespace-pre-wrap ${isCompact ? 'h-full max-h-full' : 'max-h-96'}`}
          >
            {filterLogs(req.logs, logFilter?.[req.id] || 'all').map((entry, idx) => (
              <span
                key={idx}
                dangerouslySetInnerHTML={{
                  __html: ansiConvert.toHtml(entry.text),
                }}
              />
            ))}
          </pre>
          {canContinue && (req.sessionId || req.sessionTitle) && req.status !== 'running' && (
            <div className="flex gap-2 p-2 border-t border-[var(--border)] bg-[var(--panel)]">
              <input
                type="text"
                value={continuePrompts[req.id] || ''}
                onChange={(e) =>
                  setContinuePrompts((prev) => ({ ...prev, [req.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && continuePrompts[req.id]?.trim()) {
                    handleContinue(req.id);
                  }
                }}
                placeholder="Prompt eingeben..."
                className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-black/20 text-sm text-[var(--text-h)]"
              />
              <button
                onClick={() => handleContinue(req.id)}
                disabled={isLoading(req.id, 'continue') || !continuePrompts[req.id]?.trim()}
                className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-sm disabled:opacity-50"
              >
                {isLoading(req.id, 'continue') ? 'Wird fortgesetzt...' : 'Fortsetzen'}
              </button>
            </div>
          )}
        </div>
      </details>
    );
  }

  if (aiEnabled === null || loading) {
    return <div className="text-slate-400">Lade KI-Feature-Requests...</div>;
  }

  if (!aiEnabled) {
    return (
      <div className="text-slate-400">
        KI-Feature-Requests sind nicht aktiviert (AI_PROVIDER/AI_MODEL in .env fehlen).
      </div>
    );
  }

  if (compact) {
    const req = displayRequests[0];
    if (!req) return <div className="text-slate-400">Kein Feature-Request vorhanden.</div>;
    return (
      <div className="h-full flex flex-col">
        <div className="text-sm font-semibold text-[var(--text-h)] mb-2">{req.title}</div>
        <div className="flex-1 overflow-auto">
          {renderTerminal(req, true)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-[var(--text-h)]">KI-Feature-Requests</h2>
      {error && <div className="p-3 rounded bg-red-900/30 text-red-400 border border-red-700">{error}</div>}
      {displayRequests.length === 0 && <p className="text-slate-400">Keine Feature-Requests vorhanden.</p>}
      {displayRequests.map((req) => (
        <div key={req.id} className="p-4 rounded border border-[var(--border)] bg-[var(--panel)]">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-[var(--text-h)]">#{req.id} {req.title}</h3>
              <p className="text-slate-400 text-sm">{req.description}</p>
              <p className="text-slate-500 text-xs mt-1">Status: {statusLabel(req.status)}</p>
              {req.sessionId && (
                <p className="text-slate-500 text-xs">Session: {req.sessionId}</p>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              {isAdmin && req.status === 'preview_ready' && (
                <button
                  onClick={() => handleMerge(req.id)}
                  disabled={isLoading(req.id, 'merge') || !!req.behind}
                  title={req.behind ? 'Bitte zuerst Main reinmergen' : undefined}
                  className="px-3 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold text-sm disabled:opacity-50"
                >
                  {isLoading(req.id, 'merge') ? 'Wird akzeptiert...' : 'Akzeptieren'}
                </button>
              )}
              {req.status === 'preview_ready' && !!req.behind && (
                <button
                  onClick={() => handleMergeFromMain(req.id)}
                  disabled={isLoading(req.id, 'mergeFromMain')}
                  className="px-3 py-1 rounded bg-[var(--warning)] text-slate-900 font-semibold text-sm disabled:opacity-50"
                  title={`${req.behind} Commit(s) hinter main`}
                >
                  {isLoading(req.id, 'mergeFromMain') ? 'Wird aktualisiert...' : `Feature updaten (${req.behind})`}
                </button>
              )}

              {isAdmin && (
                <button
                  onClick={() => setDeleteId(req.id)}
                  disabled={isLoading(req.id, 'delete')}
                  className="px-3 py-1 rounded bg-[var(--danger)] text-white text-sm disabled:opacity-50"
                >
                  {isLoading(req.id, 'delete') ? 'Wird gelöscht...' : 'Löschen'}
                </button>
              )}
            </div>
          </div>
          {req.previewUrl && (
            <a
              href={req.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[var(--accent)] hover:underline mt-2 inline-block"
            >
              Vorschau: {req.previewUrl}
            </a>
          )}
          {renderTerminal(req)}
        </div>
      ))}
      {deleteId !== null && (
        <ConfirmDialog
          title="Feature-Request löschen"
          confirmLabel="Löschen"
          cancelLabel="Abbrechen"
          variant="danger"
          loading={deleteId !== null && isLoading(deleteId, 'delete')}
          onConfirm={() => handleDeleteConfirm(deleteId)}
          onCancel={() => setDeleteId(null)}
        >
          Soll der Feature-Request „{requests.find((r) => r.id === deleteId)?.title}“ wirklich gelöscht werden?
          Worktree, Branch und Remote-Branch werden entfernt.
        </ConfirmDialog>
      )}
    </div>
  );
}
