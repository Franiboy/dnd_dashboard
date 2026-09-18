import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BadgeList } from './BadgeList';

const { openEntity } = vi.hoisted(() => ({ openEntity: vi.fn() }));

vi.mock('../../hooks/useEntityDialog', () => ({
  useEntityDialog: () => ({ openEntity }),
}));

function renderBadgeList(items: string[] = ['Elminster', 'Drar']) {
  return render(<BadgeList items={items} variant="person" />);
}

describe('BadgeList', () => {
  it('renders nothing for an empty list', () => {
    const { container } = renderBadgeList([]);
    expect(container.childElementCount).toBe(0);
  });

  it('collapses the badges into a count chip by default', () => {
    renderBadgeList();
    const toggle = screen.getByRole('button', { name: '+2' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.className).toContain('md:hidden');
    expect(screen.getByText('Elminster').parentElement?.className).toContain('hidden');
  });

  it('expands the badges on click and collapses again', () => {
    renderBadgeList();
    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    expect(screen.getByRole('button', { name: '−2' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Elminster').parentElement?.className).not.toContain('hidden');
    fireEvent.click(screen.getByRole('button', { name: '−2' }));
    expect(screen.getByRole('button', { name: '+2' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Elminster').parentElement?.className).toContain('hidden');
  });

  it('opens the parsed entity when a badge is clicked', () => {
    renderBadgeList(['Elminster (Grey)']);
    fireEvent.click(screen.getByText('Elminster (Grey)'));
    expect(openEntity).toHaveBeenCalledWith('Elminster', 'persons', undefined, 'Grey');
  });
});
