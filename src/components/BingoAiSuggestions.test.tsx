import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BingoAiSuggestions } from './BingoAiSuggestions';
import { renderWithProviders } from '../test-utils';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({ request: requestMock }),
}));

interface ErrorResponse {
  error: string;
  errorCode?: string;
  messageKey?: string;
  errorParams?: Record<string, string | number | boolean | null | undefined>;
}

function mockErrorResponse(response: ErrorResponse) {
  requestMock.mockImplementation((path: string) => {
    if (path === '/api/version') {
      return Promise.resolve({ data: { aiEnabled: true }, error: null });
    }
    return Promise.resolve({ data: null, ...response });
  });
}

describe('BingoAiSuggestions error localization', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('uses the local fallback for an unknown message key', async () => {
    mockErrorResponse({
      error: 'Vorschläge konnten nicht geladen oder verarbeitet werden.',
      errorCode: 'errors.unknownSuggestionError',
      messageKey: 'errors.unknownSuggestionError',
      errorParams: { retryAfter: 5 },
    });

    renderWithProviders(<BingoAiSuggestions isSetup />, { language: 'en' });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Suggestions could not be loaded or processed.'
      );
    });
  });

  it('re-localizes a structured rate-limit response with its parameters', async () => {
    mockErrorResponse({
      error: 'Zu viele Bingo-Anfragen. Bitte später erneut versuchen.',
      errorCode: 'errors.rateLimit.bingo',
      messageKey: 'errors.rateLimit.bingo',
      errorParams: { retryAfter: 30 },
    });

    renderWithProviders(<BingoAiSuggestions isSetup />, { language: 'en' });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Too many bingo requests. Please try again later.'
      );
    });
  });
});
