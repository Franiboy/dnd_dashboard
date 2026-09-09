import { useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useError } from '../hooks/useError';
import { Loading } from '../components/Loading';
import { LogPanel } from '../components/LogPanel';
import { Modal } from '../components/Modal';
import { AppIcon } from '../components/AppIcon';
import { APPS } from '../lib/apps';
import { SideDrawer, SideDrawerItem } from '../components/SideDrawer';
import type { RecordingChannel, SafeUser, UserRole } from '../../shared/types';

const USER_ROLE_LABELS: Record<UserRole, string> = {
  guest: 'Gast',
  dungeon_master: 'Dungeon Master',
  player: 'Spieler',
};

const USER_ROLE_OPTIONS: UserRole[] = ['guest', 'dungeon_master', 'player'];

interface RecordingStatus {
  bot: { ready: boolean; enabled: boolean };
  active: { sessionId: number; channelId: string } | null;
  monitoredChannel?: { channelId: string | null; channelName: string | null } | null;
}

interface AiModelConfig {
  models: string[];
  model: string;
  modelOverridden: boolean;
}

interface JobStatus {
  nightly: boolean;
  transcription: boolean;
  bingoSuggestion: boolean;
}

function JobStatusBadge({ running }: { running: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        running ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700/60 text-slate-400'
      }`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {running && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            running ? 'bg-emerald-400' : 'bg-slate-500'
          }`}
        />
      </span>
      {running ? 'Läuft' : 'Bereit'}
    </span>
  );
}

interface AdminProps {
  currentUser: SafeUser;
}

export function Admin({ currentUser }: AdminProps) {
  const { request } = useApi();
  const { setViewAsUser } = useAuth();
  const { showError } = useError();
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [persons, setPersons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<{ id: string; endpoint: string } | null>(null);
  const [managingAppsFor, setManagingAppsFor] = useState<SafeUser | null>(null);
  const [aiModels, setAiModels] = useState<AiModelConfig | null>(null);
  const [aiSaveState, setAiSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus | null>(null);
  const [recordingChannels, setRecordingChannels] = useState<RecordingChannel[]>([]);
  const [selectedRecordingChannel, setSelectedRecordingChannel] = useState('');
  const [recordingLoading, setRecordingLoading] = useState(true);
  const [recordingSaving, setRecordingSaving] = useState(false);
  const [nightlyJobLoading, setNightlyJobLoading] = useState(false);
  const [nightlyJobMessage, setNightlyJobMessage] = useState<string | null>(null);
  const [transcriptionJobLoading, setTranscriptionJobLoading] = useState(false);
  const [transcriptionJobMessage, setTranscriptionJobMessage] = useState<string | null>(null);
  const [bingoSuggestionLoading, setBingoSuggestionLoading] = useState(false);
  const [bingoSuggestionMessage, setBingoSuggestionMessage] = useState<string | null>(null);

  const isActionLoading = (id: string, endpoint: string) =>
    actionLoading?.id === id && actionLoading?.endpoint === endpoint;

  useEffect(() => {
    const source = new EventSource('/api/admin/users/events', { withCredentials: true });
    source.addEventListener('users', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          setUsers(data);
          setLoading(false);
          setError(null);
        }
      } catch {
        // ignore parse errors
      }
    });
    source.addEventListener('error', () => {
      // Connection errors are handled silently; the browser reconnects automatically
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    // World persons for the per-user character dropdown.
    request<{ persons: { name: string; qualifier: string }[] }>(
      '/api/entities',
      undefined,
      false
    ).then(({ data }) => {
      if (data) setPersons([...new Set((data.persons ?? []).map((p) => p.name))]);
    });
  }, [request]);

  useEffect(() => {
    if (error) showError(error);
  }, [error, showError]);

  useEffect(() => {
    const source = new EventSource('/api/admin/jobs/events', { withCredentials: true });
    source.addEventListener('jobs', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && typeof data === 'object') setJobStatus(data);
      } catch {
        // ignore parse errors
      }
    });
    source.addEventListener('error', () => {
      // Connection errors are handled silently; the browser reconnects automatically
    });
    return () => source.close();
  }, []);

  const loadAiModels = async () => {
    const { data } = await request<AiModelConfig>('/api/admin/ai/models', undefined, false);
    if (data) setAiModels(data);
  };

  useEffect(() => {
    loadAiModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (aiSavedTimerRef.current) clearTimeout(aiSavedTimerRef.current);
    },
    []
  );

  const selectAiModel = async (model: string) => {
    setAiModels((prev) => (prev ? { ...prev, model } : prev));
    setAiSaveState('saving');
    const { data, error: saveError } = await request<{
      model: string;
      modelOverridden: boolean;
    }>('/api/admin/ai/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (data) {
      setAiModels((prev) =>
        prev ? { ...prev, model: data.model, modelOverridden: data.modelOverridden } : prev
      );
      setAiSaveState('saved');
      if (aiSavedTimerRef.current) clearTimeout(aiSavedTimerRef.current);
      aiSavedTimerRef.current = setTimeout(() => setAiSaveState('idle'), 2000);
    } else if (saveError) {
      setError(saveError);
      setAiSaveState('idle');
    }
  };

  const loadRecordingConfig = async () => {
    setRecordingLoading(true);
    const [{ data: statusData }, { data: channelsData }, { data: configData }] = await Promise.all([
      request<RecordingStatus>('/api/recordings/status'),
      request<{ channels: RecordingChannel[] }>('/api/recordings/channels'),
      request<{ channelId: string | null }>('/api/recordings/config'),
    ]);
    if (statusData) setRecordingStatus(statusData);
    if (channelsData) setRecordingChannels(channelsData.channels);
    if (configData) setSelectedRecordingChannel(configData.channelId ?? '');
    setRecordingLoading(false);
  };

  useEffect(() => {
    loadRecordingConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveRecordingConfig = async () => {
    setRecordingSaving(true);
    const { data } = await request<{ channelId: string | null }>('/api/recordings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: selectedRecordingChannel || null }),
    });
    if (data) {
      setSelectedRecordingChannel(data.channelId ?? '');
      const { data: statusData } = await request<RecordingStatus>('/api/recordings/status');
      if (statusData) setRecordingStatus(statusData);
    }
    setRecordingSaving(false);
  };

  const triggerJob = async (
    endpoint: string,
    setLoading: (loading: boolean) => void,
    setMessage: (message: string | null) => void
  ) => {
    setLoading(true);
    setMessage(null);
    const { data, error: jobError } = await request<{
      started: boolean;
      message?: string;
      error?: string;
    }>(`/api/admin/${endpoint}`, { method: 'POST' }, false);
    setLoading(false);
    if (data?.message) {
      setMessage(data.message);
    } else if (jobError) {
      setMessage(jobError);
    }
  };

  const action = async (id: string, endpoint: string, body?: object) => {
    setActionLoading({ id, endpoint });
    const { error: actionError } = await request(`/api/admin/users/${id}${endpoint}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    setActionLoading(null);
    if (actionError) setError(actionError);
  };

  const deleteU = async (id: string) => {
    if (!confirm('Wirklich löschen?')) return;
    setActionLoading({ id, endpoint: '/delete' });
    const { error: deleteError } = await request(`/api/admin/users/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setActionLoading(null);
    if (deleteError) setError(deleteError);
  };

  const isOwn = (u: SafeUser) => u.id === currentUser.id;

  function AppAccessModal({ user, onClose }: { user: SafeUser; onClose: () => void }) {
    const disableableApps = APPS.filter(
      (app) => app.disableable && (!app.adminOnly || user.isAdmin)
    );
    const [disabled, setDisabled] = useState<string[]>(user.disabledApps);
    const toggle = (id: string) =>
      setDisabled((prev) => (prev.includes(id) ? prev.filter((app) => app !== id) : [...prev, id]));
    const enableAll = () => setDisabled([]);
    const disableAll = () => setDisabled(disableableApps.map((app) => app.id));

    async function handleSave() {
      await action(user.id, '/disabled-apps', { disabledApps: disabled });
      onClose();
    }

    const enabledCount = disableableApps.length - disabled.length;

    return (
      <Modal
        isOpen
        title={`Apps für ${user.displayName}`}
        onClose={onClose}
        contentClassName="max-h-[65vh] overflow-y-auto"
        actions={
          <>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-h)] hover:bg-slate-800 transition"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isActionLoading(user.id, '/disabled-apps')}
              className="px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
            >
              Speichern
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">
              {enabledCount} von {disableableApps.length} Apps aktiv
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={enableAll}
                className="px-2 py-1 rounded text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition"
              >
                Alle aktivieren
              </button>
              <button
                type="button"
                onClick={disableAll}
                className="px-2 py-1 rounded text-xs font-medium text-red-400 hover:bg-red-500/10 transition"
              >
                Alle deaktivieren
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {disableableApps.map((app) => {
              const isDisabled = disabled.includes(app.id);
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => toggle(app.id)}
                  className={`group relative flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                    isDisabled
                      ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                      : 'border-[var(--accent)]/30 bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10'
                  }`}
                >
                  <span
                    className={`shrink-0 mt-0.5 transition-colors ${
                      isDisabled ? 'text-slate-500' : 'text-[var(--accent)]'
                    }`}
                  >
                    <AppIcon id={app.iconId ?? app.id} size={20} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--text-h)]">{app.label}</span>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                          isDisabled
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-[var(--accent)]/20 text-[var(--accent)]'
                        }`}
                      >
                        {isDisabled ? 'Deaktiviert' : 'Aktiv'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {isDisabled
                        ? 'Klicke, um den Zugriff auf diese App freizugeben.'
                        : 'Klicke, um den Zugriff auf diese App zu sperren.'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <div className="min-h-full p-6">
      <SideDrawer side="right">
        <SideDrawerItem
          id="jobs"
          label="Hintergrundjobs"
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
        >
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[var(--text-h)]">Nightly-Job</h2>
                <JobStatusBadge running={jobStatus?.nightly === true} />
              </div>
              <p className="text-sm text-slate-400">
                Startet alle Schritte des nächtlichen Hintergrundjobs manuell in dieser Reihenfolge:
              </p>
              <ol className="text-sm text-slate-300 list-decimal list-inside space-y-1">
                <li>Sessions: Transkripte verbessern, Zusammenfassungen & Entitäten erzeugen</li>
                <li>Sessions ins Tagebuch überführen</li>
                <li>Tagebucheinträge zusammenfassen</li>
                <li>Entitäts-Summaries aktualisieren</li>
              </ol>
              <button
                type="button"
                onClick={() =>
                  triggerJob('nightly-job', setNightlyJobLoading, setNightlyJobMessage)
                }
                disabled={nightlyJobLoading || jobStatus?.nightly === true}
                className="w-full px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
              >
                {nightlyJobLoading ? (
                  <Loading text="" size="sm" />
                ) : jobStatus?.nightly ? (
                  'Läuft bereits...'
                ) : (
                  'Nightly-Job starten'
                )}
              </button>
              {nightlyJobMessage && (
                <p className="text-sm text-[var(--accent)]">{nightlyJobMessage}</p>
              )}
            </div>

            <div className="border-t border-[var(--border)] pt-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[var(--text-h)]">Transkription</h2>
                <JobStatusBadge running={jobStatus?.transcription === true} />
              </div>
              <p className="text-sm text-slate-400">
                Verarbeitet alle Sessions im Status „pending_transcription“ manuell. Dies läuft
                normalerweise separat und unabhängig vom Nightly-Job.
              </p>
              <button
                type="button"
                onClick={() =>
                  triggerJob(
                    'transcription-jobs',
                    setTranscriptionJobLoading,
                    setTranscriptionJobMessage
                  )
                }
                disabled={transcriptionJobLoading || jobStatus?.transcription === true}
                className="w-full px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
              >
                {transcriptionJobLoading ? (
                  <Loading text="" size="sm" />
                ) : jobStatus?.transcription ? (
                  'Läuft bereits...'
                ) : (
                  'Transkription starten'
                )}
              </button>
              {transcriptionJobMessage && (
                <p className="text-sm text-[var(--accent)]">{transcriptionJobMessage}</p>
              )}
            </div>

            <div className="border-t border-[var(--border)] pt-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-[var(--text-h)]">Bingo-Vorschläge</h2>
                <JobStatusBadge running={jobStatus?.bingoSuggestion === true} />
              </div>
              <p className="text-sm text-slate-400">
                Füllt den Pool der ausstehenden Bingo-Vorschläge manuell auf. Normalerweise läuft
                dies automatisch jede Minute, wenn weniger als der konfigurierte Threshold vorhanden
                ist.
              </p>
              <button
                type="button"
                onClick={() =>
                  triggerJob(
                    'bingo-suggestion-refill',
                    setBingoSuggestionLoading,
                    setBingoSuggestionMessage
                  )
                }
                disabled={bingoSuggestionLoading || jobStatus?.bingoSuggestion === true}
                className="w-full px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
              >
                {bingoSuggestionLoading ? (
                  <Loading text="" size="sm" />
                ) : jobStatus?.bingoSuggestion ? (
                  'Läuft bereits...'
                ) : (
                  'Bingo-Vorschläge generieren'
                )}
              </button>
              {bingoSuggestionMessage && (
                <p className="text-sm text-[var(--accent)]">{bingoSuggestionMessage}</p>
              )}
            </div>
          </div>
        </SideDrawerItem>

        <SideDrawerItem
          id="ai-model"
          label="KI-Modell"
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
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
              <path d="M15 2v2" />
              <path d="M9 2v2" />
              <path d="M2 15h2" />
              <path d="M2 9h2" />
              <path d="M20 15h2" />
              <path d="M20 9h2" />
              <path d="M15 20v2" />
              <path d="M9 20v2" />
            </svg>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-[var(--text-h)]">KI-Modell</h2>
              {aiSaveState === 'saving' && (
                <span className="text-xs text-slate-400">Speichern...</span>
              )}
              {aiSaveState === 'saved' && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Gespeichert
                </span>
              )}
            </div>

            {!aiModels ? (
              <Loading text="Modelle werden geladen..." />
            ) : (
              <div className="space-y-4">
                {aiModels.models.length === 0 && (
                  <p className="text-sm text-slate-500">
                    Keine Modelle verfügbar. Prüfe, dass opencode installiert ist und erreichbar
                    ist.
                  </p>
                )}
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Modell</label>
                  <select
                    value={aiModels.model}
                    onChange={(e) => selectAiModel(e.target.value)}
                    className="w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    {aiModels.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {aiModels.modelOverridden && (
                    <p className="text-xs text-[var(--accent)] mt-1">
                      Überschreibt die .env-Konfiguration
                    </p>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Das Modell wird beim Auswählen automatisch gespeichert und für alle KI-Funktionen
                  verwendet (Tagebuch, Zusammenfassungen, Entitäten, Bingo-Vorschläge).
                </p>
              </div>
            )}
          </div>
        </SideDrawerItem>

        <SideDrawerItem
          id="sessions"
          label="Sessions"
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
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          }
        >
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-[var(--text-h)]">Sessions</h2>
            {recordingLoading ? (
              <Loading text="Konfiguration wird geladen..." />
            ) : (
              <>
                {!recordingStatus?.bot.enabled && (
                  <p className="text-sm text-slate-500">
                    Discord-Bot ist nicht konfiguriert. Trage DISCORD_BOT_TOKEN und DISCORD_GUILD_ID
                    in die .env ein.
                  </p>
                )}

                {recordingStatus?.bot.enabled && !recordingStatus.bot.ready && (
                  <p className="text-sm text-slate-500">Discord-Bot verbindet...</p>
                )}

                {recordingStatus?.bot.enabled && recordingStatus.bot.ready && (
                  <>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">
                        Überwachter Voice-Channel
                      </label>
                      <select
                        value={selectedRecordingChannel}
                        onChange={(e) => setSelectedRecordingChannel(e.target.value)}
                        disabled={recordingChannels.length === 0}
                        className="w-full bg-slate-800 border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                      >
                        <option value="">
                          {recordingChannels.length === 0
                            ? 'Keine Voice-Channels verfügbar'
                            : 'Bitte wählen'}
                        </option>
                        {recordingChannels.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.participants.length} online)
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={saveRecordingConfig}
                      disabled={recordingSaving}
                      className="w-full px-4 py-2 rounded font-semibold bg-[var(--accent)] text-slate-900 hover:brightness-110 transition disabled:opacity-50"
                    >
                      {recordingSaving ? <Loading text="" size="sm" /> : 'Speichern'}
                    </button>
                    <p className="text-sm text-slate-400">
                      {recordingStatus.active
                        ? `Aktuell wird in ${recordingStatus.monitoredChannel?.channelName ?? recordingStatus.monitoredChannel?.channelId ?? 'Unbekannt'} aufgezeichnet.`
                        : recordingStatus.monitoredChannel?.channelId
                          ? `Bereit für Aufnahme in ${recordingStatus.monitoredChannel.channelName ?? recordingStatus.monitoredChannel.channelId}. Die Aufnahme startet automatisch, sobald jemand den Channel betritt.`
                          : 'Wähle einen Channel aus, damit Aufnahmen automatisch gestartet werden.'}
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </SideDrawerItem>
      </SideDrawer>

      {currentUser.isAdmin && (
        <>
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 overflow-auto">
            {loading ? (
              <Loading text="Verbinde..." />
            ) : users.length === 0 ? (
              <p className="text-slate-400">Keine Benutzer vorhanden.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="p-3">Anzeigename</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Rolle</th>
                    <th className="p-3">Charakter</th>
                    <th className="p-3">Admin</th>
                    <th className="p-3">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="p-3 text-[var(--text-h)]">
                        <div className="flex items-center gap-2">
                          {u.avatarUrl && (
                            <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                          )}
                          <span>
                            {u.displayName}{' '}
                            {u.isInitialAdmin && (
                              <span className="text-xs text-slate-500">(Ursprungsadmin)</span>
                            )}
                            {isOwn(u) && !u.isInitialAdmin && (
                              <span className="text-xs text-slate-500"> (Du)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        {u.isApproved ? (
                          <span className="text-[var(--accent)]">Freigegeben</span>
                        ) : (
                          <span className="text-[var(--danger)]">Wartend</span>
                        )}
                      </td>
                      <td className="p-3">
                        <select
                          value={u.role}
                          onChange={(e) => action(u.id, '/role', { role: e.target.value })}
                          disabled={isActionLoading(u.id, '/role')}
                          aria-label={`Rolle von ${u.displayName}`}
                          className="bg-slate-800 border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                        >
                          {USER_ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {USER_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3">
                        {u.role === 'player' ? (
                          <select
                            value={u.activePerson ?? ''}
                            onChange={(e) =>
                              action(u.id, '/active-person', { name: e.target.value || null })
                            }
                            disabled={isActionLoading(u.id, '/active-person')}
                            aria-label={`Charakter von ${u.displayName}`}
                            className="bg-slate-800 border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-h)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50 max-w-[10rem]"
                          >
                            <option value="">Kein Charakter</option>
                            {persons.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-500 text-xs">–</span>
                        )}
                      </td>
                      <td className="p-3">{u.isAdmin ? 'Ja' : 'Nein'}</td>
                      <td className="p-3 flex flex-wrap gap-2">
                        {!u.isInitialAdmin && !isOwn(u) && (
                          <>
                            {!u.isApproved && (
                              <button
                                onClick={() => action(u.id, '/approve')}
                                disabled={isActionLoading(u.id, '/approve')}
                                className="px-3 py-1 rounded bg-[var(--accent)] text-slate-900 text-xs font-semibold disabled:opacity-50"
                              >
                                {isActionLoading(u.id, '/approve') ? (
                                  <Loading text="" size="sm" />
                                ) : (
                                  'Freigeben'
                                )}
                              </button>
                            )}
                            {u.isApproved && (
                              <button
                                onClick={() => action(u.id, '/reject')}
                                disabled={isActionLoading(u.id, '/reject')}
                                className="px-3 py-1 rounded bg-[var(--warning)] text-slate-900 text-xs font-semibold disabled:opacity-50"
                              >
                                {isActionLoading(u.id, '/reject') ? (
                                  <Loading text="" size="sm" />
                                ) : (
                                  'Sperren'
                                )}
                              </button>
                            )}
                            {u.isApproved && !isOwn(u) && (
                              <button
                                onClick={() => setViewAsUser(u)}
                                className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-xs disabled:opacity-50"
                              >
                                Ansicht simulieren
                              </button>
                            )}
                            <button
                              onClick={() => action(u.id, '/admin', { isAdmin: !u.isAdmin })}
                              disabled={isActionLoading(u.id, '/admin')}
                              className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-xs disabled:opacity-50"
                            >
                              {isActionLoading(u.id, '/admin') ? (
                                <Loading text="" size="sm" />
                              ) : u.isAdmin ? (
                                'Admin entfernen'
                              ) : (
                                'Zum Admin'
                              )}
                            </button>
                            <button
                              onClick={() => setManagingAppsFor(u)}
                              disabled={isActionLoading(u.id, '/disabled-apps')}
                              className="px-3 py-1 rounded bg-slate-700 text-[var(--text-h)] text-xs disabled:opacity-50"
                            >
                              {isActionLoading(u.id, '/disabled-apps') ? (
                                <Loading text="" size="sm" />
                              ) : (
                                'Apps'
                              )}
                            </button>
                            <button
                              onClick={() => deleteU(u.id)}
                              disabled={isActionLoading(u.id, '/delete')}
                              className="px-3 py-1 rounded bg-[var(--danger)] text-white text-xs disabled:opacity-50"
                            >
                              {isActionLoading(u.id, '/delete') ? (
                                <Loading text="" size="sm" />
                              ) : (
                                'Löschen'
                              )}
                            </button>
                          </>
                        )}
                        {(u.isInitialAdmin || isOwn(u)) && (
                          <span className="text-slate-500 text-xs">Geschützt</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-6">
            <LogPanel />
          </div>
        </>
      )}

      {managingAppsFor && (
        <AppAccessModal user={managingAppsFor} onClose={() => setManagingAppsFor(null)} />
      )}
    </div>
  );
}
