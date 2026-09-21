import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppSwitcher } from './AppSwitcher';
import { TestResizeObserver } from '../vitest.setup';
import type { SafeUser, VersionInfo } from '../../shared/types';

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
  themePrimary: null,
  isInitialAdmin: false,
};

const version: VersionInfo = { aiEnabled: true, recordingEnabled: false };

function renderSwitcher(user: SafeUser = baseUser) {
  return render(
    <MemoryRouter initialEntries={['/tagebuch']}>
      <AppSwitcher user={user} version={version} />
    </MemoryRouter>
  );
}

describe('AppSwitcher', () => {
  it('shows the collapsed app picker trigger without an open menu', () => {
    renderSwitcher();

    expect(screen.getByRole('button', { name: 'App-Auswahl' })).toBeDefined();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a popup listing every visible app with the current one highlighted', () => {
    renderSwitcher({ ...baseUser, isAdmin: true, role: 'dungeon_master' });

    fireEvent.click(screen.getByRole('button', { name: 'App-Auswahl' }));

    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    // Tagebuch, Bingo, Welt, Zeitleiste, Sessions, Whiteboard, Admin
    expect(items).toHaveLength(7);
    expect(within(menu).getByRole('menuitem', { name: 'Tagebuch' }).className).toContain(
      'bg-[var(--accent)]/20'
    );
  });

  it('hides apps the user may not see (recording disabled, no character)', () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'App-Auswahl' }));

    const menu = screen.getByRole('menu');
    // recordingEnabled=false hides Sessions; player without character hides Tagebuch.
    expect(within(menu).queryByRole('menuitem', { name: 'Sessions' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Tagebuch' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Admin' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Bingo' })).toBeDefined();
  });

  it('closes the popup when an app is chosen', () => {
    renderSwitcher({ ...baseUser, isAdmin: true });

    fireEvent.click(screen.getByRole('button', { name: 'App-Auswahl' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Bingo' }));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on a click outside', () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'App-Auswahl' }));
    expect(screen.getByRole('menu')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'App-Auswahl' }));
    expect(screen.getByRole('menu')).toBeDefined();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the mobile picker touch-sized and anchors its scrollable menu to the header', () => {
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: 'App-Auswahl' });
    expect(trigger.classList.contains('size-11')).toBe(true);
    expect(trigger.parentElement!.classList.contains('relative')).toBe(false);
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu.classList.contains('inset-x-3')).toBe(true);
    expect(menu.classList.contains('overflow-y-auto')).toBe(true);
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item.classList.contains('min-h-11')).toBe(true);
    }
  });

  it('renders the icon rail with every visible app for wide screens', () => {
    renderSwitcher({ ...baseUser, isAdmin: true });

    const rail = document.querySelector('nav');
    expect(rail).not.toBeNull();
    expect(within(rail as HTMLElement).getAllByRole('link')).toHaveLength(7);
  });

  it('collapses the rail to the popup when the apps do not fit the header slot', () => {
    renderSwitcher({ ...baseUser, isAdmin: true });

    const nav = document.querySelector('nav') as HTMLElement;
    const root = nav.parentElement as HTMLElement;
    const inner = nav.firstElementChild as HTMLElement;
    const trigger = screen.getByRole('button', { name: 'App-Auswahl' });

    // Rail wider than the slot: the rail turns invisible and the popup
    // trigger becomes the visible variant.
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue({ width: 800 } as DOMRect);
    vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(400);
    act(() => TestResizeObserver.latest!.trigger());

    expect(nav.className).toContain('invisible');
    expect(trigger.parentElement!.className).not.toContain('hidden');

    // The popup opens while collapsed...
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    // Space frees up (resize, an app disappears): the rail comes back, the
    // popup trigger is display:none and an open menu closes instead of
    // floating orphaned in the header.
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect);
    vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(400);
    act(() => TestResizeObserver.latest!.trigger());

    expect(nav.className).not.toContain('invisible');
    expect(trigger.parentElement!.className).toContain('hidden');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
