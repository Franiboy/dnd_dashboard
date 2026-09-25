import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nContext, type I18nContextValue } from '../i18n/I18nContext';
import { createTranslator } from '../i18n/messages';
import { AuthCallback } from './AuthCallback';

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

function callbackTree(
  language: 'de' | 'en',
  onCallback: () => Promise<{ ok: boolean; pending?: boolean; message?: string }>
) {
  return (
    <MemoryRouter initialEntries={['/auth/callback?code=callback-code&state=callback-state']}>
      <I18nContext.Provider value={context(language)}>
        <AuthCallback onCallback={onCallback} />
      </I18nContext.Provider>
    </MemoryRouter>
  );
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('AuthCallback', () => {
  it('does not reprocess the callback when the language changes', async () => {
    const onCallback = vi.fn().mockResolvedValue({
      ok: false,
      pending: false,
      message: 'Account wurde noch nicht freigegeben',
    });
    const view = render(callbackTree('de', onCallback));

    await waitFor(() => expect(onCallback).toHaveBeenCalledOnce());
    expect(screen.getByText('Account wurde noch nicht freigegeben')).toBeDefined();
    expect(sessionStorage.getItem('discord_code_processed')).toBe('callback-code');

    view.rerender(callbackTree('en', onCallback));

    expect(screen.getByText('Account has not been approved yet')).toBeDefined();
    expect(onCallback).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('discord_code_processed')).toBe('callback-code');
  });
});
