import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserMenu } from './UserMenu';
import type { SafeUser } from '../../shared/types';

const baseUser: SafeUser = {
  id: 'u1',
  username: 'franiboy',
  displayName: 'Franiboy',
  avatarUrl: null,
  isAdmin: false,
  isApproved: true,
  role: 'player',
  disabledApps: [],
  activePerson: null,
  autoSessionToDiary: false,
  autoAcceptSessionDiary: false,
  isInitialAdmin: false,
};

describe('UserMenu', () => {
  it('shows only the avatar trigger until clicked', () => {
    render(<UserMenu user={baseUser} onLogout={() => {}} />);

    expect(screen.getByRole('button', { name: 'Benutzermenü' })).toBeDefined();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu with name, role and logout on click', () => {
    render(<UserMenu user={baseUser} onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));

    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.getByText('Franiboy')).toBeDefined();
    expect(screen.getByText('Spieler')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Logout/ })).toBeDefined();
  });

  it('shows the dungeon master role label', () => {
    render(<UserMenu user={{ ...baseUser, role: 'dungeon_master' }} onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(screen.getByText('Dungeon Master')).toBeDefined();
  });

  it('combines admin flag and role in the label', () => {
    render(<UserMenu user={{ ...baseUser, isAdmin: true }} onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(screen.getByText('Admin · Spieler')).toBeDefined();
  });

  it('calls onLogout and closes the menu', () => {
    const onLogout = vi.fn();
    render(<UserMenu user={baseUser} onLogout={onLogout} />);

    fireEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Logout/ }));

    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders the simulation exit action only while simulating', () => {
    const onExitSimulation = vi.fn();
    const { rerender } = render(<UserMenu user={baseUser} onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(screen.queryByRole('menuitem', { name: /simulieren/ })).toBeNull();

    rerender(<UserMenu user={baseUser} onLogout={() => {}} onExitSimulation={onExitSimulation} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /simulieren/ }));
    expect(onExitSimulation).toHaveBeenCalledOnce();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<UserMenu user={baseUser} onLogout={() => {}} />);

    const trigger = screen.getByRole('button', { name: 'Benutzermenü' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside the menu', () => {
    render(<UserMenu user={baseUser} onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
