import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StoryArcContext, type StoryArcContextValue } from '../contexts/StoryArcContext';
import type { StoryArc } from '../../shared/types';
import { StoryArcFilter } from './StoryArcFilter';

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
  arc({ id: 1, name: 'Erstes Kapitel', chapterNumber: 1, status: 'active' }),
  arc({ id: 2, name: 'Zweites Kapitel', chapterNumber: 2 }),
];

function contextValue(overrides: Partial<StoryArcContextValue> = {}): StoryArcContextValue {
  return {
    arcs,
    activeArcId: 1,
    selectedArcId: null,
    setSelectedArcId: vi.fn(),
    refresh: vi.fn().mockResolvedValue(arcs),
    ...overrides,
  };
}

function renderFilter(overrides: Partial<StoryArcContextValue> = {}) {
  return render(
    <StoryArcContext.Provider value={contextValue(overrides)}>
      <StoryArcFilter />
    </StoryArcContext.Provider>
  );
}

describe('StoryArcFilter', () => {
  it('shows the current selection in the trigger and opens the timeline below the header', () => {
    const { container } = renderFilter();
    expect(screen.getByText('Alle Kapitel')).toBeDefined();
    expect(screen.queryByText('✦ Die Kampagne')).toBeNull();

    fireEvent.click(screen.getByText('Alle Kapitel'));
    expect(screen.getByText('✦ Die Kampagne')).toBeDefined();
    expect(screen.getByText('Erstes Kapitel')).toBeDefined();
    expect(screen.getByText('Ohne Kapitel')).toBeDefined();
    // The panel is an absolute full-width strip anchored below the header.
    expect(container.querySelector('.absolute.top-full')).not.toBeNull();
  });

  it('allows a long chapter selection to shrink without losing the full title', () => {
    const name = 'A very long chapter name '.repeat(12);
    renderFilter({ arcs: [arc({ id: 1, name })], selectedArcId: 1 });
    const label = screen.getByText(name.trim());
    const trigger = label.closest('button')!;
    expect(label.classList.contains('truncate')).toBe(true);
    expect(trigger.title).toContain(name);
    expect(trigger.classList.contains('min-h-11')).toBe(true);
    expect(trigger.parentElement!.classList.contains('min-w-0')).toBe(true);
    expect(trigger.parentElement!.classList.contains('shrink-0')).toBe(false);
  });

  it('reports a chapter selection through the story-arc context and closes', () => {
    const setSelectedArcId = vi.fn();
    renderFilter({ selectedArcId: 1, setSelectedArcId });
    expect(screen.getByText('Erstes Kapitel')).toBeDefined();

    fireEvent.click(screen.getByText('Erstes Kapitel'));
    fireEvent.click(screen.getByText('Zweites Kapitel'));
    expect(setSelectedArcId).toHaveBeenCalledWith(2);
    expect(screen.queryByText('✦ Die Kampagne')).toBeNull();
  });

  it('reports "Alle Kapitel" and "Ohne Kapitel" selections through the context', () => {
    const setSelectedArcId = vi.fn();
    const { rerender } = renderFilter({ selectedArcId: 1, setSelectedArcId });

    fireEvent.click(screen.getByText('Erstes Kapitel'));
    fireEvent.click(screen.getByText('Alle Kapitel'));
    expect(setSelectedArcId).toHaveBeenCalledWith(null);

    rerender(
      <StoryArcContext.Provider value={contextValue({ selectedArcId: 1, setSelectedArcId })}>
        <StoryArcFilter />
      </StoryArcContext.Provider>
    );
    fireEvent.click(screen.getByText('Erstes Kapitel'));
    fireEvent.click(screen.getByText('One-Shots'));
    expect(setSelectedArcId).toHaveBeenCalledWith('none');
  });
});
