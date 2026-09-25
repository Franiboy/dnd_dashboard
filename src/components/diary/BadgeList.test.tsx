import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BadgeList } from './BadgeList';
import { renderWithProviders } from '../../test-utils/renderWithProviders';

const { openEntity } = vi.hoisted(() => ({ openEntity: vi.fn() }));

vi.mock('../../hooks/useEntityDialog', () => ({
  useEntityDialog: () => ({ openEntity }),
}));

function renderBadgeList(items: string[] = ['Elminster', 'Drar'], language: 'de' | 'en' = 'de') {
  return renderWithProviders(<BadgeList items={items} variant="person" />, {
    language,
    router: false,
  });
}

describe('BadgeList', () => {
  it('renders nothing for an empty list', () => {
    const { container } = renderBadgeList([]);
    expect(container.childElementCount).toBe(0);
  });

  it('collapses the badges into a count chip by default', () => {
    renderBadgeList();
    const toggle = screen.getByRole('button', { name: '2 Entitäten' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.className).toContain('md:hidden');
    expect(screen.getByText('Elminster').parentElement?.className).toContain('hidden');
    // On mobile the list dissolves into the surrounding shared chip row
    // (display:contents); on md+ it is one badge row per type.
    expect(toggle.parentElement?.className).toContain('contents');
    expect(toggle.parentElement?.className).toContain('md:flex');
  });

  it('expands the badges on click and collapses again', () => {
    renderBadgeList();
    fireEvent.click(screen.getByRole('button', { name: '2 Entitäten' }));
    expect(screen.getByRole('button', { name: '2 Entitäten' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(screen.getByText('Elminster').parentElement?.className).not.toContain('hidden');
    fireEvent.click(screen.getByRole('button', { name: '2 Entitäten' }));
    expect(screen.getByRole('button', { name: '2 Entitäten' }).getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(screen.getByText('Elminster').parentElement?.className).toContain('hidden');
  });

  it('uses English count and open labels when English is selected', () => {
    renderBadgeList(['Elminster (Grey)'], 'en');
    expect(screen.getByRole('button', { name: '1 entity' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open entity “Elminster (Grey)”' })).toBeDefined();
  });

  it('opens the parsed entity when a badge is clicked', () => {
    renderBadgeList(['Elminster (Grey)']);
    fireEvent.click(screen.getByText('Elminster (Grey)'));
    expect(openEntity).toHaveBeenCalledWith('Elminster', 'persons', undefined, 'Grey');
  });
});
