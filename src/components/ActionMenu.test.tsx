import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';

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

describe('ActionMenu', () => {
  let items: ActionMenuItem[];

  beforeEach(() => {
    items = createItems();
  });

  it('renders only the trigger until clicked', () => {
    render(<ActionMenu ariaLabel="Session-Aktionen" items={items} />);

    expect(screen.getByRole('button', { name: 'Session-Aktionen' })).toBeDefined();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists all items when opened', () => {
    render(<ActionMenu ariaLabel="Session-Aktionen" items={items} />);

    fireEvent.click(screen.getByRole('button', { name: 'Session-Aktionen' }));

    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Jetzt transkribieren' })).toBeDefined();
    expect(
      (screen.getByRole('menuitem', { name: 'Session löschen' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('calls onSelect and closes the menu', () => {
    render(<ActionMenu ariaLabel="Session-Aktionen" items={items} />);

    fireEvent.click(screen.getByRole('button', { name: 'Session-Aktionen' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Jetzt transkribieren' }));

    expect(items[0].onSelect).toHaveBeenCalledOnce();
    expect(items[1].onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<ActionMenu ariaLabel="Session-Aktionen" items={items} />);

    const trigger = screen.getByRole('button', { name: 'Session-Aktionen' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside the menu', () => {
    render(<ActionMenu ariaLabel="Session-Aktionen" items={items} />);

    fireEvent.click(screen.getByRole('button', { name: 'Session-Aktionen' }));
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders nothing without items', () => {
    const { container } = render(<ActionMenu ariaLabel="Session-Aktionen" items={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('disables the trigger while disabled', () => {
    render(<ActionMenu ariaLabel="Session-Aktionen" items={items} disabled />);

    const trigger = screen.getByRole('button', { name: 'Session-Aktionen' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
