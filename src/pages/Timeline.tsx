import { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useError } from '../hooks/useError';
import { useStoryArcs } from '../hooks/useStoryArcs';
import { useTimeline } from '../hooks/useTimeline';
import { useTimelineAiStatus } from '../hooks/useTimelineAiStatus';
import { arcMatchesFilter } from '../lib/storyArcs';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { HorizontalTimeline } from '../components/timeline/HorizontalTimeline';

export function Timeline() {
  const { user } = useAuth();
  const { showSuccess } = useError();
  const { arcs, selectedArcId } = useStoryArcs();
  const { events, pendingCount, running, aiEnabled, loading, loadTimeline, regenerate } =
    useTimeline();

  const [generating, setGenerating] = useState(false);

  const { aiStatus, sseReadyRef } = useTimelineAiStatus(() => {
    setGenerating(false);
    showSuccess('Zeitleiste aktualisiert.');
    void loadTimeline();
  });

  // Global chapter filter (header) — same predicate as Sessions/Diary.
  const visibleEvents = useMemo(
    () =>
      events
        .filter((event) => arcMatchesFilter(selectedArcId, event.arcId))
        .sort((a, b) => a.gameDay - b.gameDay || a.id - b.id),
    [events, selectedArcId]
  );
  const isAdmin = !!user?.isAdmin;

  async function handleRegenerate() {
    setGenerating(true);
    // The SSE stream must be connected first, otherwise early status lines
    // are lost (same race as the diary AI actions).
    await Promise.race([
      sseReadyRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    const started = await regenerate();
    if (!started) {
      setGenerating(false);
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
    <div className="h-full flex flex-col p-6">
      {aiStatus && (
        <div className="fixed bottom-4 right-4 bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3 shadow-lg z-50 max-w-md">
          {generating || running ? (
            <Loading size="sm" text={aiStatus} />
          ) : (
            <p className="text-sm text-slate-400 break-words">{aiStatus}</p>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-h)]">Zeitleiste der Kampagne</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Nennenswerte Ereignisse aller Spieltage – KI-generiert aus den
            Session-Zusammenfassungen. Ziehen oder Mausrad bewegt den Ausschnitt, Hineinzoomen (Strg
            + Mausrad) öffnet die Unter-Ereignisse im Gruppenrahmen.
          </p>
        </div>
        {isAdmin && aiEnabled && (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              onClick={() => void handleRegenerate()}
              disabled={generating || running}
              icon={
                generating || running ? (
                  <svg
                    className="animate-spin"
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
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
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
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    <path d="M21 4v6h-6" />
                  </svg>
                )
              }
            >
              {generating || running ? 'Wird aktualisiert...' : 'Zeitleiste aktualisieren'}
            </Button>
            {pendingCount > 0 && !generating && !running && (
              <span className="text-[11px] text-amber-300/80">
                {pendingCount} Session{pendingCount === 1 ? '' : 's'} ohne/veraltete Ereignisse
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">Noch keine Zeitleisten-Ereignisse vorhanden.</p>
            {isAdmin && aiEnabled && (
              <p className="text-sm text-slate-500 mt-2">
                Nutze „Zeitleiste aktualisieren“, um die Ereignisse der bisherigen Sessions zu
                generieren.
              </p>
            )}
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">Keine Ereignisse im gewählten Kapitel vorhanden.</p>
          </div>
        ) : (
          <HorizontalTimeline events={visibleEvents} arcs={arcs} />
        )}
      </div>
    </div>
  );
}
