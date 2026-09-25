import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nContext, type I18nContextValue } from '../i18n/I18nContext';
import { createTranslator } from '../i18n/messages';
import { AdminLogin } from './AdminLogin';
import { Login } from './Login';

function context(language: 'de' | 'en'): I18nContextValue {
  return {
    language,
    locale: language === 'de' ? 'de-DE' : 'en-US',
    t: createTranslator(language),
    setLanguage: vi.fn().mockResolvedValue(undefined),
    formatDate: vi.fn(),
    formatTime: vi.fn(),
    formatDateTime: vi.fn(),
    formatNumber: vi.fn(),
  };
}

function withI18n(language: 'de' | 'en', children: React.ReactNode) {
  return <I18nContext.Provider value={context(language)}>{children}</I18nContext.Provider>;
}

describe('public authentication language surfaces', () => {
  it('shows a visible language selector and localized login copy', () => {
    render(withI18n('en', <Login onDiscordLogin={vi.fn()} error={null} />));

    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDefined();
    expect(screen.getByText('Sign in with Discord to continue')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in with Discord' })).toBeDefined();
  });

  it('localizes the admin login labels and password toggle', () => {
    render(
      withI18n(
        'en',
        <MemoryRouter>
          <AdminLogin onLogin={vi.fn()} error={null} />
        </MemoryRouter>
      )
    );

    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeDefined();
    expect(screen.getByPlaceholderText('Username')).toBeDefined();
    expect(screen.getByPlaceholderText('Password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Show' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('button', { name: 'Hide' })).toBeDefined();
  });
});
