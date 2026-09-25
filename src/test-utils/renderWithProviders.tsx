/* oxlint-disable react/only-export-components -- test utilities intentionally export providers and fixtures. */

import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { vi } from 'vitest';
import type { SafeUser, Language } from '../../shared/types';
import { AuthContext, type AuthContextValue } from '../hooks/useAuth';
import { ErrorContext, type ErrorContextValue } from '../contexts/ErrorContext';
import { I18nProvider } from '../contexts/I18nProvider';
import { LANGUAGE_STORAGE_KEY } from '../i18n/language';

export function createTestUser(overrides: Partial<SafeUser> = {}): SafeUser {
  return {
    id: 'test-user',
    username: 'test-user',
    displayName: 'Test User',
    avatarUrl: null,
    isAdmin: false,
    isApproved: true,
    role: 'player',
    disabledApps: [],
    activePerson: null,
    autoSessionToDiary: false,
    autoAcceptSessionDiary: false,
    themePrimary: null,
    uiLanguage: null,
    isInitialAdmin: false,
    ...overrides,
  };
}

export function createTestAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user === undefined ? createTestUser() : overrides.user;
  return {
    user,
    effectiveUser: user,
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
    ...overrides,
  };
}

export function createTestErrorValue(
  overrides: Partial<ErrorContextValue> = {}
): ErrorContextValue {
  return {
    toast: null,
    showError: vi.fn(),
    showInfo: vi.fn(),
    showSuccess: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

export interface TestProviderOptions {
  user?: SafeUser | null;
  auth?: Partial<AuthContextValue>;
  error?: Partial<ErrorContextValue>;
  /** Set the account language; useful when the test user is authenticated. */
  language?: Language;
  /** Wrap the UI in a MemoryRouter. Set false when the caller supplies one. */
  router?: MemoryRouterProps | false;
}

export interface TestProviderProps extends TestProviderOptions {
  children: ReactNode;
}

export function TestProviders({
  children,
  user,
  auth,
  error,
  language,
  router = {},
}: TestProviderProps) {
  const baseAuth = createTestAuthValue({
    ...auth,
    ...(user !== undefined ? { user, effectiveUser: user } : {}),
  });
  const languageUser =
    language && baseAuth.user ? { ...baseAuth.user, uiLanguage: language } : baseAuth.user;
  const authValue: AuthContextValue = language
    ? {
        ...baseAuth,
        user: languageUser,
        effectiveUser: languageUser,
      }
    : baseAuth;
  const errorValue = createTestErrorValue(error);

  const content = router === false ? children : <MemoryRouter {...router}>{children}</MemoryRouter>;

  return (
    <AuthContext.Provider value={authValue}>
      <ErrorContext.Provider value={errorValue}>
        <I18nProvider>{content}</I18nProvider>
      </ErrorContext.Provider>
    </AuthContext.Provider>
  );
}

/** Render a component with the auth, error-toast, and i18n providers used by the app. */
export function renderWithProviders(
  ui: ReactElement,
  options: TestProviderOptions = {},
  renderOptions?: Omit<RenderOptions, 'wrapper'>
): RenderResult {
  if (options.language) {
    // Anonymous tests can opt into a language by setting the same public key
    // used by the application before rendering the provider.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, options.language);
  }

  return render(<TestProviders {...options}>{ui}</TestProviders>, renderOptions);
}
