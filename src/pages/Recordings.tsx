import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { BackButton } from '../components/BackButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useApi } from '../hooks/useApi';
import type { RecordingSession, SafeUser, VersionInfo } from '../../shared/types';

interface SessionsProps {
  user: SafeUser;
}

function parseTimestamp(ts: string): number | null {
  const match = ts.match(/\[(\d{2}):(\d{2})(?::(\d{2}))?\]/);
  if (!match) return null;
  const [, a, b, c] = match;
  if (c) {
    return parseInt(a, 10) * 3600 + parseInt(b, 10) * 60 + parseInt(c, 10);
  }
  return parseInt(a, 10) * 60 + parseInt(b, 10);
}

export function Sessions({ user }: SessionsProps) {
  const { request } = useApi();
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loadedTranscripts, setLoadedTranscripts] = useState<Record<number, string | null>>({});
  const [visibleTranscripts, setVisibleTranscripts] = useState<Set<number>>(new Set());
  const [loadingTranscript, setLoadingTranscript] = useState<Set<number>>(new Set());
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null);
  const [transcriptionProgress, setTranscriptionProgress] = useState<
    Record<number, { currentFile: number; totalFiles: number; fileName: string; framesCurrent: number; framesTotal: number } | null>
  >({});

  useEffect(() => {
    let eventSource: EventSource | null = null;

    request<VersionInfo>('/api/version', {}, false).then(({ data: version }) => {
      if (!version?.recordingEnabled) {
        setLoading(false);
        return;
      }

      eventSource = new EventSource('/api/recordings/events', { withCredentials: true });

      eventSource.addEventListener('sessions', (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { sessions: RecordingSession[] };
        setSessions(data.sessions);
        setLoading(false);
      });

      eventSource.addEventListener('progress', (event) => {
        const data = JSON.parse((event as MessageEvent).data) as {
          sessionId: number;
          progress: { currentFile: number; totalFiles: number; fileName: string; framesCurrent: number; framesTotal: number } | null;
        };
        setTranscriptionProgress((prev) => ({ ...prev, [data.sessionId]: data.progress }));
      });

      eventSource.onerror = () => {
        // EventSource reconnects automatically. On a fatal auth/config error
        // the page should be redirected by ProtectedRoute, so we do nothing here.
      };
    });

    return () => {
      eventSource?.close();
    };
  }, [request]);

  async function startTranscriptionNow(sessionId: number) {
    setWorking(true);
    await request<{ message: string }>(`/api/recordings/${sessionId}/transcribe`, { method: 'POST' });
    setWorking(false);
  }

  function startDeleteSession(sessionId: number) {
    setSessionToDelete(sessionId);
  }

  async function confirmDeleteSession() {
    if (sessionToDelete === null) return;
    setWorking(true);
    setSessionToDelete(null);
    await request(`/api/recordings/${sessionToDelete}`, { method: 'DELETE' });
    setWorking(false);
  }

  async function trimTranscriptFromStart(sessionId: number, seconds: number) {
    setWorking(true);
    const { data } = await request<{ session: RecordingSession }>(`/api/recordings/${sessionId}/trim-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startSeconds: seconds }),
    });
    if (data) {
      setLoadedTranscripts((prev) => ({ ...prev, [sessionId]: data.session.transcript }));
    }
    setWorking(false);
  }

  async function trimTranscriptToEnd(sessionId: number, seconds: number) {
    setWorking(true);
    const { data } = await request<{ session: RecordingSession }>(`/api/recordings/${sessionId}/trim-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endSeconds: seconds }),
    });
    if (data) {
      setLoadedTranscripts((prev) => ({ ...prev, [sessionId]: data.session.transcript }));
    }
    setWorking(false);
  }

  async function toggleTranscript(sessionId: number) {
    if (visibleTranscripts.has(sessionId)) {
      setVisibleTranscripts((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      return;
    }

    if (!(sessionId in loadedTranscripts)) {
      setLoadingTranscript((prev) => new Set(prev).add(sessionId));
      const { data } = await request<{ session: RecordingSession }>(`/api/recordings/${sessionId}`);
      if (data) {
        setLoadedTranscripts((prev) => ({ ...prev, [sessionId]: data.session.transcript }));
      }
      setLoadingTranscript((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }

    setVisibleTranscripts((prev) => new Set(prev).add(sessionId));
  }

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
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Sessions</h1>
        <BackButton />
      </div>

      <div className="space-y-4">
        {sessions.length === 0 && <p className="text-slate-400">Noch keine Sessions vorhanden.</p>}
        {sessions.map((session) => (
          <div
            key={session.id}
            className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-h)]">{session.name}</h3>
                <p className="text-sm text-slate-400">
                  {new Date(session.startedAt).toLocaleString('de-DE')} · Status: {session.status}
                </p>
                {session.status === 'processing' && (
                  <div className="mt-1">
                    {transcriptionProgress[session.id] ? (
                      (() => {
                        const progress = transcriptionProgress[session.id]!;
                        const filePercent =
                          progress.framesTotal > 0 ? (progress.framesCurrent / progress.framesTotal) * 100 : 0;
                        return (
                          <>
                            <p className="text-xs text-[var(--accent)] mb-1">
                              Datei {progress.currentFile} von {progress.totalFiles}: {progress.fileName} ({filePercent.toFixed(0)}%)
                            </p>
                            <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[var(--accent)] transition-all duration-300"
                                style={{ width: `${filePercent}%` }}
                              />
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <p className="text-xs text-slate-400">Transkription wird vorbereitet...</p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {user.isAdmin && (
                  <>
                    {(session.status === 'pending_transcription' || session.status === 'error' || session.status === 'completed') && (
                      <Button
                        variant="secondary"
                        disabled={working}
                        onClick={() => startTranscriptionNow(session.id)}
                      >
                        {session.status === 'error' ? 'Transkription wiederholen' : 'Jetzt transkribieren'}
                      </Button>
                    )}
                  </>
                )}
                {session.status === 'completed' && (
                  <Button
                    variant="secondary"
                    disabled={loadingTranscript.has(session.id)}
                    onClick={() => toggleTranscript(session.id)}
                  >
                    {visibleTranscripts.has(session.id) ? 'Transkript ausblenden' : 'Transkript anzeigen'}
                  </Button>
                )}
                {user.isAdmin && (
                  <Button
                    variant="danger"
                    disabled={working}
                    onClick={() => startDeleteSession(session.id)}
                  >
                    Löschen
                  </Button>
                )}
              </div>
            </div>

            {session.status === 'recording' && (
              <div className="mt-4 p-3 rounded-lg bg-[var(--danger)]/20 text-[var(--danger)] text-sm flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--danger)] animate-pulse" />
                Aufnahme läuft…
              </div>
            )}

            {session.status === 'pending_transcription' && (
              <div className="mt-4 p-3 rounded-lg bg-slate-700/50 text-slate-300 text-sm">
                Wartet auf die nächtliche Transkription (läuft ca. um 2 Uhr).
              </div>
            )}

            {session.status === 'processing' && (
              <div className="mt-4 p-3 rounded-lg bg-[var(--accent)]/20 text-[var(--text-h)] text-sm flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                Transkription läuft gerade...
              </div>
            )}

            {visibleTranscripts.has(session.id) && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Transkript</h4>
                {loadedTranscripts[session.id] ? (
                  <div className="bg-slate-900/50 rounded-lg p-2 text-sm text-slate-300 overflow-auto max-h-96 space-y-1">
                    {loadedTranscripts[session.id]!.split('\n').map((line, index) => {
                      const lineMatch = line.match(/^((?:\[\d{2}:\d{2}(?::\d{2})?\])\s*)(.*)$/);
                      const timestamp = lineMatch?.[1]?.trim() ?? '';
                      const rest = lineMatch?.[2] ?? line;
                      const seconds = timestamp ? parseTimestamp(timestamp) : null;
                      const hasTimestamp = !!timestamp && seconds !== null;
                      return (
                        <div key={`${session.id}-${index}`} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-slate-800/50 group">
                          {hasTimestamp && (
                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                              <span className="text-[var(--accent)] font-mono text-xs select-none">{timestamp}</span>
                              {user.isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => trimTranscriptFromStart(session.id, seconds)}
                                    title="Alles vor diesem Zeitstempel entfernen"
                                    className="text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-[var(--accent)] hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition"
                                  >
                                    Start
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => trimTranscriptToEnd(session.id, seconds)}
                                    title="Alles nach diesem Zeitstempel entfernen"
                                    className="text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-[var(--accent)] hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition"
                                  >
                                    Ende
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          <span className="break-words">{hasTimestamp ? rest : line}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">Noch kein Transkript verfügbar.</p>
                )}
              </div>
            )}

            {session.error && (
              <div className="mt-4 p-3 rounded-lg bg-[var(--danger)]/20 text-[var(--danger)] text-sm">
                {session.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {sessionToDelete !== null && (
        <ConfirmDialog
          title="Session löschen"
          confirmLabel="Löschen"
          cancelLabel="Abbrechen"
          variant="danger"
          loading={working}
          onConfirm={confirmDeleteSession}
          onCancel={() => setSessionToDelete(null)}
        >
          <p>Möchtest du die Session wirklich löschen?</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
