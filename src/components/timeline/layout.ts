import type { StoryArc, TimelineEvent } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Pure geometry of the horizontal campaign timeline ("Arkan-Chronik"):
// window math, card/frame overlap resolution and chapter label placement.
// Kept free of React so it can be unit-tested (see layout.test.ts).
// ---------------------------------------------------------------------------

/** Horizontal padding of the stage: the leyline starts/ends here. */
export const PAD = 46;
/** Width of a collapsed level-1 marker card. */
export const CARD_W = 176;
/** Widened slot of the opened card so the description has room. */
export const OPEN_CARD_W = 340;
/** Visible days per detail level; zooming shows fewer days -> more room. */
export const WINDOW_DAYS: Record<number, number> = { 1: 10, 2: 5, 3: 2 };
/**
 * Days rendered beyond the visible window on each side (DOM culling buffer):
 * far-offscreen days stay unmounted, the buffer keeps pan transitions smooth.
 */
export const CULL_DAYS = 2;

export type TimelineSide = 'up' | 'down';

export function computeDayRange(events: Pick<TimelineEvent, 'gameDay'>[]): {
  min: number;
  max: number;
} {
  if (events.length === 0) return { min: 1, max: 10 };
  const days = events.map((e) => e.gameDay);
  return { min: Math.min(...days), max: Math.max(...days) };
}

/** Start of the window, clamped to the campaign (1 when the campaign is short). */
export function clampStart(v: number, maxDay: number, windowDays: number): number {
  return Math.max(1, Math.min(maxDay - windowDays + 1, v));
}

/** Pixels between two adjacent days; 0 while the stage is unmeasured. */
export function pixelsPerDay(width: number, windowDays: number): number {
  return width > 2 * PAD ? (width - 2 * PAD) / (windowDays - 1) : 0;
}

export function dayToX(day: number, start: number, pxD: number): number {
  return PAD + (day - start) * pxD;
}

/** Frame width adapts to the day spacing so adjacent days never collide. */
export function frameWidth(level: number, pxD: number): number {
  return Math.max(200, Math.min(level >= 3 ? 470 : 330, pxD - 24));
}

/** Events alternate above/below the axis by their day index. */
export function alternatingSides(count: number): TimelineSide[] {
  return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 'up' : 'down') as TimelineSide);
}

export interface LayoutOptions {
  /** [gameDay, events of that day] pairs, day-ascending. */
  groups: [number, TimelineEvent[]][];
  /** Side per group index (see alternatingSides). */
  sides: TimelineSide[];
  start: number;
  windowDays: number;
  pxD: number;
  openEventId: number | null;
  frameW: number;
}

export interface DayLayout {
  cards: Map<number, number>;
  frames: Map<number, number>;
}

/**
 * Sequential overlap resolution per side: cards and frames of same-side
 * events never overlap horizontally (the pin keeps its true axis position;
 * only the card/frame and its stem shift to the next free slot).
 */
export function computeLayout(opts: LayoutOptions): DayLayout {
  const { groups, sides, start, windowDays, pxD, openEventId, frameW } = opts;
  const cards = new Map<number, number>();
  const frames = new Map<number, number>();
  if (pxD === 0) return { cards, frames };
  const windowEnd = start + windowDays - 1;
  for (const side of ['up', 'down'] as const) {
    let prevRight = -Infinity;
    let prevFrameRight = -Infinity;
    groups.forEach(([day, group], i) => {
      if (sides[i] !== side) return;
      // Hidden events must not consume slots and push visible events offstage.
      if (day < start - 1 || day > windowEnd + 1) return;
      const x = dayToX(day, start, pxD);
      // The opened card gets a wider slot so the description has room.
      const cardW = group[0].id === openEventId ? OPEN_CARD_W : CARD_W;
      const cardLeft = Math.max(x - cardW / 2, prevRight + 8);
      cards.set(day, cardLeft);
      prevRight = cardLeft + cardW;
      const frameLeft = Math.max(x - frameW / 2, prevFrameRight + 8);
      frames.set(day, frameLeft);
      prevFrameRight = frameLeft + frameW;
    });
  }
  return { cards, frames };
}

export interface ChapterLabelBox {
  arcId: number;
  /** Clamped horizontal center of the label. */
  left: number;
  visible: boolean;
}

/**
 * Positions the chapter labels at the bottom edge and hides the ones that
 * would collide with an already placed neighbour (left-to-right by game day).
 * Label width is estimated from its segment span, since the rendered text
 * width is unknown before paint.
 */
export function layoutChapterLabels(
  arcs: StoryArc[],
  opts: { start: number; windowDays: number; maxDay: number; width: number; pxD: number }
): Map<number, ChapterLabelBox> {
  const { start, windowDays, maxDay, width, pxD } = opts;
  const windowEnd = start + windowDays - 1;
  const boxes = new Map<number, ChapterLabelBox>();
  if (pxD === 0) return boxes;
  const sorted = [...arcs].sort(
    (a, b) => (a.gameDayStart ?? Infinity) - (b.gameDayStart ?? Infinity)
  );
  let prevRight = -Infinity;
  for (const arc of sorted) {
    if (arc.gameDayStart === null) {
      boxes.set(arc.id, { arcId: arc.id, left: 0, visible: false });
      continue;
    }
    const from = Math.max(arc.gameDayStart, start);
    const to = Math.min(arc.gameDayEnd ?? maxDay, windowEnd);
    const x1 = dayToX(from, start, pxD);
    const x2 = dayToX(to, start, pxD);
    const left = Math.max(90, Math.min(width - 90, (x1 + x2) / 2));
    const halfW = Math.min(140, Math.max(60, (x2 - x1) / 2));
    // Same narrow-segment fade as before, plus the collision pass.
    const visible = from <= to && x2 - x1 > 130 && left - halfW > prevRight + 8;
    if (visible) prevRight = left + halfW;
    boxes.set(arc.id, { arcId: arc.id, left, visible });
  }
  return boxes;
}
