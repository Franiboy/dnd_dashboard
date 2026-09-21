import { describe, expect, it } from 'vitest';
import type { StoryArc, TimelineEvent } from '../../../shared/types';
import {
  CARD_W,
  CULL_DAYS,
  OPEN_CARD_W,
  PAD,
  alternatingSides,
  clampStart,
  computeDayRange,
  computeLayout,
  dayToX,
  frameWidth,
  layoutChapterLabels,
  pixelsPerDay,
} from './layout';

function event(id: number, gameDay: number): TimelineEvent {
  return {
    id,
    gameDay,
    arcId: null,
    sessionId: 1,
    sessionName: null,
    title: `Event ${id}`,
    description: null,
    generatedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenes: [],
    diaryLinks: [],
  };
}

function arc(partial: Partial<StoryArc>): StoryArc {
  return {
    id: 1,
    name: 'Arc',
    description: null,
    status: 'planned',
    chapterNumber: null,
    sessionCount: 0,
    diaryEntryCount: 0,
    entityCount: 0,
    gameDayStart: null,
    gameDayEnd: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('computeDayRange', () => {
  it('falls back to days 1-10 without events', () => {
    expect(computeDayRange([])).toEqual({ min: 1, max: 10 });
  });

  it('spans the smallest to the largest game day', () => {
    expect(computeDayRange([event(1, 7), event(2, 3), event(3, 9)])).toEqual({ min: 3, max: 9 });
  });
});

describe('clampStart', () => {
  it('clamps into the campaign range', () => {
    expect(clampStart(-5, 30, 10)).toBe(1);
    expect(clampStart(15, 30, 10)).toBe(15);
    expect(clampStart(99, 30, 10)).toBe(21);
  });

  it('stays at 1 for campaigns shorter than the window', () => {
    expect(clampStart(3, 4, 10)).toBe(1);
  });
});

describe('pixelsPerDay', () => {
  it('is 0 before the stage is measured', () => {
    expect(pixelsPerDay(0, 10)).toBe(0);
    expect(pixelsPerDay(2 * PAD, 10)).toBe(0);
  });

  it('divides the usable width by the day gaps', () => {
    expect(pixelsPerDay(1046, 10)).toBeCloseTo((1046 - 2 * PAD) / 9);
  });
});

describe('dayToX', () => {
  it('maps the window start onto the left padding', () => {
    expect(dayToX(5, 5, 100)).toBe(PAD);
  });

  it('scales days linearly', () => {
    expect(dayToX(8, 5, 100)).toBe(PAD + 300);
  });
});

describe('frameWidth', () => {
  it('never drops below the minimum', () => {
    expect(frameWidth(1, 100)).toBe(200);
  });

  it('allows the level-3 maximum for wide day spacing', () => {
    expect(frameWidth(3, 600)).toBe(470);
    expect(frameWidth(1, 600)).toBe(330);
  });
});

describe('alternatingSides', () => {
  it('alternates up/down by index', () => {
    expect(alternatingSides(3)).toEqual(['up', 'down', 'up']);
  });
});

describe('computeLayout', () => {
  const base = {
    start: 1,
    windowDays: 10,
    pxD: 100,
    openEventId: null,
    frameW: 300,
  };

  it('returns empty maps while the stage is unmeasured', () => {
    const { cards, frames } = computeLayout({
      ...base,
      groups: [[5, [event(1, 5)]]],
      sides: ['up'],
      pxD: 0,
    });
    expect(cards.size).toBe(0);
    expect(frames.size).toBe(0);
  });

  it('keeps same-side cards from overlapping', () => {
    const { cards } = computeLayout({
      ...base,
      groups: [
        [5, [event(1, 5)]],
        [6, [event(2, 6)]],
      ],
      sides: ['up', 'up'],
    });
    const first = cards.get(5)!;
    const second = cards.get(6)!;
    expect(second).toBeGreaterThanOrEqual(first + CARD_W + 8);
  });

  it('resolves sides independently', () => {
    const { cards } = computeLayout({
      ...base,
      groups: [
        [5, [event(1, 5)]],
        [6, [event(2, 6)]],
      ],
      sides: ['up', 'down'],
    });
    expect(cards.get(5)).toBe(dayToX(5, 1, 100) - CARD_W / 2);
    expect(cards.get(6)).toBe(dayToX(6, 1, 100) - CARD_W / 2);
  });

  it('gives the opened card a wider slot', () => {
    const { cards } = computeLayout({
      ...base,
      openEventId: 1,
      groups: [[5, [event(1, 5)]]],
      sides: ['up'],
    });
    expect(cards.get(5)).toBe(dayToX(5, 1, 100) - OPEN_CARD_W / 2);
  });

  it('skips hidden days so they do not push visible cards away', () => {
    const { cards } = computeLayout({
      ...base,
      start: 8,
      windowDays: 2,
      groups: [
        [5, [event(1, 5)]],
        [6, [event(2, 6)]],
        [7, [event(3, 7)]],
      ],
      sides: ['up', 'up', 'up'],
    });
    expect(cards.has(5)).toBe(false);
    expect(cards.has(6)).toBe(false);
    expect(cards.get(7)).toBe(dayToX(7, 8, 100) - CARD_W / 2);
  });

  it('lays out frames independently of cards', () => {
    const { frames } = computeLayout({
      ...base,
      groups: [[5, [event(1, 5)]]],
      sides: ['up'],
    });
    expect(frames.get(5)).toBe(dayToX(5, 1, 100) - 150);
  });
});

describe('layoutChapterLabels', () => {
  const opts = { start: 1, windowDays: 10, maxDay: 30, width: 1046, pxD: 106 };

  it('hides labels of unassigned arcs', () => {
    const boxes = layoutChapterLabels([arc({ id: 1 })], opts);
    expect(boxes.get(1)?.visible).toBe(false);
  });

  it('hides labels of segments narrower than the minimum', () => {
    const boxes = layoutChapterLabels([arc({ id: 1, gameDayStart: 5, gameDayEnd: 6 })], opts);
    expect(boxes.get(1)?.visible).toBe(false);
  });

  it('shows the label of a wide segment, centered and clamped', () => {
    const boxes = layoutChapterLabels([arc({ id: 1, gameDayStart: 1, gameDayEnd: 30 })], opts);
    const box = boxes.get(1)!;
    expect(box.visible).toBe(true);
    expect(box.left).toBeGreaterThanOrEqual(90);
    expect(box.left).toBeLessThanOrEqual(opts.width - 90);
  });

  it('hides a later label that would collide with a placed one', () => {
    const boxes = layoutChapterLabels(
      [
        arc({ id: 1, gameDayStart: 1, gameDayEnd: 10 }),
        arc({ id: 2, gameDayStart: 5, gameDayEnd: 10 }),
      ],
      { start: 1, windowDays: 10, maxDay: 30, width: 700, pxD: 68 }
    );
    expect(boxes.get(1)?.visible).toBe(true);
    expect(boxes.get(2)?.visible).toBe(false);
  });

  it('keeps non-overlapping labels visible', () => {
    const boxes = layoutChapterLabels(
      [
        arc({ id: 1, gameDayStart: 1, gameDayEnd: 30 }),
        arc({ id: 2, gameDayStart: 40, gameDayEnd: 60 }),
      ],
      { ...opts, start: 1, windowDays: 60, pxD: 20 }
    );
    expect(boxes.get(1)?.visible).toBe(true);
    expect(boxes.get(2)?.visible).toBe(true);
    expect(boxes.get(2)!.left).toBeGreaterThan(boxes.get(1)!.left);
  });
});

describe('CULL_DAYS', () => {
  it('is wider than the visibility buffer so culled days stay offscreen', () => {
    // Visibility fades at +/-1 day; culling at +/-CULL_DAYS must be stricter.
    expect(CULL_DAYS).toBeGreaterThan(1);
  });
});
