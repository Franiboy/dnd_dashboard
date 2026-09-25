import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SafeUser } from '../../shared/types';
import { I18nProvider } from '../contexts/I18nProvider';
import { ErrorContext, type ErrorContextValue } from '../contexts/ErrorContext';
import { AuthContext, type AuthContextValue } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { LANGUAGE_STORAGE_KEY, getEffectiveLanguage, normalizeLanguage } from './index';
import { createTranslator, translate } from './messages';
import { localizeServerMessage } from './serverMessages';

const baseUser: SafeUser = {
  id: 'real-user',
  username: 'real',
  displayName: 'Real User',
  avatarUrl: null,
  isAdmin: true,
  isApproved: true,
  role: 'player',
  disabledApps: [],
  activePerson: null,
  autoSessionToDiary: false,
  autoAcceptSessionDiary: false,
  themePrimary: null,
  uiLanguage: 'de',
  isInitialAdmin: false,
};

const errorValue: ErrorContextValue = {
  toast: null,
  showError: vi.fn(),
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
  clearError: vi.fn(),
};

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user !== undefined ? overrides.user : baseUser;
  return {
    user,
    effectiveUser: overrides.viewAsUser ?? user,
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

function Probe() {
  const i18n = useI18n();
  return (
    <div>
      <output data-testid="language">{i18n.language}</output>
      <output data-testid="locale">{i18n.locale}</output>
      <output data-testid="translated">{i18n.t('common.welcome', { name: 'Ada' })}</output>
      <output data-testid="number">{i18n.formatNumber(1234.5)}</output>
      <button type="button" onClick={() => void i18n.setLanguage('en')}>
        Set English
      </button>
      <button type="button" onClick={() => void i18n.setLanguage('de')}>
        Set German
      </button>
    </div>
  );
}

function renderProvider(value: AuthContextValue, errorOverrides: Partial<ErrorContextValue> = {}) {
  return render(
    <AuthContext.Provider value={value}>
      <ErrorContext.Provider value={{ ...errorValue, ...errorOverrides }}>
        <I18nProvider>
          <Probe />
        </I18nProvider>
      </ErrorContext.Provider>
    </AuthContext.Provider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('i18n messages', () => {
  it('normalizes only German and English browser values', () => {
    expect(normalizeLanguage('de-DE')).toBe('de');
    expect(normalizeLanguage('en_US')).toBe('en');
    expect(normalizeLanguage('fr-FR')).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });

  it('interpolates placeholders and selects plural variants', () => {
    expect(translate('de', 'common.welcome', { name: 'Ada' })).toBe('Willkommen, Ada!');
    expect(translate('de', 'common.items', { count: 1 })).toBe('1 Element');
    expect(translate('en', 'common.items', { count: 2 })).toBe('2 items');
  });

  it('formats numeric interpolation values in the active locale', () => {
    expect(translate('de', 'shell.chapterFilter.gameDay', { day: 1234 })).toContain('1.234');
    expect(translate('en', 'shell.chapterFilter.gameDay', { day: 1234 })).toContain('1,234');
  });

  it('falls back to the other supported locale for missing keys', () => {
    expect(translate('en', 'common.germanOnly')).toBe('Nur auf Deutsch verfügbar');
  });

  it.each([
    [
      'Vorschläge können nur während des Setups annehmen werden',
      'Suggestions can only be accepted during setup.',
    ],
    [
      'Vorschläge können nur während des Setups ablehnen werden',
      'Suggestions can only be rejected during setup.',
    ],
    [
      'Vorschläge können nur während des Setups aktualisieren werden',
      'Suggestions can only be refreshed during setup.',
    ],
  ])('maps legacy Bingo setup errors in English: %s', (fallback, expected) => {
    expect(localizeServerMessage(fallback, createTranslator('en'))).toBe(expected);
  });

  it('formats structured lockout timestamps in the active locale', () => {
    const payload = {
      message: 'Account ist gesperrt bis 2026-09-24T14:00:00.000Z',
      messageKey: 'auth.accountLocked',
      params: { until: '2026-09-24T14:00:00.000Z' },
    };
    const german = localizeServerMessage(payload, createTranslator('de'));
    const english = localizeServerMessage(payload, createTranslator('en'));

    expect(german).toContain('24.09.2026');
    expect(english).toContain('Sep 24, 2026');
  });
});

describe('I18nProvider', () => {
  it('uses the saved anonymous language before login', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    renderProvider(authValue({ user: null, effectiveUser: null }));

    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(screen.getByTestId('locale').textContent).toBe('en-US');
    expect(document.documentElement.lang).toBe('en');
  });

  it('prefers the real user language after login', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    const real = { ...baseUser, uiLanguage: 'de' as const };
    renderProvider(authValue({ user: real, effectiveUser: real }));

    expect(screen.getByTestId('language').textContent).toBe('de');
  });

  it('prefers the simulated user language during simulation', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const real = { ...baseUser, uiLanguage: 'de' as const };
    const simulated = { ...baseUser, id: 'simulated', uiLanguage: 'en' as const };
    const value = authValue({ user: real, viewAsUser: simulated, effectiveUser: simulated });

    renderProvider(value);
    expect(screen.getByTestId('language').textContent).toBe('en');
  });

  it('uses the anonymous selection when a simulated account has automatic language selection', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    const real = { ...baseUser, uiLanguage: 'de' as const };
    const simulated = { ...baseUser, id: 'simulated', uiLanguage: null };
    const value = authValue({ user: real, viewAsUser: simulated, effectiveUser: simulated });

    renderProvider(value);
    expect(screen.getByTestId('language').textContent).toBe('en');
  });

  it('persists a language change and updates the real user, not a simulated account', async () => {
    const updateUser = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { ...baseUser, uiLanguage: 'en' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const real = { ...baseUser, uiLanguage: 'de' as const };
    const simulated = { ...baseUser, id: 'simulated', uiLanguage: 'en' as const };
    const value = authValue({
      user: real,
      viewAsUser: simulated,
      effectiveUser: simulated,
      updateUser,
    });

    renderProvider(value);
    fireEvent.click(screen.getByRole('button', { name: 'Set English' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/ui-language',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ language: 'en' }),
      })
    );
    expect(updateUser).toHaveBeenCalledWith({ uiLanguage: 'en' });
    expect(screen.getByTestId('language').textContent).toBe('en');
  });

  it('serializes rapid account language saves and keeps the latest optimistic selection', async () => {
    const first = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const second = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);
    const updateUser = vi.fn();
    const real = { ...baseUser, uiLanguage: 'de' as const };

    renderProvider(authValue({ user: real, effectiveUser: real, updateUser }));
    fireEvent.click(screen.getByRole('button', { name: 'Set English' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set German' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/me/ui-language',
      expect.objectContaining({ body: JSON.stringify({ language: 'en' }) })
    );

    await act(async () => {
      first.resolve({ ok: true, json: async () => ({ user: { ...real, uiLanguage: 'en' } }) });
      await first.promise;
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/me/ui-language',
      expect.objectContaining({ body: JSON.stringify({ language: 'de' }) })
    );
    expect(screen.getByTestId('language').textContent).toBe('de');

    await act(async () => {
      second.resolve({ ok: true, json: async () => ({ user: { ...real, uiLanguage: 'de' } }) });
      await second.promise;
    });

    await waitFor(() => expect(updateUser).toHaveBeenLastCalledWith({ uiLanguage: 'de' }));
    expect(screen.getByTestId('language').textContent).toBe('de');
  });

  it('passes a stable key when an account language save fails', async () => {
    const showError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );
    const user = { ...baseUser, uiLanguage: 'de' as const };

    renderProvider(authValue({ user, effectiveUser: user }), { showError });
    fireEvent.click(screen.getByRole('button', { name: 'Set English' }));

    await waitFor(() => expect(showError).toHaveBeenCalledWith('common.languageSaveError'));
  });

  it('persists an explicit pre-login selection after authentication', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { ...baseUser, uiLanguage: 'en' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const automaticUser = { ...baseUser, uiLanguage: null };

    renderProvider(authValue({ user: automaticUser, effectiveUser: automaticUser }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/ui-language',
      expect.objectContaining({ body: JSON.stringify({ language: 'en' }) })
    );
  });

  it('exposes locale-aware number formatting', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    renderProvider(authValue({ user: null, effectiveUser: null }));
    expect(screen.getByTestId('number').textContent).toBe('1.234,5');
  });
});

describe('language selection helpers', () => {
  it('does not fall through to the real account when a simulated account is automatic', () => {
    const real = { uiLanguage: 'en' as const };
    const simulated = { uiLanguage: null };
    expect(getEffectiveLanguage(simulated, real, 'de')).toBe('de');
  });
});
