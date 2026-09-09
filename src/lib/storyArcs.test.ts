import { describe, expect, it } from 'vitest';
import { arcMatchesFilter, formatArcLabel, sortArcsChronologically } from './storyArcs';
import type { StoryArc } from '../../shared/types';

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

describe('arcMatchesFilter', () => {
  it('filters by selection including the "none" sentinel', () => {
    expect(arcMatchesFilter(null, 1)).toBe(true);
    expect(arcMatchesFilter(1, 1)).toBe(true);
    expect(arcMatchesFilter(1, 2)).toBe(false);
    expect(arcMatchesFilter('none', null)).toBe(true);
    expect(arcMatchesFilter('none', 1)).toBe(false);
  });
});

describe('formatArcLabel', () => {
  it('includes the chapter number and the game-day range', () => {
    expect(
      formatArcLabel(
        arc({ name: 'Chaos in Brüden', chapterNumber: 2, gameDayStart: 3, gameDayEnd: 7 })
      )
    ).toBe('Kapitel 2 · Chaos in Brüden · Spieltag 3–7');
  });

  it('omits chapter prefix and range when absent', () => {
    expect(formatArcLabel(arc({ name: 'One-Shot-Arc' }))).toBe('One-Shot-Arc');
  });
});

describe('sortArcsChronologically', () => {
  it('orders numbered arcs first, unnumbered ones last', () => {
    const sorted = sortArcsChronologically([
      arc({ id: 3, chapterNumber: null, gameDayStart: 1 }),
      arc({ id: 2, chapterNumber: 2, name: 'Zwei' }),
      arc({ id: 1, chapterNumber: 1, name: 'Eins' }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it('falls back to game-day and creation date for unnumbered arcs', () => {
    const sorted = sortArcsChronologically([
      arc({ id: 2, gameDayStart: 5, createdAt: '2026-01-02T00:00:00.000Z' }),
      arc({ id: 1, gameDayStart: 2, createdAt: '2026-02-01T00:00:00.000Z' }),
      arc({ id: 3, gameDayStart: null, createdAt: '2025-01-01T00:00:00.000Z' }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual([1, 2, 3]);
  });
});
