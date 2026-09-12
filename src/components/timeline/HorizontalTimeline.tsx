import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StoryArc, TimelineEvent } from '../../../shared/types';
import { useEntityMappings } from '../../hooks/useEntityMappings';
import { EntityRichText } from '../EntityRichText';

// ---------------------------------------------------------------------------
// Horizontal campaign timeline ("Arkan-Chronik").
//
// The axis shows a fixed window of campaign days and is never scaled. Dragging
// or the mouse wheel moves the window along the campaign; zooming (Ctrl+wheel
// or buttons) shrinks the visible day range (10 -> 5 -> 2 days), which unfolds
// every main event into a bordered group frame containing its sub-events
// ("Unter-Ereignisse") as standalone cards, so they visibly belong together.
// ---------------------------------------------------------------------------

const PAD = 46;
const CARD_W = 176;
/** Visible days per detail level; zooming shows fewer days -> more room. */
const WINDOW_DAYS: Record<number, number> = { 1: 10, 2: 5, 3: 2 };
const LEVEL_NAMES: Record<number, string> = {
  1: '1 · 10 Tage · Hauptevents',
  2: '2 · 5 Tage · Unter-Ereignisse',
  3: '3 · 2 Tage · Gruppen',
};
const ARC_COLORS: Record<StoryArc['status'], string> = {
  active: 'rgba(74,222,128,.45)',
  planned: 'rgba(96,165,250,.45)',
  completed: 'rgba(250,204,21,.4)',
};

interface HorizontalTimelineProps {
  /** Filtered, gameDay-ascending events of the campaign. */
  events: TimelineEvent[];
  arcs: StoryArc[];
}

const posTransition = 'transition-[left,top,bottom,width,opacity] duration-300 ease-out';

function ChipLink({
  kind,
  to,
  title,
  children,
}: {
  kind: 'session' | 'diary';
  to: string;
  title?: string;
  children: React.ReactNode;
}) {
  const cls =
    kind === 'session'
      ? 'border-violet-400/50 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20'
      : 'border-teal-400/35 bg-teal-400/10 text-teal-200 hover:bg-teal-400/20';
  return (
    <Link
      to={to}
      title={title}
      onClick={(e) => e.stopPropagation()}
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] transition ${cls}`}
    >
      {children}
    </Link>
  );
}

function ToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-[var(--border)] bg-slate-800/70 px-3 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
    >
      {label}
    </button>
  );
}

export function HorizontalTimeline({ events, arcs }: HorizontalTimelineProps) {
  const { mappings } = useEntityMappings();
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [level, setLevel] = useState(1);
  const [start, setStart] = useState(1);
  const [openEventId, setOpenEventId] = useState<number | null>(null);
  const dragRef = useRef({ active: false, moved: false, lastX: 0 });
  const startRef = useRef(start);
  startRef.current = start;

  const dayRange = useMemo(() => {
    if (events.length === 0) return { min: 1, max: 10 };
    const days = events.map((e) => e.gameDay);
    return { min: Math.min(...days), max: Math.max(...days) };
  }, [events]);

  const windowDays = WINDOW_DAYS[level];
  const pxD = width > 2 * PAD ? (width - 2 * PAD) / (windowDays - 1) : 0;
  const clampStart = (v: number) => Math.max(1, Math.min(dayRange.max - windowDays + 1, v));
  const xOf = (day: number) => PAD + (day - start) * pxD;

  // Measure the stage for pixel-positioned layout.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => setWidth(stage.clientWidth));
    ro.observe(stage);
    setWidth(stage.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Jump to the latest day of the campaign once the first measurement is in.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (width === 0 || initializedRef.current || events.length === 0) return;
    initializedRef.current = true;
    setStart(clampStart(dayRange.max - windowDays + 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, dayRange]);

  function zoomBy(dir: 1 | -1) {
    // Keep the window center anchored: zooming changes only the day count.
    const oldCenter = startRef.current + windowDays / 2 - 0.5;
    const newLevel = Math.max(1, Math.min(3, level + dir));
    const newWindow = WINDOW_DAYS[newLevel];
    setLevel(newLevel);
    setStart(Math.max(1, Math.min(dayRange.max - newWindow + 1, oldCenter - newWindow / 2 + 0.5)));
  }

  // Non-passive wheel handling: plain wheel pans, Ctrl+wheel zooms.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(e.deltaY < 0 ? 1 : -1);
      } else if (pxD > 0) {
        setStart(clampStart(startRef.current - ((e.deltaY + e.deltaX) / pxD) * 1.6));
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, width, dayRange]);

  // Drag panning; a real drag suppresses the following click.
  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { active: true, moved: false, lastX: e.clientX };
  }
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.active || pxD === 0) return;
      const dx = e.clientX - dragRef.current.lastX;
      if (Math.abs(dx) > 3) dragRef.current.moved = true;
      dragRef.current.lastX = e.clientX;
      setStart(clampStart(startRef.current - dx / pxD));
    };
    const onUp = () => {
      dragRef.current.active = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxD, level, dayRange]);

  // Group events per day: the first one is the visible primary, extras collapse
  // into a "+N" badge (only possible on legacy data before the grouping prompt).
  const byDay = useMemo(() => {
    const groups = new Map<number, TimelineEvent[]>();
    for (const ev of events) {
      const list = groups.get(ev.gameDay) ?? [];
      list.push(ev);
      groups.set(ev.gameDay, list);
    }
    for (const list of groups.values()) list.sort((a, b) => a.id - b.id);
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [events]);

  const windowEnd = start + windowDays - 1;
  const inWindow = (day: number) => day >= start - 1 && day <= windowEnd + 1;
  const latestId = events[events.length - 1]?.id ?? -1;
  // Frame width adapts to the day spacing so adjacent days never collide.
  const frameW = Math.max(200, Math.min(level >= 3 ? 470 : 330, pxD - 24));
  const evtOffsets = useMemo(
    () => byDay.map((_, i) => (i % 2 === 0 ? 'up' : 'down') as 'up' | 'down'),
    [byDay]
  );

  // Sequential overlap resolution per side: cards and frames of same-side
  // events never overlap horizontally (the pin keeps its true axis position;
  // only the card/frame and its stem shift to the next free slot).
  const layoutLefts = useMemo(() => {
    const cards = new Map<number, number>();
    const frames = new Map<number, number>();
    if (pxD === 0) return { cards, frames };
    for (const side of ['up', 'down'] as const) {
      let prevRight = -Infinity;
      let prevFrameRight = -Infinity;
      byDay.forEach(([day], i) => {
        if (evtOffsets[i] !== side) return;
        // Hidden events must not consume slots and push visible events offstage.
        if (!inWindow(day)) return;
        const x = xOf(day);
        const cardLeft = Math.max(x - CARD_W / 2, prevRight + 8);
        cards.set(day, cardLeft);
        prevRight = cardLeft + CARD_W;
        const frameLeft = Math.max(x - frameW / 2, prevFrameRight + 8);
        frames.set(day, frameLeft);
        prevFrameRight = frameLeft + frameW;
      });
    }
    return { cards, frames };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDay, evtOffsets, start, width, level, pxD]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ToolbarButton
          label="＜ zurück"
          onClick={() => setStart(clampStart(startRef.current - windowDays / 2))}
        />
        <ToolbarButton
          label="weiter ＞"
          onClick={() => setStart(clampStart(startRef.current + windowDays / 2))}
        />
        <ToolbarButton
          label="⏵ Heute"
          onClick={() => setStart(clampStart(dayRange.max - windowDays + 2))}
        />
        <ToolbarButton label="＋ Hineinzoomen" onClick={() => zoomBy(1)} />
        <ToolbarButton label="－ Herauszoomen" onClick={() => zoomBy(-1)} />
        <span className="ml-auto text-xs text-slate-500">
          Ansicht:{' '}
          <b className="text-amber-300">
            Spieltag {Math.round(start)}–{Math.round(start) + windowDays - 1}
          </b>
          {' · '}
          Stufe: <b className="text-amber-300">{LEVEL_NAMES[level]}</b>
        </span>
      </div>

      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onClick={(e) => {
          if (dragRef.current.moved) return;
          if (!(e.target as HTMLElement).closest('.tl-evt')) setOpenEventId(null);
        }}
        className="relative h-[500px] cursor-grab overflow-hidden rounded-2xl border border-violet-500/30 active:cursor-grabbing"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 15% 20%, rgba(139,92,246,.12), transparent 55%), radial-gradient(ellipse at 85% 80%, rgba(45,212,191,.10), transparent 55%), linear-gradient(180deg, #171232 0%, #0e0b21 100%)',
        }}
      >
        {/* Leyline */}
        <div
          className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full"
          style={{
            left: PAD,
            right: PAD,
            background:
              'linear-gradient(90deg, rgba(167,139,250,0), rgba(167,139,250,.65) 10%, rgba(167,139,250,.65) 90%, rgba(167,139,250,0))',
          }}
        />

        {/* Chapter segments on the axis */}
        {arcs.map((arc) => {
          const from = Math.max(arc.gameDayStart ?? 1, start);
          const to = Math.min(arc.gameDayEnd ?? dayRange.max, windowEnd);
          const visible = arc.gameDayStart !== null && from <= to;
          const x1 = xOf(from);
          const x2 = xOf(to);
          const rangeLabel =
            arc.gameDayStart !== null
              ? `Spieltag ${arc.gameDayStart}${arc.gameDayEnd !== null && arc.gameDayEnd !== arc.gameDayStart ? `–${arc.gameDayEnd}` : ''}`
              : '';
          return (
            <div key={arc.id}>
              <div
                className={`absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full ${posTransition}`}
                style={{
                  left: x1,
                  width: visible ? Math.max(0, x2 - x1) : 0,
                  background: ARC_COLORS[arc.status],
                  opacity: visible ? 1 : 0,
                }}
              />
              <div
                className={`absolute text-center ${posTransition}`}
                style={{
                  // Pinned to the bottom edge so labels never collide with
                  // group frames or cards near the axis.
                  left: Math.max(90, Math.min(width - 90, (x1 + x2) / 2)),
                  bottom: 14,
                  transform: 'translate(-50%, 0)',
                  opacity: visible && x2 - x1 > 130 ? 1 : 0,
                }}
              >
                <span className="chapter-caps block text-[10px] leading-none text-violet-300/90">
                  {arc.chapterNumber !== null ? `Kapitel ${arc.chapterNumber}` : 'Sonderkapitel'}
                </span>
                <span className="chapter-serif mt-0.5 block text-[13px] font-semibold leading-tight text-slate-100">
                  {arc.name}
                </span>
                <span className="block text-[10px] text-slate-500">{rangeLabel}</span>
              </div>
            </div>
          );
        })}

        {/* Day ruler: ticks on the axis, labels pinned to the top edge */}
        {(() => {
          const ticks = [];
          const from = Math.max(1, Math.floor(start) - 1);
          const to = Math.min(dayRange.max, Math.ceil(windowEnd) + 1);
          for (let day = from; day <= to; day++) {
            const major = (day - 1) % 5 === 0;
            ticks.push(
              <div
                key={day}
                className={`absolute top-1/2 w-px ${posTransition} ${major ? 'h-4 bg-violet-300/60' : 'h-3 bg-violet-300/25'}`}
                style={{ left: xOf(day), transform: 'translateY(calc(-50% + 4px))' }}
              />
            );
            ticks.push(
              <b
                key={`lbl-${day}`}
                className={`absolute whitespace-nowrap text-[10px] font-normal text-slate-500 ${posTransition}`}
                style={{
                  left: xOf(day),
                  top: 10,
                  transform: 'translate(-50%, 0)',
                  opacity: day >= Math.round(start) && day <= windowEnd ? 1 : 0,
                }}
              >
                Tag {day}
              </b>
            );
          }
          return ticks;
        })()}

        {/* Events: marker + group frame */}
        {byDay.map(([day, group], groupIndex) => {
          const primary = group[0];
          const extras = group.length - 1;
          const x = xOf(day);
          const visible = inWindow(day);
          const side = evtOffsets[groupIndex];
          const open = openEventId === primary.id;
          const isLatest = primary.id === latestId;
          const markerOffset = 'calc(50% + 26px)';
          const frameOffset = 'calc(50% + 34px)';
          return (
            <div key={primary.id}>
              {/* Level-1 marker card */}
              <div
                className={`tl-evt absolute ${posTransition}`}
                style={{
                  left: layoutLefts.cards.get(day) ?? x - CARD_W / 2,
                  width: CARD_W,
                  ...(side === 'up' ? { bottom: markerOffset } : { top: markerOffset }),
                  opacity: visible ? 1 : 0,
                  pointerEvents: visible ? 'auto' : 'none',
                  zIndex: 10,
                }}
              >
                <div
                  className="absolute left-1/2 h-[30px] w-[1.5px] -translate-x-1/2"
                  style={{
                    [side === 'up' ? 'bottom' : 'top']: '-30px',
                    background:
                      side === 'up'
                        ? 'linear-gradient(180deg, rgba(168,85,247,.12), rgba(168,85,247,.55))'
                        : 'linear-gradient(180deg, rgba(168,85,247,.55), rgba(168,85,247,.12))',
                  }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (level >= 2) return; // the group frame carries the details
                    setOpenEventId(open ? null : primary.id);
                  }}
                  title={primary.title}
                  className="absolute left-1/2 h-[18px] w-[18px] -translate-x-1/2 cursor-pointer rounded-full transition-transform hover:scale-110"
                  style={{
                    [side === 'up' ? 'bottom' : 'top']: '-30px',
                    background: isLatest
                      ? 'radial-gradient(circle at 32% 28%, #ccfbf1 0%, #2dd4bf 55%, #0f766e 100%)'
                      : 'radial-gradient(circle at 32% 28%, #e9d5ff 0%, #a855f7 55%, #6d28d9 100%)',
                    border: '2px solid rgba(237,233,254,.85)',
                    boxShadow: isLatest
                      ? '0 0 0 3px rgba(45,212,191,.25), 0 0 20px rgba(45,212,191,.6)'
                      : '0 0 0 3px rgba(168,85,247,.18), 0 0 18px rgba(168,85,247,.5)',
                    animation: isLatest ? 'tl-pulse 2.2s ease-in-out infinite' : undefined,
                  }}
                >
                  <span className="absolute inset-[5px] rounded-full bg-[#f5f3ff] opacity-90" />
                </button>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenEventId(open ? null : primary.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenEventId(open ? null : primary.id);
                    }
                  }}
                  className={`cursor-pointer rounded-xl border p-2.5 text-[12px] transition ${
                    open
                      ? 'border-violet-300/70 shadow-[0_0_22px_rgba(168,85,247,.35)]'
                      : 'border-violet-400/35 shadow-[0_10px_26px_rgba(0,0,0,.45)] hover:border-violet-300/60'
                  }`}
                  style={{
                    background: 'linear-gradient(170deg, #1e1743 0%, #140f2e 100%)',
                    // From level 2 on the group frame carries the content; the
                    // marker card stays collapsed until clicked (level 1 only).
                    opacity: level >= 2 ? (open ? 1 : 0) : 1,
                    pointerEvents: level >= 2 ? (open ? 'auto' : 'none') : 'auto',
                    // Never clip at the stage edge: the open card scrolls
                    // internally instead of overflowing the half-stage.
                    maxHeight: open ? 'calc(50% - 44px)' : undefined,
                    overflowY: open ? 'auto' : undefined,
                  }}
                >
                  <p className="chapter-caps flex items-center justify-between gap-2 text-[10px] text-violet-300">
                    <span>
                      Spieltag {day}
                      {isLatest ? ' · aktuell' : ''}
                    </span>
                    {!open && (
                      <span
                        title="Klicken für Details"
                        className="flex shrink-0 items-center text-violet-300/70"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 16v-4" />
                          <path d="M12 8h.01" />
                        </svg>
                      </span>
                    )}
                  </p>
                  <h4 className="chapter-serif mt-0.5 text-[13px] font-semibold leading-snug text-slate-100">
                    {primary.title}
                  </h4>
                  {open && (
                    <>
                      {primary.description && (
                        <EntityRichText
                          content={primary.description}
                          mappings={mappings}
                          className="mt-1.5 text-[11px] leading-relaxed text-slate-400"
                        />
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <ChipLink kind="session" to={`/sessions?session=${primary.sessionId}`}>
                          Session
                        </ChipLink>
                        {primary.diaryLinks.map((link) => (
                          <ChipLink
                            key={link.entryId}
                            kind="diary"
                            to={`/tagebuch?entry=${link.entryId}`}
                            title={
                              link.displayName
                                ? `Tagebuch von ${link.displayName}`
                                : 'Tagebuch öffnen'
                            }
                          >
                            Tagebuch
                          </ChipLink>
                        ))}
                      </div>
                      {primary.scenes.length > 0 && (
                        <div className="mt-2 border-t border-dashed border-violet-400/30 pt-2">
                          {primary.scenes.map((scene, index) => (
                            <div
                              key={scene.id}
                              className="flex gap-2 py-0.5 text-[11px] text-slate-400"
                            >
                              <b className="shrink-0 text-slate-200">{index + 1}</b>
                              <span>
                                <span className="font-semibold text-slate-200">{scene.title}</span>
                                {scene.description && (
                                  <EntityRichText
                                    content={scene.description}
                                    mappings={mappings}
                                    className="inline"
                                  />
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Level-2/3 group frame: main event header + sub-event cards */}
              <div
                className={`absolute rounded-xl border border-violet-400/55 p-2.5 shadow-[0_14px_34px_rgba(0,0,0,.5),0_0_22px_rgba(168,85,247,.2)] ${posTransition}`}
                style={{
                  left: Math.max(
                    10,
                    Math.min(width - frameW - 10, layoutLefts.frames.get(day) ?? x - frameW / 2)
                  ),
                  width: frameW,
                  ...(side === 'up' ? { bottom: frameOffset } : { top: frameOffset }),
                  background:
                    'linear-gradient(170deg, rgba(30,23,67,.94) 0%, rgba(20,15,46,.96) 100%)',
                  opacity: level >= 2 && visible ? 1 : 0,
                  pointerEvents: level >= 2 && visible ? 'auto' : 'none',
                  zIndex: 8,
                  maxHeight: 'calc(50% - 48px)',
                  overflowY: 'auto',
                }}
              >
                <div
                  className="absolute left-1/2 h-[34px] w-[1.5px] -translate-x-1/2"
                  style={{
                    [side === 'up' ? 'bottom' : 'top']: '-34px',
                    background:
                      'linear-gradient(180deg, rgba(168,85,247,.5), rgba(168,85,247,.15))',
                  }}
                />
                <div className="mb-2 flex items-baseline gap-2 border-b border-dashed border-violet-400/35 pb-2">
                  <span className="chapter-caps whitespace-nowrap text-[10px] text-violet-300">
                    Spieltag {day}
                    {isLatest ? ' · aktuell' : ''}
                  </span>
                  <span className="chapter-serif truncate text-[13px] font-semibold text-slate-100">
                    {primary.title}
                  </span>
                  <span className="ml-auto flex flex-none items-center gap-1">
                    <ChipLink kind="session" to={`/sessions?session=${primary.sessionId}`}>
                      Session
                    </ChipLink>
                    {primary.diaryLinks.slice(0, 2).map((link) => (
                      <ChipLink
                        key={link.entryId}
                        kind="diary"
                        to={`/tagebuch?entry=${link.entryId}`}
                      >
                        Tagebuch
                      </ChipLink>
                    ))}
                  </span>
                </div>
                <div className="flex flex-wrap items-stretch gap-2">
                  {primary.scenes.map((scene, index) => (
                    <div
                      key={scene.id}
                      className="min-w-[140px] flex-1 rounded-lg border border-violet-400/30 border-l-2 border-l-violet-500 bg-violet-100/[.04] p-2 transition hover:border-l-violet-300 hover:bg-violet-100/[.08]"
                    >
                      <p className="text-[11px] font-semibold leading-snug text-slate-100">
                        <small className="mr-1 font-normal text-slate-500">{index + 1}</small>
                        {scene.title}
                      </p>
                      {scene.description && (
                        <EntityRichText
                          content={scene.description}
                          mappings={mappings}
                          className={`mt-1 text-[10.5px] leading-relaxed text-slate-400 ${level >= 3 ? '' : 'line-clamp-3'}`}
                        />
                      )}
                    </div>
                  ))}
                  {primary.scenes.length === 0 && (
                    <p className="text-[11px] text-slate-500">Keine Unter-Ereignisse erfasst.</p>
                  )}
                </div>
              </div>

              {/* "+N" badge for legacy multi-event days */}
              {visible && extras > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenEventId(primary.id);
                  }}
                  title={`Weitere Ereignisse: ${group
                    .slice(1)
                    .map((o) => o.title)
                    .join(', ')}`}
                  className="absolute z-20 -translate-x-1/2 cursor-pointer rounded-full border border-violet-400/50 bg-[#221a4d] px-2 py-0.5 text-[10px] font-bold text-violet-200 shadow-lg hover:brightness-110"
                  style={{
                    left: x,
                    ...(side === 'up' ? { top: frameOffset } : { bottom: frameOffset }),
                  }}
                >
                  +{extras}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes tl-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(45,212,191,.25), 0 0 20px rgba(45,212,191,.6); }
          50% { box-shadow: 0 0 0 10px rgba(45,212,191,.08), 0 0 32px rgba(45,212,191,.85); }
        }
      `}</style>
    </div>
  );
}
