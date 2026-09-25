import { useEffect } from 'react';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessageParams } from '../../shared/types';
import { useApi } from './useApi';
import { createTestUser, renderWithProviders } from '../test-utils/renderWithProviders';

interface ApiResult {
  error: string | null;
  errorCode?: string;
  errorParams?: ServerMessageParams;
  rawError?: string;
}

function Probe({ onResult }: { onResult: (result: ApiResult) => void }) {
  const { request } = useApi();
  useEffect(() => {
    void request('/api/test').then((result) => onResult(result as ApiResult));
  }, [onResult, request]);
  return <output data-testid="request-state">ready</output>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('useApi server message localization', () => {
  it.each([
    ['de', 'Falsche Anmeldedaten', 'Falsche Anmeldedaten'],
    ['en', 'Falsche Anmeldedaten', 'Invalid credentials'],
  ] as const)('localizes structured API errors for %s', async (language, fallback, expected) => {
    const result = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: fallback,
          errorCode: 'auth.invalidCredentials',
          messageKey: 'auth.invalidCredentials',
        }),
      })
    );
    renderWithProviders(<Probe onResult={result} />, { language });
    await waitFor(() => expect(result).toHaveBeenCalled());
    expect(result.mock.calls[0][0].error).toBe(expected);
    expect(result.mock.calls[0][0].errorCode).toBe('auth.invalidCredentials');
    expect(result.mock.calls[0][0].rawError).toBe(fallback);
  });

  it('does not guess a translation from arbitrary user content', async () => {
    const result = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Der Spieler schrieb: abgeschlossen.' }),
      })
    );
    renderWithProviders(<Probe onResult={result} />, { language: 'en' });
    await waitFor(() => expect(result).toHaveBeenCalled());
    expect(result.mock.calls[0][0].error).toBe('Der Spieler schrieb: abgeschlossen.');
  });

  it('sends the simulation context only for an administrator viewing another account', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const admin = createTestUser({ id: 'admin', isAdmin: true });
    const simulated = createTestUser({ id: 'simulated' });

    renderWithProviders(<Probe onResult={vi.fn()} />, {
      auth: { user: admin, viewAsUser: simulated, effectiveUser: simulated },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get('X-DND-View-As-User')).toBe('simulated');
  });

  it('interpolates server parameters and keeps them available to callers', async () => {
    const result = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: 'Mindestens 3 Aufgaben nötig.',
          errorCode: 'errors.bingo.minimumTasks',
          params: { count: 3 },
        }),
      })
    );
    renderWithProviders(<Probe onResult={result} />, { language: 'en', user: createTestUser() });
    await waitFor(() => expect(result).toHaveBeenCalled());
    expect(result.mock.calls[0][0].error).toBe('At least 3 tasks are required.');
    expect(result.mock.calls[0][0].errorParams).toEqual({ count: 3 });
  });
});
