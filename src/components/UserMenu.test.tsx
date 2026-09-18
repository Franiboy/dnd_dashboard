import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserMenu } from './UserMenu';
import { AuthContext, type AuthContextValue } from '../hooks/useAuth';
import { ErrorContext, type ErrorContextValue } from '../contexts/ErrorContext';
import { ThemeContext, type ThemeContextValue } from '../hooks/useTheme';
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
  themePrimary: null,
  isInitialAdmin: false,
};

const authValue: AuthContextValue = {
  user: baseUser,
  effectiveUser: baseUser,
  viewAsUser: null,
  setViewAsUser: vi.fn(),
  clearViewAsUser: vi.fn(),
  loading: false,
  error: null,
  loginAdmin: vi.fn(),
  handleDiscordCallback: vi.fn(),
  startDiscordLogin: vi.fn(),
  logout: vi.fn(),
  checkApproved: vi.fn(),
  updateUser: vi.fn(),
  setError: vi.fn(),
};

const errorValue: ErrorContextValue = {
  toast: null,
  showError: vi.fn(),
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
  clearError: vi.fn(),
};

function themeValue(overrides: Partial<ThemeContextValue> = {}): ThemeContextValue {
  return {
    themePrimary: null,
    preview: null,
    previewTheme: vi.fn(),
    endPreview: vi.fn(),
    ...overrides,
  };
}

function renderMenu(user: SafeUser = baseUser, theme: ThemeContextValue = themeValue()) {
  return render(
    <AuthContext.Provider value={{ ...authValue, user }}>
      <ErrorContext.Provider value={errorValue}>
        <ThemeContext.Provider value={theme}>
          <UserMenu user={user} onLogout={() => {}} />
        </ThemeContext.Provider>
      </ErrorContext.Provider>
    </AuthContext.Provider>
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
}

describe('UserMenu', () => {
  it('shows only the avatar trigger until clicked', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'Benutzermenü' })).toBeDefined();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu with name, role and logout on click', () => {
    renderMenu();

    openMenu();

    expect(screen.getByRole('menu')).toBeDefined();
    expect(screen.getByText('Franiboy')).toBeDefined();
    expect(screen.getByText('Spieler')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Logout/ })).toBeDefined();
  });

  it('shows the dungeon master role label', () => {
    renderMenu({ ...baseUser, role: 'dungeon_master' });

    openMenu();
    expect(screen.getByText('Dungeon Master')).toBeDefined();
  });

  it('combines admin flag and role in the label', () => {
    renderMenu({ ...baseUser, isAdmin: true });

    openMenu();
    expect(screen.getByText('Admin · Spieler')).toBeDefined();
  });

  it('calls onLogout and closes the menu', () => {
    const onLogout = vi.fn();
    render(
      <AuthContext.Provider value={authValue}>
        <ErrorContext.Provider value={errorValue}>
          <ThemeContext.Provider value={themeValue()}>
            <UserMenu user={baseUser} onLogout={onLogout} />
          </ThemeContext.Provider>
        </ErrorContext.Provider>
      </AuthContext.Provider>
    );

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Logout/ }));

    expect(onLogout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders the simulation exit action only while simulating', () => {
    const onExitSimulation = vi.fn();
    const { rerender } = renderMenu();

    openMenu();
    expect(screen.queryByRole('menuitem', { name: /simulieren/ })).toBeNull();

    rerender(
      <AuthContext.Provider value={authValue}>
        <ErrorContext.Provider value={errorValue}>
          <ThemeContext.Provider value={themeValue()}>
            <UserMenu user={baseUser} onLogout={() => {}} onExitSimulation={onExitSimulation} />
          </ThemeContext.Provider>
        </ErrorContext.Provider>
      </AuthContext.Provider>
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /simulieren/ }));
    expect(onExitSimulation).toHaveBeenCalledOnce();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderMenu();

    const trigger = screen.getByRole('button', { name: 'Benutzermenü' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside the menu', () => {
    renderMenu();

    openMenu();
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('UserMenu theme picker', () => {
  it('shows preset swatches and hides reset when no color is set', () => {
    renderMenu();

    openMenu();
    expect(screen.getByText('Design-Farbe')).toBeDefined();
    expect(screen.getByLabelText('Eigene Farbe wählen')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Design-Farbe #/ })).toHaveLength(8);
  });

  it('previews a preset color on click', () => {
    const previewTheme = vi.fn();
    renderMenu(baseUser, themeValue({ previewTheme }));

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Design-Farbe #3b82f6' }));

    expect(previewTheme).toHaveBeenCalledWith('#3b82f6');
  });

  it('previews lowercase custom colors from the free picker', () => {
    const previewTheme = vi.fn();
    renderMenu(baseUser, themeValue({ previewTheme }));

    openMenu();
    const picker = screen.getByLabelText('Eigene Farbe wählen');
    fireEvent.change(picker, { target: { value: '#ABCDEF' } });

    expect(previewTheme).toHaveBeenCalledWith('#abcdef');
  });

  it('shows reset while a color is active and previews null on click', () => {
    const previewTheme = vi.fn();
    renderMenu(baseUser, themeValue({ themePrimary: '#22c55e', previewTheme }));

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }));

    expect(previewTheme).toHaveBeenCalledWith(null);
  });

  it('marks the saved color as pressed', () => {
    renderMenu(baseUser, themeValue({ themePrimary: '#ef4444' }));

    openMenu();
    const selected = screen.getByRole('button', { name: 'Design-Farbe #ef4444' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
  });
});
