import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWhiteboard } from './useWhiteboard';
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
  useWhiteboard(createTestUser());
  return null;
}

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('useWhiteboard message localization', () => {
  it('translates structured socket errors using the active language', async () => {
    const showError = vi.fn();
    renderWithProviders(<Probe />, { language: 'en', error: { showError } });
    await waitFor(() => expect(socketMock.handlers.error).toBeDefined());

    act(() => {
      socketMock.handlers.error?.({
        message: 'Element nicht gefunden.',
        errorCode: 'errors.whiteboard.elementNotFound',
        messageKey: 'errors.whiteboard.elementNotFound',
      });
    });

    expect(showError).toHaveBeenCalledWith('Element not found.');
  });
});
