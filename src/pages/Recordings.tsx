import { useEffect, useState, useCallback } from 'react';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { useApi } from '../hooks/useApi';
import type { RecordingChannel, RecordingSession } from '../../shared/types';

interface StatusResponse {
  bot: { ready: boolean; enabled: boolean };
  active: { sessionId: number; channelId: string } | null;
}

export function Recordings() {
  const { request } = useApi();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [channels, setChannels] = useState<RecordingChannel[]>([]);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadAll = useCallback(async () => {
    const [statusData, channelsData, sessionsData] = await Promise.all([
      request<StatusResponse>('/api/recordings/status', {}, false),
      request<{ channels: RecordingChannel[] }>('/api/recordings/channels', {}, false),
      request<{ sessions: RecordingSession[] }>('/api/recordings', {}, false),
    ]);
    if (statusData.data) setStatus(statusData.data);
    if (channelsData.data) setChannels(channelsData.data.channels);
    if (sessionsData.data) setSessions(sessionsData.data.sessions);
    setLoading(false);
  }, [request]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 3000);
    return () => clearInterval(interval);
  }, [loadAll]);

  async function startRecording() {
    if (!selectedChannel || !sessionName.trim()) return;
    setWorking(true);
    const { data } = await request<{ session: RecordingSession }>('/api/recordings/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: selectedChannel, name: sessionName.trim() }),
    });
    if (data) {
      setSessionName('');
      await loadAll();
    }
    setWorking(false);
  }

  async function stopRecording(sessionId: number) {
    setWorking(true);
    await request<{ session: RecordingSession }>(`/api/recordings/${sessionId}/stop`, { method: 'POST' });
    await loadAll();
    setWorking(false);
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
      <h1 className="text-3xl font-bold text-[var(--text-h)] mb-6">Aufnahmen</h1>

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
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="DnD Session 19.07."
              className="w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)]"
            />
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
            disabled={working || !selectedChannel || !sessionName.trim() || !status?.bot.ready}
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
              {session.status === 'recording' && (
                <Button variant="danger" disabled={working} onClick={() => stopRecording(session.id)}>
                  Stoppen
                </Button>
              )}
            </div>

            {session.status === 'completed' && session.transcript && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Transkript</h4>
                <pre className="bg-slate-900/50 rounded-lg p-4 text-sm text-slate-300 overflow-auto max-h-96 whitespace-pre-wrap">
                  {session.transcript}
                </pre>
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
