import { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { BackButton } from '../components/BackButton';
import { useApi } from '../hooks/useApi';
import type { RecordingChannel, RecordingSession, VersionInfo } from '../../shared/types';

interface StatusResponse {
  bot: { ready: boolean; enabled: boolean };
  active: { sessionId: number; channelId: string } | null;
}

function generateDefaultSessionName(sessions: RecordingSession[]): string {
  const base = `DnD Session ${new Date().toLocaleDateString('de-DE')}`;
  const existingNames = new Set(sessions.map((s) => s.name.toLowerCase()));
  let name = base;
  let counter = 2;
  while (existingNames.has(name.toLowerCase())) {
    name = `${base} (${counter})`;
    counter++;
  }
  return name;
}

export function Recordings() {
  const { request } = useApi();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [channels, setChannels] = useState<RecordingChannel[]>([]);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const isAutoName = useRef(true);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loadedTranscripts, setLoadedTranscripts] = useState<Record<number, string | null>>({});
  const [visibleTranscripts, setVisibleTranscripts] = useState<Set<number>>(new Set());
  const [loadingTranscript, setLoadingTranscript] = useState<Set<number>>(new Set());

  const validateName = useCallback(
    (name: string, currentSessions: RecordingSession[]): string | null => {
      const trimmed = name.trim();
      if (!trimmed) return 'Name ist erforderlich';
      const exists = currentSessions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
      if (exists) return 'Es gibt bereits eine Session mit diesem Namen';
      return null;
    },
    [],
  );

  useEffect(() => {
    if (isAutoName.current) {
      const generated = generateDefaultSessionName(sessions);
      setSessionName(generated);
      setNameError(validateName(generated, sessions));
    } else {
      setNameError(validateName(sessionName, sessions));
    }
  }, [sessions, sessionName, validateName]);

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

  async function startRecording() {
    const error = validateName(sessionName, sessions);
    if (error) {
      setNameError(error);
      return;
    }
    if (!selectedChannel) return;
    setWorking(true);
    const { data } = await request<{ session: RecordingSession }>('/api/recordings/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: selectedChannel, name: sessionName.trim() }),
    });
    if (data) {
      isAutoName.current = true;
      setSessionName('');
    }
    setWorking(false);
  }

  async function stopRecording(sessionId: number) {
    setWorking(true);
    await request<{ session: RecordingSession }>(`/api/recordings/${sessionId}/stop`, { method: 'POST' });
    setWorking(false);
  }

  async function startTranscriptionNow(sessionId: number) {
    setWorking(true);
    await request<{ message: string }>(`/api/recordings/${sessionId}/transcribe`, { method: 'POST' });
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
        <h2 className="text-xl font-semibold text-[var(--text-h)] mb-4">Neue Aufnahme</h2>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-sm text-slate-400 mb-1">Name</label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => {
                isAutoName.current = false;
                setSessionName(e.target.value);
              }}
              placeholder="DnD Session 19.07."
              className={`w-full bg-slate-800 border rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)] ${
                nameError ? 'border-[var(--danger)]' : 'border-[var(--border)]'
              }`}
            />
            {nameError && <p className="text-[var(--danger)] text-xs mt-1">{nameError}</p>}
          </div>
          <div className="flex-1 w-full">
            <label className="block text-sm text-slate-400 mb-1">Voice-Channel</label>
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="">Bitte wählen</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="accent"
            disabled={working || !selectedChannel || !sessionName.trim() || !!nameError || !status?.bot.ready}
            onClick={startRecording}
          >
            Aufnahme starten
          </Button>
        </div>
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
              </div>
              <div className="flex items-center gap-2">
                {session.status === 'recording' && (
                  <Button variant="danger" disabled={working} onClick={() => stopRecording(session.id)}>
                    Stoppen
                  </Button>
                )}
                {(session.status === 'pending_transcription' || session.status === 'error') && (
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
              </div>
            </div>

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
                  <pre className="bg-slate-900/50 rounded-lg p-4 text-sm text-slate-300 overflow-auto max-h-96 whitespace-pre-wrap">
                    {loadedTranscripts[session.id]}
                  </pre>
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
    </div>
  );
}
