import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useError } from '../hooks/useError';
import { useEntityMappings } from '../hooks/useEntityMappings';
import { useStoryArcs } from '../hooks/useStoryArcs';
import { useTimeline } from '../hooks/useTimeline';
import { useTimelineAiStatus } from '../hooks/useTimelineAiStatus';
import { arcMatchesFilter, formatArcLabel, sortArcsChronologically } from '../lib/storyArcs';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { EntityRichText } from '../components/EntityRichText';
import type { TimelineEvent, TimelineScene } from '../../shared/types';

interface EventGroup {
  /** Chapter the group belongs to; null = events without arc ("Ohne Kapitel"). */
  arcId: number | null;
  label: string;
  subLabel: string | null;
  events: TimelineEvent[];
}

function groupLabel(
  arcs: ReturnType<typeof useStoryArcs>['arcs'],
  arcId: number | null
): Omit<EventGroup, 'events'> {
  if (arcId === null) {
    return { arcId: null, label: 'Ohne Kapitel', subLabel: 'One-Shots und ohne Zuordnung' };
  }
  const arc = arcs.find((a) => a.id === arcId);
  if (!arc) return { arcId, label: 'Kapitel', subLabel: null };
  return {
    arcId,
    label: arc.chapterNumber !== null ? `Kapitel ${arc.chapterNumber}` : 'Sonderkapitel',
    subLabel: arc.name,
  };
}

/** Builds the chapter-ordered, filtered group list for the vertical timeline. */
function buildGroups(
  events: TimelineEvent[],
  arcs: ReturnType<typeof useStoryArcs>['arcs'],
  selectedArcId: ReturnType<typeof useStoryArcs>['selectedArcId']
): EventGroup[] {
  const visible = events
    .filter((event) => arcMatchesFilter(selectedArcId, event.arcId))
    .sort((a, b) => a.gameDay - b.gameDay || a.id - b.id);
  if (visible.length === 0) return [];

  const byArc = new Map<number, TimelineEvent[]>();
  const unassigned: TimelineEvent[] = [];
  for (const event of visible) {
    if (event.arcId === null) {
      unassigned.push(event);
    } else {
      const list = byArc.get(event.arcId) ?? [];
      list.push(event);
      byArc.set(event.arcId, list);
    }
  }

  const groups: EventGroup[] = [];
  // Chapters in campaign order; only chapters that actually have events.
  for (const arc of sortArcsChronologically(arcs)) {
    const arcEvents = byArc.get(arc.id);
    if (arcEvents) {
      groups.push({
        ...groupLabel(arcs, arc.id),
        subLabel: formatArcLabel(arc),
        events: arcEvents,
      });
    }
  }
  // Events generated while no arc was active fall into the trailing group.
  if (unassigned.length > 0) {
    groups.push({ ...groupLabel(arcs, null), events: unassigned });
  }
  return groups;
}

function EventCard({
  event,
  expanded,
  mappings,
  onToggle,
}: {
  event: TimelineEvent;
  expanded: boolean;
  mappings: ReturnType<typeof useEntityMappings>['mappings'];
  onToggle: () => void;
}) {
  return (
    <article className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 transition">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/25 whitespace-nowrap">
            Spieltag {event.gameDay}
          </span>
          <h3 className="text-lg font-semibold text-[var(--text-h)] min-w-0 truncate">
            {event.title}
          </h3>
        </div>
        {event.scenes.length > 0 && (
          <Button variant="ghost" onClick={onToggle} className="shrink-0">
            {expanded ? 'Szenen ausblenden' : 'Hineinzoomen'}
          </Button>
        )}
      </div>

      {event.description && (
        <EntityRichText
          content={event.description}
          mappings={mappings}
          className="timeline-description text-sm text-slate-300 leading-relaxed"
        />
      )}

      <div className="flex items-center gap-2 flex-wrap mt-3">
        <span className="text-xs text-slate-500">
          Quelle: {event.sessionName ?? `Session #${event.sessionId}`}
        </span>
        <Link
          to={`/sessions?session=${event.sessionId}`}
          className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/25 transition"
          title="Session öffnen"
        >
          Session
        </Link>
        {event.diaryLinks.map((link) => (
          <Link
            key={link.entryId}
            to={`/tagebuch?entry=${link.entryId}`}
            className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/25 hover:bg-blue-500/20 transition max-w-[16rem]"
            title={
              link.displayName
                ? `Tagebuch von ${link.displayName} öffnen`
                : 'Tagebucheintrag öffnen'
            }
          >
            {link.displayName ? `Tagebuch: ${link.displayName}` : 'Tagebuch'}
          </Link>
        ))}
      </div>

      {expanded && event.scenes.length > 0 && (
        <SceneTimeline scenes={event.scenes} mappings={mappings} />
      )}
    </article>
  );
}

/** Zoom level of an event: the scenes of its game day as a mini timeline. */
function SceneTimeline({
  scenes,
  mappings,
}: {
  scenes: TimelineScene[];
  mappings: ReturnType<typeof useEntityMappings>['mappings'];
}) {
  return (
    <div className="mt-4 rounded-xl bg-slate-900/60 border border-[var(--border)] p-4">
      <p className="chapter-caps text-[10px] text-amber-200/70 mb-3">✦ Szenen dieses Ereignisses</p>
      <ol className="relative ml-1 border-l border-[var(--border)] space-y-3 pl-4">
        {scenes.map((scene, index) => (
          <li key={scene.id} className="relative">
            <span className="absolute -left-[1.4rem] top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[10px] font-semibold text-slate-400">
              {index + 1}
            </span>
            <p className="text-sm font-medium text-[var(--text-h)]">{scene.title}</p>
            {scene.description && (
              <EntityRichText
                content={scene.description}
                mappings={mappings}
                className="text-xs text-slate-400 leading-relaxed mt-0.5"
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Timeline() {
  const { user } = useAuth();
  const { showSuccess } = useError();
  const { arcs, selectedArcId } = useStoryArcs();
  const { mappings } = useEntityMappings();
  const { events, pendingCount, running, aiEnabled, loading, loadTimeline, regenerate } =
    useTimeline();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  const { aiStatus, setAiStatus, sseReadyRef } = useTimelineAiStatus(() => {
    setGenerating(false);
    showSuccess('Zeitleiste aktualisiert.');
    void loadTimeline();
  });

  const groups = useMemo(
    () => buildGroups(events, arcs, selectedArcId),
    [events, arcs, selectedArcId]
  );
  const isAdmin = !!user?.isAdmin;

  async function handleRegenerate() {
    setGenerating(true);
    setAiStatus('Zeitleisten-Aktualisierung wird gestartet...');
    // The SSE stream must be connected first, otherwise early status lines
    // are lost (same race as the diary AI actions).
    await Promise.race([
      sseReadyRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    const started = await regenerate();
    if (!started) {
      setGenerating(false);
      setAiStatus(null);
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

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-h)]">Zeitleiste der Kampagne</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Nennenswerte Ereignisse aller Spieltage – KI-generiert aus den
            Session-Zusammenfassungen.
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

      <div className="flex-1 min-h-0 overflow-auto -mx-6 px-6">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">Noch keine Zeitleisten-Ereignisse vorhanden.</p>
            {isAdmin && aiEnabled && (
              <p className="text-sm text-slate-500 mt-1">
                Nutze „Zeitleiste aktualisieren“, um die Ereignisse der bisherigen Sessions zu
                generieren.
              </p>
            )}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-400">Keine Ereignisse im gewählten Kapitel vorhanden.</p>
          </div>
        ) : (
          <div className="space-y-8 pb-6">
            {groups.map((group) => (
              <section key={group.arcId ?? 'none'}>
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="chapter-caps text-[11px] text-amber-200/75">{group.label}</span>
                  {group.subLabel && (
                    <span className="chapter-serif text-sm font-semibold text-[var(--text-h)] truncate">
                      {group.subLabel}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">{group.events.length} Ereignisse</span>
                </div>
                <div className="relative ml-2 border-l border-[var(--border)] space-y-4 pl-5">
                  {group.events.map((event) => (
                    <div key={event.id} className="relative">
                      <span className="absolute -left-[1.62rem] top-6 h-2.5 w-2.5 rounded-full bg-[var(--accent)] border-2 border-[var(--panel)]" />
                      <EventCard
                        event={event}
                        expanded={expandedId === event.id}
                        mappings={mappings}
                        onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
