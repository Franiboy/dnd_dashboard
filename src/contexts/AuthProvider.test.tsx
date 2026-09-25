import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorProvider } from './ErrorProvider';
import { AuthProvider } from './AuthProvider';
import { useAuth } from '../hooks/useAuth';
import { LANGUAGE_STORAGE_KEY } from '../i18n/language';
import { createTestUser } from '../test-utils/renderWithProviders';

function Probe() {
  const { error, loginAdmin } = useAuth();
  return (
    <>
      <output data-testid="auth-error">{error}</output>
      <button type="button" onClick={() => void loginAdmin('admin', 'wrong')}>
        Login
      </button>
    </>
  );
}

function PendingProbe() {
  const { handleDiscordCallback } = useAuth();
  const [message, setMessage] = useState('');
  return (
    <>
      <output data-testid="pending-message">{message}</output>
      <button
        type="button"
        onClick={() => {
          void handleDiscordCallback('code', 'state').then((result) =>
            setMessage(result.message ?? '')
          );
        }}
      >
        Callback
      </button>
    </>
  );
}

function response(body: unknown, ok = false, status = ok ? 200 : 400) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

beforeEach(() => {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AuthProvider localization', () => {
  it('translates fallback and known server errors using the effective language', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/me') return response({});
      if (path === '/api/version') return response({});
      if (path === '/api/admin/login') return response({ error: 'Falsche Anmeldedaten' });
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ErrorProvider>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </ErrorProvider>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Login' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() =>
      expect(screen.getByTestId('auth-error').textContent).toBe('Invalid credentials')
    );
  });

  it('uses the structured pending-approval code from the Discord callback', async () => {
    const user = createTestUser({ uiLanguage: 'en' });
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/me') return response({}, false, 401);
      if (path === '/api/version') return response({}, true);
      if (path === '/api/auth/discord/callback') {
        return response(
          {
            error: 'Account wurde noch nicht freigegeben',
            errorCode: 'auth.accountPending',
            messageKey: 'auth.accountPending',
            user,
          },
          false,
          403
        );
      }
      return response({}, true);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ErrorProvider>
        <AuthProvider>
          <PendingProbe />
        </AuthProvider>
      </ErrorProvider>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Callback' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Callback' }));

    await waitFor(() =>
      expect(screen.getByTestId('pending-message').textContent).toBe(
        'Account has not been approved yet'
      )
    );
  });
});
