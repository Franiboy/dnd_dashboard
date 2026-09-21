import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntityMapping, StoryArc, TimelineEvent } from '../../../shared/types';
import { useEntityMappings } from '../../hooks/useEntityMappings';
import { EntityRichText } from '../EntityRichText';
import { BadgeLink } from '../BadgeLink';
import {
  CARD_W,
  CULL_DAYS,
  OPEN_CARD_W,
  PAD,
  WINDOW_DAYS,
  alternatingSides,
  clampStart,
  computeDayRange,
  computeLayout,
  dayToX,
  frameWidth,
  layoutChapterLabels,
  pixelsPerDay,
} from './layout';

// ---------------------------------------------------------------------------
// Horizontal campaign timeline ("Arkan-Chronik").
//
// The axis shows a fixed window of campaign days and is never scaled. Dragging,
// the mouse wheel or a horizontal swipe moves the window along the campaign;
// zooming (Ctrl+wheel, two-finger pinch on touch) shrinks the visible day range
// (10 -> 5 -> 2 days), which unfolds every main event into a bordered group
// frame containing its sub-events ("Unter-Ereignisse") as standalone cards, so
// they visibly belong together.
// ---------------------------------------------------------------------------

/** Finger spread (px) of one pinch zoom step. */
const PINCH_STEP_PX = 32;

const ARC_COLORS: Record<StoryArc['status'], string> = {
  active: 'rgba(74,222,128,.45)',
  planned: 'rgba(96,165,250,.45)',
  completed: 'rgba(250,204,21,.4)',
};

interface HorizontalTimelineProps {
  /** Filtered, gameDay-ascending events of the campaign. */
  events: TimelineEvent[];
  arcs: StoryArc[];
  /**
   * Deep link (?event=<id>, e.g. from the global search): opens the event's
   * card, centers its day in the window and highlights it briefly.
   */
  focusEventId?: number | null;
}

const posTransition = 'transition-[left,top,bottom,width,opacity] duration-300 ease-out';

/** Session + diary badges of an event; diaryLimit caps the badges with a "+x". */
function EventLinkBadges({ event, diaryLimit }: { event: TimelineEvent; diaryLimit?: number }) {
  const diaryLinks =
    diaryLimit === undefined ? event.diaryLinks : event.diaryLinks.slice(0, diaryLimit);
  return (
    <>
      <BadgeLink
        size="sm"
        variant="session"
        to={`/sessions?session=${event.sessionId}`}
        onClick={(e) => e.stopPropagation()}
      >
        Session
      </BadgeLink>
      {diaryLinks.map((link) => (
        <BadgeLink
          key={link.entryId}
          size="sm"
          variant="diary"
          to={`/tagebuch?entry=${link.entryId}`}
          title={link.displayName ? `Tagebuch von ${link.displayName}` : 'Tagebuch öffnen'}
          onClick={(e) => e.stopPropagation()}
        >
          Tagebuch
        </BadgeLink>
      ))}
      {diaryLimit !== undefined && event.diaryLinks.length > diaryLimit && (
        <span className="text-[10px] text-slate-500">+{event.diaryLinks.length - diaryLimit}</span>
      )}
    </>
  );
}

/**
 * Legacy pre-grouping events of the same day ("+N" badge): rendered inside the
 * day's opened card (level 1) or group frame (level 2+, compact) so their
 * content stays reachable.
 */
function ExtraEventList({
  extras,
  mappings,
  compact = false,
}: {
  extras: TimelineEvent[];
  mappings: EntityMapping[];
  compact?: boolean;
}) {
  if (extras.length === 0) return null;
  return (
    <div className="mt-2 border-t border-dashed border-violet-400/30 pt-2">
      <p className="chapter-caps text-[10px] text-violet-300">Weitere Ereignisse an diesem Tag</p>
      {extras.map((extra) => (
        <div
          key={extra.id}
          className="mt-1.5 rounded-lg border border-violet-400/25 bg-violet-100/[.03] p-2"
        >
          <p
            className={`font-semibold leading-snug text-slate-100 ${compact ? 'text-[11px]' : 'text-[12px]'}`}
          >
            {extra.title}
          </p>
          {extra.description && (
            <EntityRichText
              content={extra.description}
              mappings={mappings}
              className={`mt-1 leading-relaxed text-slate-400 ${compact ? 'text-[10.5px] line-clamp-3' : 'text-[11px]'}`}
            />
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <EventLinkBadges event={extra} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HorizontalTimeline({ events, arcs, focusEventId }: HorizontalTimelineProps) {
  const { mappings } = useEntityMappings();
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [level, setLevel] = useState(1);
  const [start, setStart] = useState(1);
  const [openEventId, setOpenEventId] = useState<number | null>(null);
  const dragRef = useRef({ active: false, moved: false, lastX: 0 });
  const pinchRef = useRef<{ baseDist: number } | null>(null);
  const pinchActiveRef = useRef(false);
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);
  const width = size.w;

  const dayRange = useMemo(() => computeDayRange(events), [events]);

  const windowDays = WINDOW_DAYS[level];
  const pxD = pixelsPerDay(width, windowDays);
  const xOf = (day: number) => dayToX(day, start, pxD);

  // Measure the stage for pixel-positioned layout.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: stage.clientWidth, h: stage.clientHeight });
    });
    ro.observe(stage);
    setSize({ w: stage.clientWidth, h: stage.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Jump to the latest day of the campaign once the first measurement is in.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (width === 0 || initializedRef.current || events.length === 0) return;
    initializedRef.current = true;
    setStart(clampStart(dayRange.max - windowDays + 2, dayRange.max, windowDays));
  }, [width, events.length, dayRange.max, windowDays]);

  // Deep link (?event=): open the event's card and center its day once the
  // stage is measured. Declared after the latest-day jump so it wins on first
  // mount; the highlight mirrors the diary deep link. The state updates run in
  // a timer so the effect itself stays free of synchronous setState.
  useEffect(() => {
    if (focusEventId == null || width === 0) return;
    const event = events.find((e) => e.id === focusEventId);
    if (!event) return;
    const openTimer = setTimeout(() => {
      setOpenEventId(event.id);
      setStart(clampStart(event.gameDay - windowDays / 2 + 0.5, dayRange.max, windowDays));
    }, 0);
    const highlightTimer = setTimeout(() => {
      const element = stageRef.current?.querySelector(`[data-event-id="${event.id}"]`);
      if (element) {
        element.classList.add('ring-2', 'ring-[var(--accent)]');
        setTimeout(() => element.classList.remove('ring-2', 'ring-[var(--accent)]'), 2000);
      }
    }, 350);
    return () => {
      clearTimeout(openTimer);
      clearTimeout(highlightTimer);
    };
  }, [focusEventId, width, events, dayRange.max, windowDays]);

  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      // Keep the window center anchored: zooming changes only the day count.
      const oldCenter = startRef.current + WINDOW_DAYS[level] / 2 - 0.5;
      const newLevel = Math.max(1, Math.min(3, level + dir));
      const newWindow = WINDOW_DAYS[newLevel];
      setLevel(newLevel);
      setStart(clampStart(oldCenter - newWindow / 2 + 0.5, dayRange.max, newWindow));
    },
    [level, dayRange.max]
  );

  // Non-passive wheel handling: plain wheel pans, Ctrl+wheel zooms. Scrollable
  // event content (opened card, group frame) consumes the wheel first so its
  // text can be scrolled instead of panning the whole timeline.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      const scroller = (e.target as Element | null)?.closest?.('.tl-scroll');
      if (scroller && scroller.scrollHeight > scroller.clientHeight) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(e.deltaY < 0 ? 1 : -1);
      } else if (pxD > 0) {
        setStart(
          clampStart(
            startRef.current - ((e.deltaY + e.deltaX) / pxD) * 1.6,
            dayRange.max,
            WINDOW_DAYS[level]
          )
        );
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [pxD, zoomBy, dayRange.max, level]);

  // Touch pinch zoom: two fingers step through the zoom levels. The stage is
  // touch-action: pan-y, so vertical scrolling (page and opened cards) stays
  // native while horizontal drags and the pinch belong to the custom handlers.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const spread = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      e.preventDefault(); // own the two-finger gesture: no native scroll/zoom
      pinchActiveRef.current = true;
      dragRef.current.active = false;
      dragRef.current.moved = true; // a pinch must not trigger the click
      pinchRef.current = { baseDist: spread(e.touches) };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinchActiveRef.current || e.touches.length < 2) return;
      e.preventDefault();
      const dist = spread(e.touches);
      const base = pinchRef.current?.baseDist ?? dist;
      if (Math.abs(dist - base) > PINCH_STEP_PX) {
        zoomBy(dist > base ? 1 : -1);
        pinchRef.current = { baseDist: dist };
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchActiveRef.current = false;
        pinchRef.current = null;
      }
    };
    stage.addEventListener('touchstart', onTouchStart, { passive: false });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    stage.addEventListener('touchend', onTouchEnd);
    stage.addEventListener('touchcancel', onTouchEnd);
    return () => {
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchmove', onTouchMove);
      stage.removeEventListener('touchend', onTouchEnd);
      stage.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoomBy]);

  // Drag panning (mouse or single-finger swipe); a real drag suppresses the
  // following click. While a pinch is active, panning pauses.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (pinchActiveRef.current) return;
      if (!dragRef.current.active || pxD === 0) return;
      const dx = e.clientX - dragRef.current.lastX;
      if (Math.abs(dx) > 3) dragRef.current.moved = true;
      dragRef.current.lastX = e.clientX;
      setStart(clampStart(startRef.current - dx / pxD, dayRange.max, WINDOW_DAYS[level]));
    };
    const onUp = () => {
      dragRef.current.active = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [pxD, dayRange.max, level]);

  // Group events per day: the first one is the visible primary, extras collapse
  // into a "+N" badge (only possible on legacy data before the grouping prompt)
  // and are listed inside the day's card/frame.
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
  const frameW = frameWidth(level, pxD);
  const evtSides = useMemo(() => alternatingSides(byDay.length), [byDay]);

  const layoutLefts = useMemo(() => {
    const pxD = pixelsPerDay(width, windowDays);
    return computeLayout({
      groups: byDay,
      sides: evtSides,
      start,
      windowDays,
      pxD,
      openEventId,
      frameW: frameWidth(level, pxD),
    });
  }, [byDay, evtSides, start, windowDays, width, openEventId, level]);

  const chapterBoxes = useMemo(
    () =>
      layoutChapterLabels(arcs, {
        start,
        windowDays,
        maxDay: dayRange.max,
        width,
        pxD: pixelsPerDay(width, windowDays),
      }),
    [arcs, start, windowDays, dayRange.max, width]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={stageRef}
        onPointerDown={(e) => {
          dragRef.current = { active: true, moved: false, lastX: e.clientX };
        }}
        onClick={(e) => {
          if (dragRef.current.moved) return;
          if (!(e.target as HTMLElement).closest('.tl-evt')) setOpenEventId(null);
        }}
        className="relative min-h-[340px] flex-1 cursor-grab touch-pan-y overflow-hidden rounded-2xl border border-violet-500/30 active:cursor-grabbing"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 15% 20%, rgba(139,92,246,.12), transparent 55%), radial-gradient(ellipse at 85% 80%, rgba(45,212,191,.10), transparent 55%), linear-gradient(180deg, #171232 0%, #0e0b21 100%)',
        }}
      >
        {/* Interaction legend (bottom-right corner) */}
        <div className="pointer-events-none absolute bottom-2 right-3 z-30 rounded-lg border border-[var(--border)] bg-[#0e0b21]/85 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400 backdrop-blur-sm">
          <p>
            <b className="text-slate-300">Mausrad / Wischen</b> · Ausschnitt bewegen
          </p>
          <p>
            <b className="text-slate-300">Strg+Mausrad / 2 Finger</b> · Zoom: Unter-Ereignisse
            aufklappen
          </p>
          <p>
            <b className="text-slate-300">Klick</b> · Details öffnen
          </p>
        </div>
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
          const label = chapterBoxes.get(arc.id);
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
                  // group frames or cards near the axis; layoutChapterLabels
                  // hides labels that would overlap each other.
                  left: label?.left ?? 0,
                  bottom: 14,
                  transform: 'translate(-50%, 0)',
                  opacity: visible && (label?.visible ?? false) ? 1 : 0,
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

        {/* Events: marker + group frame. Days outside the window plus a small
            buffer stay unmounted (DOM culling); the buffer keeps pan
            transitions smooth because they fade in before entering the view. */}
        {byDay.map(([day, group], groupIndex) => {
          if (day < start - CULL_DAYS || day > windowEnd + CULL_DAYS) return null;
          const primary = group[0];
          const extras = group.slice(1);
          const x = xOf(day);
          const visible = inWindow(day);
          const side = evtSides[groupIndex];
          const open = openEventId === primary.id;
          const isLatest = primary.id === latestId;
          const markerOffset = 'calc(50% + 26px)';
          const frameOffset = 'calc(50% + 34px)';
          return (
            <div key={primary.id}>
              {/* Level-1 marker card */}
              <div
                data-event-id={primary.id}
                className={`tl-evt absolute ${posTransition}`}
                style={{
                  left: layoutLefts.cards.get(day) ?? x - CARD_W / 2,
                  width: open ? OPEN_CARD_W : CARD_W,
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
                  aria-label={primary.title}
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
                      ? 'tl-scroll border-violet-300/70 shadow-[0_0_22px_rgba(168,85,247,.35)]'
                      : 'border-violet-400/35 shadow-[0_10px_26px_rgba(0,0,0,.45)] hover:border-violet-300/60'
                  }`}
                  style={{
                    background: 'linear-gradient(170deg, #1e1743 0%, #140f2e 100%)',
                    // From level 2 on the group frame carries the content; the
                    // marker card stays collapsed until clicked (level 1 only).
                    opacity: level >= 2 ? (open ? 1 : 0) : 1,
                    pointerEvents: level >= 2 ? (open ? 'auto' : 'none') : 'auto',
                    // Never clip at the stage edge: the open card caps at the
                    // half-stage height (pixel-based - a CSS percentage would
                    // not resolve against the auto-height parent) and scrolls
                    // internally instead of overflowing the stage. The stage is
                    // touch-action: pan-y, so this scroll also works on touch;
                    // tl-scroll lets the wheel handler skip panning here.
                    maxHeight: open ? `${Math.max(0, Math.round(size.h / 2 - 48))}px` : undefined,
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
                        <EventLinkBadges event={primary} />
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
                      <ExtraEventList extras={extras} mappings={mappings} />
                    </>
                  )}
                </div>
              </div>

              {/* Level-2/3 group frame: main event header + sub-event cards */}
              <div
                className={`tl-scroll absolute rounded-xl border border-violet-400/55 p-2.5 shadow-[0_14px_34px_rgba(0,0,0,.5),0_0_22px_rgba(168,85,247,.2)] ${posTransition}`}
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
                    <EventLinkBadges event={primary} diaryLimit={2} />
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
                <ExtraEventList extras={extras} mappings={mappings} compact />
              </div>

              {/* "+N" badge for legacy multi-event days; from level 2 on the
                  group frame lists the extras, so the badge is level-1 only. */}
              {visible && extras.length > 0 && level === 1 && (
                <button
                  type="button"
                  aria-label={`Weitere Ereignisse: ${extras.map((o) => o.title).join(', ')}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenEventId(primary.id);
                  }}
                  title={`Weitere Ereignisse: ${extras.map((o) => o.title).join(', ')}`}
                  className="absolute z-20 -translate-x-1/2 cursor-pointer rounded-full border border-violet-400/50 bg-[#221a4d] px-2 py-0.5 text-[10px] font-bold text-violet-200 shadow-lg hover:brightness-110"
                  style={{
                    left: x,
                    ...(side === 'up' ? { top: frameOffset } : { bottom: frameOffset }),
                  }}
                >
                  +{extras.length}
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
