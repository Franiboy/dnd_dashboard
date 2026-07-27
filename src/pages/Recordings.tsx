import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { BackButton } from '../components/BackButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useApi } from '../hooks/useApi';
import type { RecordingChannel, RecordingSession, VersionInfo } from '../../shared/types';

interface StatusResponse {
  bot: { ready: boolean; enabled: boolean };
  active: { sessionId: number; channelId: string } | null;
  monitoredChannel?: { channelId: string | null; channelName: string | null } | null;
}

interface TrimInputs {
  start: string;
  end: string;
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

export function Recordings() {
  const { request } = useApi();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [channels, setChannels] = useState<RecordingChannel[]>([]);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loadedTranscripts, setLoadedTranscripts] = useState<Record<number, string | null>>({});
  const [visibleTranscripts, setVisibleTranscripts] = useState<Set<number>>(new Set());
  const [loadingTranscript, setLoadingTranscript] = useState<Set<number>>(new Set());
  const [trimInputs, setTrimInputs] = useState<Record<number, TrimInputs>>({});
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null);
  const [transcriptionProgress, setTranscriptionProgress] = useState<Record<number, { current: number; total: number } | null>>({});

  useEffect(() => {
    let eventSource: EventSource | null = null;

    request<VersionInfo>('/api/version', {}, false).then(({ data: version }) => {
      if (!version?.recordingEnabled) {
        setLoading(false);
        return;
      }

      request<{ channels: RecordingChannel[] }>('/api/recordings/channels', {}, false).then(({ data }) => {
        if (data) setChannels(data.channels);
      });

      request<{ channelId: string | null }>('/api/recordings/config', {}, false).then(({ data }) => {
        if (data) setSelectedChannel(data.channelId ?? '');
      });

      eventSource = new EventSource('/api/recordings/events', { withCredentials: true });

      eventSource.addEventListener('status', (event) => {
        const data = JSON.parse((event as MessageEvent).data) as StatusResponse;
        setStatus(data);
      });

      eventSource.addEventListener('sessions', (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { sessions: RecordingSession[] };
        setSessions(data.sessions);
        setLoading(false);
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

  useEffect(() => {
    setTrimInputs((prev) => {
      const next = { ...prev };
      for (const session of sessions) {
        if (!next[session.id]) {
          next[session.id] = {
            start: session.trimStartSeconds?.toString() ?? '',
            end: session.trimEndSeconds?.toString() ?? '',
          };
        }
      }
      return next;
    });
  }, [sessions]);

  useEffect(() => {
    const processingIds = sessions.filter((s) => s.status === 'processing').map((s) => s.id);
    if (processingIds.length === 0) {
      setTranscriptionProgress({});
      return undefined;
    }

    async function fetchProgress() {
      for (const sessionId of processingIds) {
        const { data } = await request<{ progress: { current: number; total: number } | null }>(
          `/api/recordings/${sessionId}/progress`,
          {},
          false,
        );
        setTranscriptionProgress((prev) => ({ ...prev, [sessionId]: data?.progress ?? null }));
      }
    }

    fetchProgress();
    const interval = setInterval(fetchProgress, 1000);
    return () => clearInterval(interval);
  }, [sessions, request]);

  async function saveConfig() {
    setWorking(true);
    const { data } = await request<{ channelId: string | null }>('/api/recordings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: selectedChannel || null }),
    });
    if (data) {
      setSelectedChannel(data.channelId ?? '');
    }
    setWorking(false);
  }

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

  async function saveTrimAndTranscribe(sessionId: number) {
    const inputs = trimInputs[sessionId];
    if (!inputs) return;

    const start = inputs.start.trim() ? parseFloat(inputs.start) : null;
    const end = inputs.end.trim() ? parseFloat(inputs.end) : null;

    if (start !== null && Number.isNaN(start)) {
      alert('Startzeit muss eine Zahl sein');
      return;
    }
    if (end !== null && Number.isNaN(end)) {
      alert('Endzeit muss eine Zahl sein');
      return;
    }
    if (start !== null && end !== null && start >= end) {
      alert('Startzeit muss vor der Endzeit liegen');
      return;
    }

    setWorking(true);
    const { error } = await request<{ session: RecordingSession }>(`/api/recordings/${sessionId}/trim`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trimStartSeconds: start, trimEndSeconds: end }),
    });

    if (!error) {
      await startTranscriptionNow(sessionId);
    }
    setWorking(false);
  }

  function updateTrim(sessionId: number, field: keyof TrimInputs, value: string) {
    setTrimInputs((prev) => ({
      ...prev,
      [sessionId]: { ...prev[sessionId], [field]: value },
    }));
  }

  function applyTrimFromTimestamp(sessionId: number, line: string, field: keyof TrimInputs) {
    const seconds = parseTimestamp(line);
    if (seconds === null) return;
    setTrimInputs((prev) => ({
      ...prev,
      [sessionId]: { ...prev[sessionId], [field]: seconds.toString() },
    }));
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

  const monitoredChannel = status?.monitoredChannel;
  const monitoredName = monitoredChannel?.channelName ?? monitoredChannel?.channelId ?? 'nicht konfiguriert';

  return (
    <div className="min-h-full p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-h)]">Aufnahmen</h1>
        <BackButton />
      </div>

      {!status?.bot.enabled && (
        <div className="mb-6 p-4 rounded-lg bg-[var(--warning)]/20 text-[var(--text-h)]">
          Discord-Bot ist nicht konfiguriert. Trage DISCORD_BOT_TOKEN und DISCORD_GUILD_ID in die .env ein.
        </div>
      )}

      {status?.bot.enabled && !status.bot.ready && (
        <div className="mb-6 p-4 rounded-lg bg-[var(--warning)]/20 text-[var(--text-h)]">
          Discord-Bot verbindet...
        </div>
      )}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 mb-8">
        <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Konfiguration</h2>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm text-slate-400 mb-1">Überwachter Voice-Channel</label>
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              disabled={channels.length === 0 || !status?.bot.ready}
              className="w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            >
              <option value="">
                {channels.length === 0 ? 'Keine Voice-Channels verfügbar' : 'Bitte wählen'}
              </option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.participants.length} online)
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="accent"
            disabled={working || !status?.bot.ready}
            onClick={saveConfig}
          >
            Speichern
          </Button>
        </div>
        <p className="text-sm text-slate-400 mt-3">
          {status?.active
            ? `Aktuell wird in ${monitoredName} aufgezeichnet.`
            : monitoredChannel?.channelId
              ? `Bereit für Aufnahme in ${monitoredName}. Die Aufnahme startet automatisch, sobald jemand den Channel betritt.`
              : 'Wähle einen Channel aus, damit Aufnahmen automatisch gestartet werden.'}
        </p>
      </div>

      <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Sessions</h2>
      <div className="space-y-4">
        {sessions.length === 0 && <p className="text-slate-400">Noch keine Aufnahmen vorhanden.</p>}
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
                      <>
                        <p className="text-xs text-[var(--accent)] mb-1">
                          Transkribiere Datei {transcriptionProgress[session.id]!.current} von{' '}
                          {transcriptionProgress[session.id]!.total}
                        </p>
                        <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--accent)] transition-all duration-300"
                            style={{
                              width: `${(transcriptionProgress[session.id]!.current / transcriptionProgress[session.id]!.total) * 100}%`,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">Transkription wird vorbereitet...</p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(session.status === 'pending_transcription' || session.status === 'error' || session.status === 'completed') && (
                  <Button
                    variant="secondary"
                    disabled={working}
                    onClick={() => startTranscriptionNow(session.id)}
                  >
                    {session.status === 'error' ? 'Transkription wiederholen' : 'Jetzt transkribieren'}
                  </Button>
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
                <Button
                  variant="danger"
                  disabled={working}
                  onClick={() => startDeleteSession(session.id)}
                >
                  Löschen
                </Button>
              </div>
            </div>

            {(session.status === 'pending_transcription' || session.status === 'error' || session.status === 'completed') && (
              <div className="mt-4 p-3 rounded-lg bg-slate-900/50 border border-[var(--border)]">
                <p className="text-sm text-slate-300 mb-2">Bereich zuschneiden (Sekunden, optional)</p>
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="flex-1 w-full">
                    <label className="block text-xs text-slate-500 mb-1">Startzeit</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={trimInputs[session.id]?.start ?? ''}
                      onChange={(e) => updateTrim(session.id, 'start', e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div className="flex-1 w-full">
                    <label className="block text-xs text-slate-500 mb-1">Endzeit</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={trimInputs[session.id]?.end ?? ''}
                      onChange={(e) => updateTrim(session.id, 'end', e.target.value)}
                      placeholder="leer = bis Ende"
                      className="w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <Button
                    variant="accent"
                    disabled={working}
                    onClick={() => saveTrimAndTranscribe(session.id)}
                  >
                    Speichern & transkribieren
                  </Button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Beispiel: Startzeit 600 überspringt die ersten 10 Minuten.
                </p>
              </div>
            )}

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
                      const hasTimestamp = !!timestamp;
                      return (
                        <div key={`${session.id}-${index}`} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-slate-800/50 group">
                          {hasTimestamp && (
                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                              <span className="text-[var(--accent)] font-mono text-xs select-none">{timestamp}</span>
                              <button
                                type="button"
                                onClick={() => applyTrimFromTimestamp(session.id, timestamp, 'start')}
                                title="Ab hier als Startzeit übernehmen"
                                className="text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-[var(--accent)] hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition"
                              >
                                Start
                              </button>
                              <button
                                type="button"
                                onClick={() => applyTrimFromTimestamp(session.id, timestamp, 'end')}
                                title="Bis hier als Endzeit übernehmen"
                                className="text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-[var(--accent)] hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition"
                              >
                                Ende
                              </button>
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
                <p className="text-xs text-slate-500 mt-2">
                  Klicke im Transkript auf <strong>Start</strong> oder <strong>Ende</strong>, um die Trim-Zeit direkt aus dem Transkript zu übernehmen. Danach auf „Speichern & transkribieren“ klicken.
                </p>
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
          title="Aufnahme löschen"
          confirmLabel="Löschen"
          cancelLabel="Abbrechen"
          variant="danger"
          loading={working}
          onConfirm={confirmDeleteSession}
          onCancel={() => setSessionToDelete(null)}
        >
          <p>Möchtest du die Aufnahme wirklich löschen?</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
