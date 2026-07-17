import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useError } from '../hooks/useError';
import { BackButton } from '../components/BackButton';
import { Loading } from '../components/Loading';
import { Modal } from '../components/Modal';
import { FeatureRequests } from '../components/FeatureRequests';
import type { SafeUser, VersionInfo } from '../../shared/types';

interface FeatureRequestProps {
  currentUser: SafeUser;
}

export function FeatureRequest({ currentUser }: FeatureRequestProps) {
  const { request } = useApi();
  const { showSuccess } = useError();
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
    const { error: reqError } = await request(
      '/api/ai/feature-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      },
      false,
    );
    setSubmitting(false);
    if (reqError) {
      setError(reqError);
    } else {
      setTitle('');
      setDescription('');
      setIsOpen(false);
      showSuccess('Feature-Request wurde gestartet.');
    }
  }

  function handleClose() {
    if (submitting) return;
    setIsOpen(false);
    setError(null);
  }

  if (aiEnabled === null) {
    return <div className="min-h-full p-6 text-slate-400">Lade...</div>;
  }

  if (!aiEnabled) {
    return (
      <div className="min-h-full p-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)] mb-4">Feature-Requests</h1>
        <p className="text-slate-400">
          Das KI-Feature ist nicht konfiguriert. Füge <code>AI_PROVIDER</code> und{' '}
          <code>AI_MODEL</code> zur <code>.env</code> hinzu, um es zu aktivieren.
        </p>
      </div>
    );
  }

  const modalActions = (
    <>
      <button
        type="button"
        onClick={handleClose}
        disabled={submitting}
        className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition disabled:opacity-50"
      >
        Abbrechen
      </button>
      <button
        type="submit"
        form="feature-request-form"
        disabled={submitting || !title.trim() || !description.trim()}
        className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition disabled:opacity-50"
      >
        {submitting ? (
          <Loading text="" size="sm" />
        ) : (
          'KI-Feature-Request starten'
        )}
      </button>
    </>
  );

  return (
    <div className="min-h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Feature-Requests</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOpen(true)}
            className="px-4 py-2 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:bg-green-400 transition"
          >
            Neuen Request
          </button>
          <BackButton />
        </div>
      </div>

      <FeatureRequests currentUser={currentUser} />

      <Modal isOpen={isOpen} title="Neuen Feature-Request" onClose={handleClose} actions={modalActions}>
        <p className="text-slate-400 mb-4">
          Beschreibe das Feature. Die KI erstellt einen Branch, baut eine Vorschau und nach Freigabe wird es in main gemergt.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded bg-red-900/30 text-red-400 border border-red-700">
            {error}
          </div>
        )}

        <form id="feature-request-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Titel</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
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
              className="w-full px-3 py-2 rounded border border-[var(--border)] bg-slate-900 text-[var(--text-h)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              required
              disabled={submitting}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
