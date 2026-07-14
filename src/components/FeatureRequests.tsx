import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import type { FeatureRequest } from '../../shared/types';

export function FeatureRequests() {
  const { request } = useApi();
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [continuePrompts, setContinuePrompts] = useState<Record<number, string>>({});

  async function load() {
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
  }

  useEffect(() => {
    async function loadOnMount() {
      setLoading(true);
      const { data, error: reqError } = await request<{ requests: FeatureRequest[] }>(
        '/api/ai/feature-requests',
      );
      if (data) {
        setRequests(data.requests || []);
        setError(null);
      } else if (reqError) {
        setError(reqError);
      }
      setLoading(false);
    }

    loadOnMount();
    const interval = setInterval(() => {
      request<{ requests: FeatureRequest[] }>('/api/ai/feature-requests', undefined, false).then(({ data }) => {
        if (data) setRequests(data.requests || []);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [request]);

  async function handleMerge(id: number) {
    const { error: reqError } = await request(`/api/ai/feature-requests/${id}/merge`, {
      method: 'POST',
    }, false);
    if (reqError) {
      setError(reqError);
    } else {
      load();
    }
  }

  async function handleContinue(id: number) {
    const prompt = continuePrompts[id] || '';
    const { error: reqError } = await request(`/api/ai/feature-requests/${id}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    }, false);
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

  if (loading) return <div className="text-slate-400">Lade Feature-Requests...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-[var(--text-h)]">KI-Feature-Requests</h2>
      {error && <div className="p-3 rounded bg-red-900/30 text-red-400 border border-red-700">{error}</div>}
      {requests.length === 0 && <p className="text-slate-400">Keine Feature-Requests vorhanden.</p>}
      {requests.map((req) => (
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
              {req.status === 'preview_ready' && (
                <button
                  onClick={() => handleMerge(req.id)}
                  className="px-3 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold text-sm"
                >
                  Merge & Push
                </button>
              )}
              {(req.sessionId || req.sessionTitle) && req.status !== 'running' && (
                <button
                  onClick={() => handleContinue(req.id)}
                  className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-sm"
                >
                  Session fortsetzen
                </button>
              )}
            </div>
          </div>
          {(req.sessionId || req.sessionTitle) && req.status !== 'running' && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={continuePrompts[req.id] || ''}
                onChange={(e) =>
                  setContinuePrompts((prev) => ({ ...prev, [req.id]: e.target.value }))
                }
                placeholder="Zusätzlicher Prompt zum Fortsetzen"
                className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--panel)] text-sm text-[var(--text-h)]"
              />
            </div>
          )}
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
          {req.logs && (
            <details className="mt-2">
              <summary className="text-xs text-slate-500 cursor-pointer">Logs</summary>
              <pre className="mt-2 p-2 bg-black/30 rounded text-xs text-slate-300 overflow-auto max-h-48">
                {req.logs}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
