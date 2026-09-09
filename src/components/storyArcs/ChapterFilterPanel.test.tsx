import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SideDrawer, SideDrawerItem } from '../SideDrawer';
import { StoryArcContext, type StoryArcContextValue } from '../../contexts/StoryArcContext';
import type { StoryArc } from '../../../shared/types';
import { ChapterFilterIcon, ChapterFilterPanel } from './ChapterFilterPanel';

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

/** Same composition as on the Sessions, Diary and World pages. */
function renderDrawer(overrides: Partial<StoryArcContextValue> = {}) {
  return render(
    <StoryArcContext.Provider value={contextValue(overrides)}>
      <SideDrawer side="right">
        <SideDrawerItem id="kapitel" label="Kapitel" icon={<ChapterFilterIcon />}>
          <ChapterFilterPanel />
        </SideDrawerItem>
      </SideDrawer>
    </StoryArcContext.Provider>
  );
}

describe('ChapterFilterPanel', () => {
  it('shows a rail button and opens the vertical chapter list on click', () => {
    renderDrawer();

    const railButton = screen.getByText('Kapitel').closest('button');
    expect(railButton).not.toBeNull();
    expect(screen.queryByText('✦ Die Kampagne')).toBeNull();

    fireEvent.click(railButton!);
    expect(screen.getByText('✦ Die Kampagne')).toBeDefined();
    expect(screen.getByText('Alle Kapitel')).toBeDefined();
    expect(screen.getByText('Erstes Kapitel')).toBeDefined();
    expect(screen.getByText('Ohne Kapitel')).toBeDefined();
  });

  it('reports chapter selections through the story-arc context', () => {
    const setSelectedArcId = vi.fn();
    renderDrawer({ selectedArcId: 1, setSelectedArcId });

    fireEvent.click(screen.getByText('Kapitel'));

    fireEvent.click(screen.getByText('Zweites Kapitel'));
    expect(setSelectedArcId).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByText('Alle Kapitel'));
    expect(setSelectedArcId).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByText('One-Shots'));
    expect(setSelectedArcId).toHaveBeenCalledWith('none');
  });
});
