import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChapterTimeline } from './ChapterTimeline';
import type { StoryArc } from '../../../shared/types';

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

const arcs = [
  arc({ id: 2, name: 'Zweites Kapitel', chapterNumber: 2, status: 'active' }),
  arc({ id: 1, name: 'Erstes Kapitel', chapterNumber: 1, status: 'completed' }),
  arc({ id: 3, name: 'Sonderarc', chapterNumber: null }),
];

describe('ChapterTimeline', () => {
  it('lists chapters chronologically with "Alle Kapitel" and "Ohne Kapitel"', () => {
    render(<ChapterTimeline arcs={arcs} selected={null} onSelect={() => {}} />);
    const text = screen.getByRole('group', { name: 'Kapitel wählen' }).textContent ?? '';
    expect(text.indexOf('Erstes Kapitel')).toBeLessThan(text.indexOf('Zweites Kapitel'));
    expect(text.indexOf('Zweites Kapitel')).toBeLessThan(text.indexOf('Sonderarc'));
    expect(screen.getByText('Alle Kapitel')).toBeDefined();
    expect(screen.getByText('One-Shots')).toBeDefined();
  });

  it('hides "Alle Kapitel" in assign mode and reports selections', () => {
    const onSelect = vi.fn();
    render(<ChapterTimeline arcs={arcs} selected={2} mode="assign" onSelect={onSelect} />);
    expect(screen.queryByText('Alle Kapitel')).toBeNull();

    screen.getByText('Erstes Kapitel').click();
    expect(onSelect).toHaveBeenCalledWith(1);

    screen.getByText('One-Shots').click();
    expect(onSelect).toHaveBeenCalledWith('none');
  });
});
