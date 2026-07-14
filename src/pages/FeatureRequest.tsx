import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';

interface VersionInfo {
  mainVersion: number;
  currentVersion: number;
  branch: string;
  ahead: number;
  aiEnabled: boolean;
}

export function FeatureRequest() {
  const { request } = useApi();
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<VersionInfo>('/api/version', undefined, false).then(({ data }) => {
      if (data) setAiEnabled(data.aiEnabled);
    });
  }, [request]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: reqError } = await request('/api/ai/feature-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), description: description.trim() }),
    }, false);
    setSubmitting(false);
    if (reqError) {
      setError(reqError);
    } else {
      setSubmitted(true);
      setTitle('');
      setDescription('');
    }
  }

  if (aiEnabled === null) {
    return <div className="max-w-2xl mx-auto p-6 text-slate-400">Lade...</div>;
  }

  if (!aiEnabled) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-[var(--text-h)] mb-4">Feature-Request</h1>
        <p className="text-slate-400">
          Das KI-Feature ist nicht konfiguriert. Füge <code>AI_PROVIDER</code> und{' '}
          <code>AI_MODEL</code> zur <code>.env</code> hinzu, um es zu aktivieren.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-[var(--text-h)] mb-4">Feature-Request</h1>
      <p className="text-slate-400 mb-6">
        Beschreibe das Feature. Die KI erstellt einen Branch, baut eine Vorschau und nach deiner Freigabe wird es in main gemergt.
      </p>

      {submitted && (
        <div className="mb-4 p-3 rounded bg-green-900/30 text-green-400 border border-green-700">
          Feature-Request wurde gestartet. Die Vorschau wird im Admin-Bereich angezeigt.
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded bg-red-900/30 text-red-400 border border-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Titel</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[var(--border)] bg-[var(--panel)] text-[var(--text-h)]"
            required
            disabled={submitting}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Beschreibung</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 rounded border border-[var(--border)] bg-[var(--panel)] text-[var(--text-h)]"
            required
            disabled={submitting}
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !title.trim() || !description.trim()}
          className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold disabled:opacity-50"
        >
          {submitting ? 'Wird gestartet...' : 'KI-Feature-Request starten'}
        </button>
      </form>
    </div>
  );
}
