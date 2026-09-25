import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useError } from '../hooks/useError';
import { useI18n } from '../hooks/useI18n';
import { useStoryArcs } from '../hooks/useStoryArcs';
import { useTimeline } from '../hooks/useTimeline';
import { useTimelineAiStatus } from '../hooks/useTimelineAiStatus';
import { arcMatchesFilter } from '../lib/storyArcs';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { SideDrawer, SideDrawerItem } from '../components/SideDrawer';
import { HorizontalTimeline } from '../components/timeline/HorizontalTimeline';
import { localizeServerMessage } from '../i18n/serverMessages';
import type { TranslationKey, TFunction } from '../i18n/messages';

const timelineStatusKeys: Record<string, TranslationKey> = {
  'KI-Modell wird geladen...': 'timeline.status.modelLoading',
  'KI arbeitet an der Zeitleiste...': 'timeline.status.working',
  'Ereignisse werden extrahiert...': 'timeline.status.extracting',
  'Fast fertig...': 'timeline.status.almostDone',
  'Zeitleiste ist bereits aktuell.': 'timeline.status.alreadyCurrent',
  'Aktualisierung der Zeitleiste abgeschlossen.': 'timeline.status.completed',
};

function localizeTimelineStatus(
  status: string,
  t: TFunction,
  formatNumber: (value: number) => string
): string {
  const sessionMatch = status.match(/^Session „(.+)” \((\d+)\/(\d+)\) wird verarbeitet\.\.\.$/);
  if (sessionMatch) {
    return t('timeline.status.processingSession', {
      name: sessionMatch[1],
      current: formatNumber(Number(sessionMatch[2])),
      total: formatNumber(Number(sessionMatch[3])),
    });
  }
  const key = timelineStatusKeys[status];
  return key ? t(key) : (localizeServerMessage(status, t, { fallback: status }) ?? status);
}

export function Timeline() {
  const { t, formatNumber } = useI18n();
  const { user } = useAuth();
  const { showSuccess } = useError();
  const { arcs, selectedArcId } = useStoryArcs();
  const { events, pendingCount, running, aiEnabled, loading, loadTimeline, regenerate } =
    useTimeline();

  const [generating, setGenerating] = useState(false);

  // Deep link (?event=<id>, e.g. from the global search): the timeline opens
  // and highlights that event; see HorizontalTimeline.
  const [searchParams] = useSearchParams();
  const focusEventId = useMemo(() => {
    const raw = searchParams.get('event');
    const id = raw === null ? NaN : Number(raw);
    return Number.isFinite(id) ? id : null;
  }, [searchParams]);

  const { aiStatus, sseReadyRef } = useTimelineAiStatus(() => {
    setGenerating(false);
    showSuccess(t('timeline.notifications.updated'));
    void loadTimeline();
  });
  const displayedAiStatus = aiStatus ? localizeTimelineStatus(aiStatus, t, formatNumber) : null;

  // Global chapter filter (header) — same predicate as Sessions/Diary.
  const visibleEvents = useMemo(
    () =>
      events
        .filter(
          (event) => event.id === focusEventId || arcMatchesFilter(selectedArcId, event.arcId)
        )
        .sort((a, b) => a.gameDay - b.gameDay || a.id - b.id),
    [events, focusEventId, selectedArcId]
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
    <div className="h-full flex flex-col p-4 sm:p-6">
      {displayedAiStatus && (
        <div className="fixed bottom-4 right-4 bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3 shadow-lg z-50 max-w-md">
          {generating || running ? (
            <Loading size="sm" text={displayedAiStatus} />
          ) : (
            <p className="text-sm text-slate-400 break-words">{displayedAiStatus}</p>
          )}
        </div>
      )}

      {isAdmin && aiEnabled && (
        <SideDrawer side="right">
          <SideDrawerItem
            id="aktualisieren"
            label={t('timeline.drawer.label')}
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
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                <path d="M21 4v6h-6" />
              </svg>
            }
          >
            <div className="w-72 space-y-3 p-2">
              <p className="text-xs leading-relaxed text-slate-400">
                {t('timeline.drawer.description')}
              </p>
              <Button
                variant="accent"
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
                {generating || running
                  ? t('timeline.drawer.updating')
                  : t('timeline.drawer.update')}
              </Button>
              {pendingCount > 0 && !generating && !running && (
                <p className="text-[11px] text-amber-300/80">
                  {t('timeline.drawer.pendingSessions', {
                    count: pendingCount,
                    formattedCount: formatNumber(pendingCount),
                  })}
                </p>
              )}
              {displayedAiStatus && (
                <p className="break-words text-[11px] text-slate-500">{displayedAiStatus}</p>
              )}
            </div>
          </SideDrawerItem>
        </SideDrawer>
      )}

      <div className="flex-1 min-h-0">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">{t('timeline.empty.title')}</p>
            {isAdmin && aiEnabled && (
              <p className="text-sm text-slate-500 mt-2">{t('timeline.empty.adminHelp')}</p>
            )}
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">{t('timeline.empty.filtered')}</p>
          </div>
        ) : (
          <HorizontalTimeline events={visibleEvents} arcs={arcs} focusEventId={focusEventId} />
        )}
      </div>
    </div>
  );
}
