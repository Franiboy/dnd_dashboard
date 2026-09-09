import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChapterChip } from './ChapterChip';
import type { StoryArc } from '../../../shared/types';

function arc(partial: Partial<StoryArc>): StoryArc {
  return {
    id: 1,
    name: 'Chaos in Brüden',
    description: null,
    status: 'active',
    chapterNumber: 2,
    sessionCount: 0,
    diaryEntryCount: 0,
    entityCount: 0,
    gameDayStart: 3,
    gameDayEnd: 7,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('ChapterChip', () => {
  it('shows chapter number and arc name', () => {
    render(<ChapterChip arc={arc({})} />);
    expect(screen.getByText('Kapitel 2 ·')).toBeDefined();
    expect(screen.getByText('Chaos in Brüden')).toBeDefined();
  });

  it('omits the chapter label for unnumbered arcs', () => {
    render(<ChapterChip arc={arc({ chapterNumber: null })} />);
    expect(screen.queryByText('Kapitel 2 ·')).toBeNull();
    expect(screen.getByText('Chaos in Brüden')).toBeDefined();
  });

  it('renders the dashed "Ohne Kapitel" chip without an arc', () => {
    render(<ChapterChip arc={null} />);
    expect(screen.getByText('Ohne Kapitel')).toBeDefined();
  });

  it('reports clicks when rendered as a trigger', () => {
    const onClick = vi.fn();
    render(<ChapterChip arc={arc({})} onClick={onClick} />);
    screen.getByText('Chaos in Brüden').click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
