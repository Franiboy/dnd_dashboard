import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useEntityDialog } from '../hooks/useEntityDialog';
import { useEntityMappings } from '../hooks/useEntityMappings';
import { useError } from '../hooks/useError';
import { EntityRichText } from '../components/EntityRichText';
import { applyEntityHighlights } from '../components/EntityQuillBlot';
import { EntityChooserModal, type EntityCandidate } from '../components/EntityChooserModal';
import { SideDrawer, SideDrawerItem } from '../components/SideDrawer';
import { Toggle } from '../components/Toggle';
import ReactQuill from 'react-quill-new';
import type Quill from 'quill';
import type {
  DiaryEntry,
  EntityType,
  RecordingSession,
  SafeUser,
  SessionDiaryEntryLink,
  SessionDiaryTransfer,
  VersionInfo,
  CampaignDay,
} from '../../shared/types';
import 'react-quill-new/dist/quill.snow.css';

interface SessionsProps {
  user: SafeUser;
}

const summaryQuillModules = { toolbar: false };
const summaryQuillFormats = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'list',
  'bullet',
  'indent',
  'link',
  'blockquote',
  'code-block',
  'align',
  'entity',
];

function parseTimestamp(ts: string): number | null {
  const match = ts.match(/\[(\d{2}):(\d{2})(?::(\d{2}))?\]/);
  if (!match) return null;
  const [, a, b, c] = match;
  if (c) {
    return parseInt(a, 10) * 3600 + parseInt(b, 10) * 60 + parseInt(c, 10);
  }
  return parseInt(a, 10) * 60 + parseInt(b, 10);
}

const SESSION_DELETE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function isDeletableSession(session: RecordingSession): boolean {
  return Date.now() - new Date(session.startedAt).getTime() < SESSION_DELETE_WINDOW_MS;
}

function SessionDiaryTransferBadge({ transfer }: { transfer: SessionDiaryTransfer }) {
  const label = transfer.isOutdated
    ? 'Tagebuch veraltet'
    : transfer.autoAccepted
      ? 'In Tagebuch übernommen'
      : 'KI-Tagebuch-Entwurf';
  const colorClasses = transfer.isOutdated
    ? 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/20'
    : transfer.autoAccepted
      ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20'
      : 'bg-slate-800 text-slate-300 border-slate-700';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorClasses}`}
    >
      {label}
    </span>
  );
}

export function Sessions({ user }: SessionsProps) {
  const { request } = useApi();
  const { updateUser } = useAuth();
  const { mappings } = useEntityMappings();
  const { showSuccess, showError } = useError();
  const { openEntity } = useEntityDialog();
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loadedTranscripts, setLoadedTranscripts] = useState<Record<number, string | null>>({});
  const [visibleTranscripts, setVisibleTranscripts] = useState<Set<number>>(new Set());
  const [loadingTranscript, setLoadingTranscript] = useState<Set<number>>(new Set());
  const [expandedLongSummaries, setExpandedLongSummaries] = useState<Set<number>>(new Set());
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null);
  const [audioToDelete, setAudioToDelete] = useState<number | null>(null);
  const [improvingId, setImprovingId] = useState<number | null>(null);
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [draftingId, setDraftingId] = useState<number | null>(null);
  const [diaryTransfers, setDiaryTransfers] = useState<Record<number, SessionDiaryTransfer>>({});
  const [campaignDays, setCampaignDays] = useState<CampaignDay[]>([]);
  const [gameDayDrafts, setGameDayDrafts] = useState<
    Record<number, { day: number | null; label: string | null }>
  >({});
  const [sessionDiaryEntries, setSessionDiaryEntries] = useState<
    Record<number, SessionDiaryEntryLink[]>
  >({});
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [chooserCandidates, setChooserCandidates] = useState<EntityCandidate[] | null>(null);
  const [transcriptionProgress, setTranscriptionProgress] = useState<
    Record<
      number,
      {
        currentFile: number;
        totalFiles: number;
        fileName: string;
        framesCurrent: number;
        framesTotal: number;
      } | null
    >
  >({});
  const summaryQuillRefs = useRef<Record<number, ReactQuill>>({});
  const sessionRefs = useRef<Record<number, HTMLElement>>({});
  const expandedSummaryHash = useMemo(
    () =>
      sessions
        .filter((s) => expandedLongSummaries.has(s.id))
        .map((s) => s.longSummary ?? '')
        .join('\u0000'),
    [sessions, expandedLongSummaries]
  );

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
          progress: {
            currentFile: number;
            totalFiles: number;
            fileName: string;
            framesCurrent: number;
            framesTotal: number;
          } | null;
        };
        setTranscriptionProgress((prev) => ({ ...prev, [data.sessionId]: data.progress }));
      });

      eventSource.addEventListener('aiLog', (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { message: string };
        setAiStatus(data.message);
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
    let cancelled = false;
    async function load() {
      const { data } = await request<{ transfers: Record<number, SessionDiaryTransfer> }>(
        '/api/recordings/diary-transfers'
      );
      if (!cancelled && data) setDiaryTransfers(data.transfers);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await request<{ entries: Record<number, SessionDiaryEntryLink[]> }>(
        '/api/recordings/session-diary-entries'
      );
      if (!cancelled && data) setSessionDiaryEntries(data.entries);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    async function loadCampaignDays() {
      const { data } = await request<{ days: CampaignDay[]; currentGameDay: number | null }>(
        '/api/campaign/days'
      );
      if (cancelled || !data) return;
      setCampaignDays(data.days);
    }
    loadCampaignDays();
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    const sessionIdParam = searchParams.get('session');
    if (!sessionIdParam || sessions.length === 0) return;
    const sessionId = Number(sessionIdParam);
    if (!Number.isFinite(sessionId)) return;

    const timer = setTimeout(() => {
      const element = sessionRefs.current[sessionId];
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        element.classList.add('ring-2', 'ring-[var(--accent)]');
        setTimeout(() => element.classList.remove('ring-2', 'ring-[var(--accent)]'), 2000);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchParams, loading, sessions]);

  async function startTranscriptionNow(sessionId: number) {
    setWorking(true);
    await request<{ message: string }>(`/api/recordings/${sessionId}/transcribe`, {
      method: 'POST',
    });
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

  function startDeleteAudio(sessionId: number) {
    setAudioToDelete(sessionId);
  }

  async function confirmDeleteAudio() {
    if (audioToDelete === null) return;
    setWorking(true);
    setAudioToDelete(null);
    await request(`/api/recordings/${audioToDelete}/delete-audio`, { method: 'POST' });
    setWorking(false);
  }

  async function trimTranscriptFromStart(sessionId: number, seconds: number) {
    setWorking(true);
    const { data } = await request<{ session: RecordingSession }>(
      `/api/recordings/${sessionId}/trim-transcript`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startSeconds: seconds }),
      }
    );
    if (data) {
      setLoadedTranscripts((prev) => ({ ...prev, [sessionId]: data.session.transcript }));
    }
    setWorking(false);
  }

  async function trimTranscriptToEnd(sessionId: number, seconds: number) {
    setWorking(true);
    const { data } = await request<{ session: RecordingSession }>(
      `/api/recordings/${sessionId}/trim-transcript`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endSeconds: seconds }),
      }
    );
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

  function toggleLongSummary(sessionId: number) {
    setExpandedLongSummaries((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  useEffect(() => {
    const attached: { quill: Quill; handler: (event: MouseEvent) => void }[] = [];
    const timer = setTimeout(() => {
      for (const sessionId of expandedLongSummaries) {
        const reactQuill = summaryQuillRefs.current[sessionId];
        if (!reactQuill) continue;
        const quill = reactQuill.getEditor();
        if (!quill) continue;
        applyEntityHighlights(quill, mappings);

        const handleClick = (event: MouseEvent) => {
          const target = (event.target as HTMLElement | null)?.closest(
            '.ql-entity'
          ) as HTMLElement | null;
          if (!target) return;
          const type = target.getAttribute('data-type') as EntityType | null;
          const canonical = target.getAttribute('data-canonical');
          if (!type || !canonical) return;
          const qualifier = target.getAttribute('data-qualifier') ?? '';
          if (target.getAttribute('data-ambiguous')) {
            // Several homonyms share this mention - ask which one was meant.
            const text = (target.textContent ?? '').trim();
            const candidates = mappings
              .filter(
                (m) =>
                  m.type === type &&
                  (m.canonical.toLowerCase() === text.toLowerCase() ||
                    m.aliases.some((a) => a.toLowerCase() === text.toLowerCase()))
              )
              .map((m) => ({
                type: m.type,
                name: m.canonical,
                qualifier: m.qualifier ?? '',
                miniSummary: m.miniSummary,
              }));
            if (candidates.length > 1) {
              setChooserCandidates(candidates);
              return;
            }
          }
          openEntity(canonical, type, undefined, qualifier);
        };
        quill.root.addEventListener('click', handleClick);
        attached.push({ quill, handler: handleClick });
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      for (const { quill, handler } of attached) {
        quill.root.removeEventListener('click', handler);
      }
    };
  }, [expandedLongSummaries, mappings, openEntity, expandedSummaryHash]);

  async function improveTranscript(sessionId: number) {
    setWorking(true);
    setImprovingId(sessionId);
    setAiStatus('KI verbessert das Transkript...');
    const { data, error } = await request<{ session: RecordingSession }>(
      `/api/recordings/${sessionId}/improve-transcript`,
      { method: 'POST' }
    );
    setWorking(false);
    setImprovingId(null);
    if (data) {
      if (visibleTranscripts.has(sessionId)) {
        setLoadedTranscripts((prev) => ({ ...prev, [sessionId]: data.session.transcript }));
      }
    } else if (error) {
      setAiStatus(null);
    }
  }

  async function generateSummary(sessionId: number) {
    setWorking(true);
    setSummarizingId(sessionId);
    setAiStatus('KI erstellt die Zusammenfassung...');
    const { data, error } = await request<{ session: RecordingSession }>(
      `/api/recordings/${sessionId}/summary`,
      { method: 'POST' }
    );
    setWorking(false);
    setSummarizingId(null);
    if (data) {
      if (visibleTranscripts.has(sessionId)) {
        setLoadedTranscripts((prev) => ({ ...prev, [sessionId]: data.session.transcript }));
      }
    } else if (error) {
      setAiStatus(null);
    }
  }

  async function importToDiary(sessionId: number) {
    setWorking(true);
    setDraftingId(sessionId);
    setAiStatus('KI überführt Session ins Tagebuch...');
    const { data, error } = await request<{ entry: DiaryEntry; transfer: SessionDiaryTransfer }>(
      `/api/recordings/${sessionId}/diary-draft`,
      { method: 'POST' }
    );
    setWorking(false);
    setDraftingId(null);
    if (data) {
      setDiaryTransfers((prev) => ({ ...prev, [sessionId]: data.transfer }));
      showSuccess(
        'KI-Vorschlag wurde im Tagebuch erstellt. Bitte im Tagebuch prüfen und bestätigen.'
      );
      setAiStatus(null);
    } else if (error) {
      showError(error);
      setAiStatus(null);
    }
  }

  async function saveGameDay(
    sessionId: number,
    gameDay: number | null,
    gameDateLabel: string | null
  ) {
    setWorking(true);
    const { data, error } = await request<{ session: RecordingSession }>(
      `/api/recordings/${sessionId}/game-day`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameDay, gameDateLabel }),
      }
    );
    setWorking(false);
    if (data) {
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? data.session : s)));
      showSuccess('Spieltag gespeichert.');
    } else if (error) {
      showError(error);
    }
  }

  async function updateSessionDiarySettings(
    updates: Partial<Pick<SafeUser, 'autoSessionToDiary' | 'autoAcceptSessionDiary'>>
  ) {
    const next = {
      autoSessionToDiary: updates.autoSessionToDiary ?? user.autoSessionToDiary,
      autoAcceptSessionDiary: updates.autoAcceptSessionDiary ?? user.autoAcceptSessionDiary,
    };
    const { data, error } = await request<{ user: SafeUser }>('/api/me/session-diary-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (data) {
      updateUser(data.user);
    } else if (error) {
      showError(error);
    }
  }

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <Loading size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-full p-6">
      <SideDrawer side="right">
        <SideDrawerItem
          id="config"
          label="Einstellungen"
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
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
        >
          <div className="p-2 space-y-6">
            <h3 className="text-lg font-semibold text-[var(--text-h)]">Tagebuch-Automatisierung</h3>
            <div className="space-y-4">
              <Toggle
                checked={user.autoSessionToDiary}
                onChange={(checked) => updateSessionDiarySettings({ autoSessionToDiary: checked })}
                label="Fertige Sessions automatisch in mein Tagebuch übertragen"
              />
              <Toggle
                checked={user.autoAcceptSessionDiary}
                disabled={!user.autoSessionToDiary}
                onChange={(checked) =>
                  updateSessionDiarySettings({ autoAcceptSessionDiary: checked })
                }
                label="KI-Entwurf ohne Prüfung direkt als Tagebuchnotiz übernehmen"
              />
            </div>
            <p className="text-xs text-slate-400">
              Wenn die automatische Übertragung aktiv ist, legt der Nightly-Job aus jeder fertigen
              Session einen Tagebucheintrag an. Ist zusätzlich „direkt übernehmen“ aktiv, wird der
              KI-Text sofort als endgültiger Inhalt gespeichert und der
              Tagebuch-Zusammenfassungs-Job kann ihn direkt verarbeiten.
            </p>
          </div>
        </SideDrawerItem>
      </SideDrawer>

      {aiStatus && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--accent)]/20 text-[var(--text-h)] text-sm flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
          {aiStatus}
        </div>
      )}

      <div className="space-y-4">
        {sessions.length === 0 && <p className="text-slate-400">Noch keine Sessions vorhanden.</p>}
        {sessions.map((session) => (
          <div
            key={session.id}
            ref={(el) => {
              if (el) sessionRefs.current[session.id] = el;
            }}
            className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 transition"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-h)]">{session.name}</h3>
                <p className="text-sm text-slate-400">
                  {new Date(session.startedAt).toLocaleString('de-DE')} · Status: {session.status}
                  {session.transcriptImprovedAt && (
                    <span className="ml-2 text-xs font-medium text-[var(--accent)]">
                      ✓ KI-optimiert
                    </span>
                  )}
                </p>
                {user.isAdmin && (
                  <div className="mt-1 grid grid-cols-[auto_1fr] gap-2 items-center text-xs">
                    <label className="text-slate-400">Spieltag</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={
                          gameDayDrafts[session.id]?.day !== undefined
                            ? (gameDayDrafts[session.id]!.day ?? '')
                            : (session.gameDay ?? '')
                        }
                        onChange={(e) =>
                          setGameDayDrafts((prev) => ({
                            ...prev,
                            [session.id]: {
                              day: e.target.value === '' ? null : Number(e.target.value),
                              label: prev[session.id]?.label ?? session.gameDateLabel ?? '',
                            },
                          }))
                        }
                        className="min-w-0 px-2 py-1 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                      >
                        <option value="">– kein –</option>
                        {campaignDays.map((d) => (
                          <option key={d.day} value={d.day}>
                            Spieltag {d.day}
                            {d.label ? ` – ${d.label}` : ''}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={gameDayDrafts[session.id]?.label ?? session.gameDateLabel ?? ''}
                        onChange={(e) =>
                          setGameDayDrafts((prev) => ({
                            ...prev,
                            [session.id]: {
                              day: prev[session.id]?.day ?? session.gameDay,
                              label: e.target.value,
                            },
                          }))
                        }
                        placeholder="Label (optional)"
                        className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-900 border border-[var(--border)] text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          saveGameDay(
                            session.id,
                            (gameDayDrafts[session.id]?.day !== undefined
                              ? gameDayDrafts[session.id]!.day
                              : session.gameDay) ?? null,
                            (gameDayDrafts[session.id]?.label ?? session.gameDateLabel ?? '') as
                              string | null
                          )
                        }
                        className="px-2 py-1 rounded bg-[var(--accent)] text-slate-900 font-semibold hover:brightness-110 transition"
                      >
                        Speichern
                      </button>
                    </div>
                  </div>
                )}
                {diaryTransfers[session.id] && (
                  <div className="mt-1">
                    <SessionDiaryTransferBadge transfer={diaryTransfers[session.id]!} />
                  </div>
                )}
                {sessionDiaryEntries[session.id] && sessionDiaryEntries[session.id].length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-400">Tagebuch:</span>
                    {sessionDiaryEntries[session.id].map((entry) => (
                      <Link
                        key={entry.entryId}
                        to={`/tagebuch?entry=${entry.entryId}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 hover:bg-[var(--accent)]/20 transition text-xs"
                        title={user.isAdmin ? `${entry.title} (${entry.displayName})` : entry.title}
                      >
                        {entry.title}
                        {user.isAdmin && (
                          <span className="text-slate-500">· {entry.displayName}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
                {session.status === 'processing' && (
                  <div className="mt-1">
                    {transcriptionProgress[session.id] ? (
                      (() => {
                        const progress = transcriptionProgress[session.id]!;
                        const filePercent =
                          progress.framesTotal > 0
                            ? (progress.framesCurrent / progress.framesTotal) * 100
                            : 0;
                        return (
                          <>
                            <p className="text-xs text-[var(--accent)] mb-1">
                              Transkription … {filePercent.toFixed(0)}%
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
                    {(session.status === 'pending_transcription' ||
                      session.status === 'error' ||
                      session.status === 'completed') &&
                      session.hasWavFiles && (
                        <Button
                          variant="secondary"
                          disabled={working}
                          onClick={() => startTranscriptionNow(session.id)}
                        >
                          {session.status === 'error'
                            ? 'Transkription wiederholen'
                            : 'Jetzt transkribieren'}
                        </Button>
                      )}
                    {session.status === 'completed' && (
                      <Button
                        variant="secondary"
                        disabled={working || improvingId === session.id}
                        onClick={() => improveTranscript(session.id)}
                      >
                        {improvingId === session.id
                          ? 'Verbessern...'
                          : session.transcriptImprovedAt
                            ? 'Skript erneut verbessern'
                            : 'Skript verbessern'}
                      </Button>
                    )}
                    {session.status === 'completed' && (
                      <Button
                        variant="secondary"
                        disabled={working || summarizingId === session.id}
                        onClick={() => generateSummary(session.id)}
                      >
                        {summarizingId === session.id
                          ? 'Zusammenfassung...'
                          : session.longSummary
                            ? 'Zusammenfassung erneuern'
                            : 'Zusammenfassung erstellen'}
                      </Button>
                    )}
                  </>
                )}
                {session.status === 'completed' && (
                  <Button
                    variant="accent"
                    disabled={working || draftingId === session.id}
                    onClick={() => importToDiary(session.id)}
                  >
                    {draftingId === session.id ? 'Tagebuch...' : 'Ins Tagebuch'}
                  </Button>
                )}
                {session.status === 'completed' && (
                  <Button
                    variant="secondary"
                    disabled={loadingTranscript.has(session.id)}
                    onClick={() => toggleTranscript(session.id)}
                  >
                    {visibleTranscripts.has(session.id)
                      ? 'Transkript ausblenden'
                      : 'Transkript anzeigen'}
                  </Button>
                )}
                {user.isAdmin &&
                  session.hasWavFiles &&
                  session.status !== 'recording' &&
                  session.status !== 'processing' && (
                    <Button
                      variant="danger"
                      disabled={working}
                      onClick={() => startDeleteAudio(session.id)}
                    >
                      Audiodateien löschen
                    </Button>
                  )}
                {user.isAdmin && isDeletableSession(session) && (
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

            {session.summary && (
              <div className="mt-4 p-3 rounded-lg bg-slate-800/50 border-l-4 border-[var(--accent)] text-slate-200 text-sm">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Kurze Zusammenfassung</h4>
                <div className="text-slate-200 text-sm whitespace-pre-wrap">
                  <EntityRichText content={session.summary} mappings={mappings} isHtml={false} />
                </div>
                {session.summaryGeneratedAt && (
                  <p className="text-xs text-slate-500 mt-2">
                    Erstellt am {new Date(session.summaryGeneratedAt).toLocaleString('de-DE')}
                  </p>
                )}
              </div>
            )}

            {session.longSummary && (
              <div className="mt-4">
                {expandedLongSummaries.has(session.id) ? (
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-[var(--border)]">
                    <h4 className="text-sm font-semibold text-slate-300 mb-2">
                      Ausführliche Zusammenfassung
                    </h4>
                    <ReactQuill
                      ref={(el) => {
                        if (el) summaryQuillRefs.current[session.id] = el;
                      }}
                      theme="snow"
                      value={session.longSummary}
                      readOnly
                      modules={summaryQuillModules}
                      formats={summaryQuillFormats}
                      className="session-summary-editor bg-slate-900 text-[var(--text-h)] rounded border border-[var(--border)]"
                    />
                    {session.longSummaryGeneratedAt && (
                      <p className="text-xs text-slate-500 mt-2">
                        Erstellt am{' '}
                        {new Date(session.longSummaryGeneratedAt).toLocaleString('de-DE')}
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      className="mt-2"
                      onClick={() => toggleLongSummary(session.id)}
                    >
                      Weniger anzeigen
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => toggleLongSummary(session.id)}>
                    Ausführliche Zusammenfassung anzeigen
                  </Button>
                )}
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
                        <div
                          key={`${session.id}-${index}`}
                          className="flex items-start gap-2 px-2 py-1 rounded hover:bg-slate-800/50 group"
                        >
                          {hasTimestamp && (
                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                              <span className="text-[var(--accent)] font-mono text-xs select-none">
                                {timestamp}
                              </span>
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

      {audioToDelete !== null && (
        <ConfirmDialog
          title="Audiodateien löschen"
          confirmLabel="Löschen"
          cancelLabel="Abbrechen"
          variant="danger"
          loading={working}
          onConfirm={confirmDeleteAudio}
          onCancel={() => setAudioToDelete(null)}
        >
          <p>
            Möchtest du die WAV-Audiodateien dieser Session wirklich löschen? Das Transkript bleibt
            erhalten.
          </p>
        </ConfirmDialog>
      )}

      {chooserCandidates && (
        <EntityChooserModal
          candidates={chooserCandidates}
          onClose={() => setChooserCandidates(null)}
          onPick={(candidate) => {
            setChooserCandidates(null);
            openEntity(candidate.name, candidate.type, undefined, candidate.qualifier);
          }}
        />
      )}
    </div>
  );
}
