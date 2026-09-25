import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test-utils/renderWithProviders';
import { LogPanel } from './LogPanel';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useApi', () => ({
  useApi: () => ({ request: requestMock }),
}));

type Listener = (event: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  private readonly listeners = new Map<string, Listener>();

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
  }

  close() {}

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
}

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const log = {
  id: 1,
  timestamp: '2026-01-02T12:34:56.000Z',
  level: 'warn' as const,
  category: 'auth',
  message: 'Server message stays unchanged',
  args: ['server argument'],
};

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ data: { logs: [log], hasMore: false }, error: null });
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LogPanel', () => {
  it('localizes controls, levels, categories, labels, and timestamps in German', async () => {
    renderWithProviders(<LogPanel />, { language: 'de', router: false });

    expect(screen.getByRole('heading', { name: 'Server-Logs' })).toBeDefined();
    expect(screen.getByLabelText('Log-Level')).toBeDefined();
    expect(screen.getByRole('option', { name: 'Alle' })).toBeDefined();
    expect(screen.getByText('Auto-Scroll')).toBeDefined();

    await waitFor(() => expect(screen.getByText('[WARNUNG]')).toBeDefined());
    expect(screen.getByText('[Authentifizierung]')).toBeDefined();
    expect(screen.getByText('Server message stays unchanged')).toBeDefined();
    expect(
      screen.getByText(
        new Intl.DateTimeFormat('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date(log.timestamp))
      )
    ).toBeDefined();
  });

  it('uses English labels while preserving unknown server categories and log data', async () => {
    const unknownCategoryLog = { ...log, category: 'custom-category', level: 'error' as const };
    requestMock.mockResolvedValue({
      data: { logs: [unknownCategoryLog], hasMore: false },
      error: null,
    });

    renderWithProviders(<LogPanel />, { language: 'en', router: false });

    expect(screen.getByRole('heading', { name: 'Server logs' })).toBeDefined();
    expect(screen.getByLabelText('Log level')).toBeDefined();
    expect(screen.getByRole('option', { name: 'All' })).toBeDefined();
    expect(screen.getByText('Auto-scroll')).toBeDefined();

    await waitFor(() => expect(screen.getByText('[ERROR]')).toBeDefined());
    expect(screen.getByText('[custom-category]')).toBeDefined();
    expect(screen.getByText('Server message stays unchanged')).toBeDefined();
  });
});
