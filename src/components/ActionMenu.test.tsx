import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { renderWithProviders } from '../test-utils/renderWithProviders';
import type { Language } from '../../shared/types';

function createItems(): ActionMenuItem[] {
  return [
    { id: 'transcribe', label: 'Jetzt transkribieren', onSelect: vi.fn() },
    {
      id: 'delete',
      label: 'Session löschen',
      danger: true,
      disabled: true,
      onSelect: vi.fn(),
    },
  ];
}

function renderMenu(
  items: ActionMenuItem[],
  language: Language = 'de',
  ariaLabel: string | undefined = 'Session-Aktionen'
) {
  return renderWithProviders(<ActionMenu ariaLabel={ariaLabel} items={items} />, {
    language,
    router: false,
  });
}

describe('ActionMenu', () => {
  let items: ActionMenuItem[];

  beforeEach(() => {
    items = createItems();
  });

  it('renders only the trigger until clicked', () => {
    renderMenu(items);

    expect(screen.getByRole('button', { name: 'Session-Aktionen' })).toBeDefined();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('uses a localized default accessible name when none is supplied', () => {
    renderWithProviders(<ActionMenu items={items} />, { language: 'en', router: false });
    expect(screen.getByRole('button', { name: 'Actions' })).toBeDefined();
  });

  it('lists all items when opened', () => {
    renderMenu(items);

    fireEvent.click(screen.getByRole('button', { name: 'Session-Aktionen' }));

    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Jetzt transkribieren' })).toBeDefined();
    expect(
      (screen.getByRole('menuitem', { name: 'Session löschen' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('calls onSelect and closes the menu', () => {
    renderMenu(items);

    fireEvent.click(screen.getByRole('button', { name: 'Session-Aktionen' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Jetzt transkribieren' }));

    expect(items[0].onSelect).toHaveBeenCalledOnce();
    expect(items[1].onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderMenu(items);

    const trigger = screen.getByRole('button', { name: 'Session-Aktionen' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside the menu', () => {
    renderMenu(items);

    fireEvent.click(screen.getByRole('button', { name: 'Session-Aktionen' }));
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders nothing without items', () => {
    const { container } = renderMenu([]);

    expect(container.firstChild).toBeNull();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('disables the trigger while disabled', () => {
    renderWithProviders(<ActionMenu ariaLabel="Session-Aktionen" items={items} disabled />, {
      language: 'de',
      router: false,
    });

    const trigger = screen.getByRole('button', { name: 'Session-Aktionen' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
