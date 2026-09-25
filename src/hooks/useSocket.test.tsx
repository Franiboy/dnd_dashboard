import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSocket } from './useSocket';
import { createTestUser, renderWithProviders } from '../test-utils/renderWithProviders';

type Handler = (...args: unknown[]) => void;

const socketMock = vi.hoisted(() => {
  const handlers: Record<string, Handler> = {};
  const socket = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler;
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return { handlers, socket };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socketMock.socket),
}));

function Probe() {
  useSocket(createTestUser());
  return null;
}

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('useSocket message localization', () => {
  it.each([
    ['de', 'Name fehlt.', 'Name fehlt.'],
    ['en', 'Name fehlt.', 'Name is missing.'],
  ] as const)(
    'translates structured socket errors for %s',
    async (language, fallback, expected) => {
      const showError = vi.fn();
      renderWithProviders(<Probe />, { language, error: { showError } });
      await waitFor(() => expect(socketMock.handlers.error).toBeDefined());

      act(() => {
        socketMock.handlers.error?.({
          message: fallback,
          errorCode: 'errors.bingo.nameMissing',
          messageKey: 'errors.bingo.nameMissing',
        });
      });

      expect(showError).toHaveBeenCalledWith(expected);
    }
  );
});
