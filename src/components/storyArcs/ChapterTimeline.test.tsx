import type { ComponentProps } from 'react';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils';
import type { StoryArc } from '../../../shared/types';
import { ChapterTimeline } from './ChapterTimeline';

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

function renderChapterTimeline(
  props: ComponentProps<typeof ChapterTimeline>,
  language: 'de' | 'en' = 'de'
) {
  return renderWithProviders(<ChapterTimeline {...props} />, { language, router: false });
}

describe('ChapterTimeline', () => {
  it('lists chapters chronologically with "Alle Kapitel" and "Ohne Kapitel"', () => {
    renderChapterTimeline({ arcs, selected: null, onSelect: () => {} });
    const text = screen.getByRole('group', { name: 'Kapitel wählen' }).textContent ?? '';
    expect(text.indexOf('Erstes Kapitel')).toBeLessThan(text.indexOf('Zweites Kapitel'));
    expect(text.indexOf('Zweites Kapitel')).toBeLessThan(text.indexOf('Sonderarc'));
    expect(screen.getByText('Alle Kapitel')).toBeDefined();
    expect(screen.getByText('One-Shots')).toBeDefined();
  });

  it('hides "Alle Kapitel" in assign mode and reports selections', () => {
    const onSelect = vi.fn();
    renderChapterTimeline({ arcs, selected: 2, mode: 'assign', onSelect });
    expect(screen.queryByText('Alle Kapitel')).toBeNull();

    screen.getByText('Erstes Kapitel').click();
    expect(onSelect).toHaveBeenCalledWith(1);

    screen.getByText('One-Shots').click();
    expect(onSelect).toHaveBeenCalledWith('none');
  });

  it('marks the running chapter with a green "Aktiv" badge instead of a green frame', () => {
    renderChapterTimeline({ arcs, selected: null, onSelect: () => {} });

    expect(screen.getByText('Aktiv')).toBeDefined();
    expect(screen.queryByText('Aktuell')).toBeNull();
    expect(screen.getByText('Geplant')).toBeDefined();
    expect(screen.getByText('Abgeschlossen')).toBeDefined();

    const activeButton = screen.getByText('Zweites Kapitel').closest('button');
    expect(activeButton?.className).not.toContain('outline-amber');
  });

  it('marks the picked segment with a gold frame and a check badge', () => {
    const { container } = renderChapterTimeline({ arcs, selected: 3, onSelect: () => {} });

    const pickedButton = screen.getByText('Sonderarc').closest('button');
    expect(pickedButton?.className).toContain('outline-amber-400');
    expect(container.textContent).toContain('✓');
    expect(container.querySelectorAll('span[aria-hidden="true"]').length).toBe(1);
  });

  it('shows the green "Aktiv" badge and the gold check on a chapter that is both', () => {
    renderChapterTimeline({ arcs, selected: 2, onSelect: () => {} });

    expect(screen.getByText('Aktiv')).toBeDefined();
    const activeButton = screen.getByText('Zweites Kapitel').closest('button');
    expect(activeButton?.className).toContain('outline-amber-400');
    expect(activeButton?.textContent).toContain('✓');
  });

  it('marks "Alle Kapitel" as picked when no chapter is selected', () => {
    renderChapterTimeline({ arcs, selected: null, onSelect: () => {} });

    const allButton = screen.getByText('Alle Kapitel').closest('button');
    expect(allButton?.className).toContain('outline-amber-400');
  });

  it('localizes chapter controls, statuses, and formatted game days in English', () => {
    renderChapterTimeline(
      {
        arcs: [
          arc({
            id: 1,
            name: 'English Chapter',
            chapterNumber: 1234,
            status: 'active',
            gameDayStart: 1234,
            gameDayEnd: 1240,
          }),
          arc({ id: 2, name: 'Planned Chapter', status: 'planned' }),
        ],
        selected: null,
        onSelect: () => {},
      },
      'en'
    );

    expect(screen.getByText('All chapters')).toBeDefined();
    expect(screen.getByText('Chapter 1,234')).toBeDefined();
    expect(screen.getByRole('button', { name: /English Chapter/ }).textContent).toContain(
      'Game day 1,234–1,240'
    );
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('Planned')).toBeDefined();
    expect(screen.getByText('No chapter')).toBeDefined();
    expect(screen.getByText('One-shots')).toBeDefined();
  });
});
