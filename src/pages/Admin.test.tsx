import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, renderWithProviders } from '../test-utils/renderWithProviders';
import { Admin } from './Admin';

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

const currentUser = createTestUser({
  id: 'current-admin',
  displayName: 'Current Admin',
  isAdmin: true,
  role: 'dungeon_master',
});

const targetUser = createTestUser({
  id: 'target-user',
  displayName: 'Ada',
  isApproved: false,
  role: 'player',
  activePerson: 'Lyra',
});

function response(data: unknown) {
  return Promise.resolve({ data, error: null });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function renderAdmin(language: 'de' | 'en') {
  return renderWithProviders(<Admin currentUser={currentUser} />, {
    user: currentUser,
    language,
    router: false,
  });
}

async function finishInitialLoad() {
  await waitFor(() =>
    expect(MockEventSource.instances.some((source) => source.url.includes('/users/events'))).toBe(
      true
    )
  );
  const source = MockEventSource.instances.find((item) => item.url.includes('/users/events'));
  expect(source).toBeDefined();
  act(() => source?.emit('users', [targetUser]));
  await waitFor(() => expect(screen.getByText('Ada')).toBeDefined());
  await waitFor(() => expect(requestMock).toHaveBeenCalled());
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === '/api/entities') return response({ persons: [{ name: 'Lyra', qualifier: '' }] });
    if (path === '/api/admin/ai/models') {
      return response({ models: ['model-a', 'model-b'], model: 'model-a', modelOverridden: false });
    }
    if (path === '/api/admin/ai/language') return response({ language: 'de' });
    if (path === '/api/recordings/status') {
      return response({
        bot: { enabled: true, ready: true },
        active: null,
        monitoredChannel: { channelId: 'channel-1', channelName: 'Table' },
      });
    }
    if (path === '/api/recordings/channels') {
      return response({ channels: [{ id: 'channel-1', name: 'Table', participants: ['a', 'b'] }] });
    }
    if (path === '/api/recordings/config') return response({ channelId: 'channel-1' });
    if (path.startsWith('/api/admin/logs?')) return response({ logs: [], hasMore: false });
    return response(null);
  });
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Admin localization', () => {
  it('renders the German portal, user table, app access dialog, and session settings', async () => {
    renderAdmin('de');
    await finishInitialLoad();

    expect(screen.getByRole('button', { name: 'Hintergrundjobs' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'KI-Modell' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Anzeigename' })).toBeDefined();
    expect(screen.getByText('Wartend')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Hintergrundjobs' }));
    expect(screen.getByRole('heading', { name: 'Nightly-Job' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Nightly-Job starten' })).toBeDefined();
    expect(screen.getAllByText('Bereit')).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: 'Rolle von Ada' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Spieler' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Charakter von Ada' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Lyra' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen für Ada' }));
    expect(screen.getByRole('menuitem', { name: 'Apps' })).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Apps' }));
    expect(screen.getByRole('dialog', { name: 'Apps für Ada' })).toBeDefined();
    expect(screen.getByText('Tagebuch')).toBeDefined();
    expect(screen.getByText('6 von 6 Apps aktiv')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Alle deaktivieren' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(screen.getByLabelText('Überwachter Voice-Channel')).toBeDefined();
    expect(screen.getByRole('option', { name: 'Table (2 online)' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDefined();
  });

  it('renders English labels, preserves user data, and localizes the native delete confirmation', async () => {
    renderAdmin('en');
    await finishInitialLoad();

    expect(screen.getByRole('button', { name: 'Background jobs' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'AI model' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Background jobs' }));
    expect(screen.getByRole('heading', { name: 'Nightly job' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Start nightly job' })).toBeDefined();
    expect(screen.getAllByText('Ready')).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: 'Display name' })).toBeDefined();
    expect(screen.getByText('Ada')).toBeDefined();
    expect(screen.getByText('Pending')).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Role for Ada' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Player' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Character for Ada' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Ada' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Apps' }));
    expect(screen.getByRole('dialog', { name: 'Apps for Ada' })).toBeDefined();
    expect(screen.getByText('Diary')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Ada' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(confirmMock).toHaveBeenCalledWith('Really delete?');

    fireEvent.click(screen.getByRole('button', { name: 'AI model' }));
    expect(screen.getByText('AI language')).toBeDefined();
    expect(screen.getByRole('option', { name: 'English' })).toBeDefined();
  });

  it('serializes rapid AI language saves and ignores an older response', async () => {
    const first = deferred<{ data: unknown; error: null }>();
    const second = deferred<{ data: unknown; error: null }>();
    renderAdmin('en');
    await finishInitialLoad();

    let putCount = 0;
    requestMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === '/api/admin/ai/language' && options?.method === 'PUT') {
        putCount += 1;
        return putCount === 1 ? first.promise : second.promise;
      }
      return response(null);
    });

    fireEvent.click(screen.getByRole('button', { name: 'AI model' }));
    const selector = await screen.findByRole('combobox', { name: 'AI language' });
    fireEvent.change(selector, { target: { value: 'en' } });
    fireEvent.change(selector, { target: { value: 'de' } });

    await waitFor(() => expect(putCount).toBe(1));
    const firstPut = requestMock.mock.calls.find(
      ([path, options]) =>
        path === '/api/admin/ai/language' && (options as RequestInit | undefined)?.method === 'PUT'
    );
    expect(firstPut?.[1]).toEqual(
      expect.objectContaining({ body: JSON.stringify({ language: 'en' }) })
    );

    await act(async () => {
      first.resolve({ data: { language: 'en' }, error: null });
      await first.promise;
    });

    await waitFor(() => expect(putCount).toBe(2));
    expect((selector as HTMLSelectElement).value).toBe('de');
    const putCalls = requestMock.mock.calls.filter(
      ([path, options]) =>
        path === '/api/admin/ai/language' && (options as RequestInit | undefined)?.method === 'PUT'
    );
    expect(putCalls).toHaveLength(2);
    expect(putCalls[1]?.[1]).toEqual(
      expect.objectContaining({ body: JSON.stringify({ language: 'de' }) })
    );

    await act(async () => {
      second.resolve({ data: { language: 'de' }, error: null });
      await second.promise;
    });
    await waitFor(() => expect((selector as HTMLSelectElement).value).toBe('de'));
  });

  it('falls back to a legacy job message when metadata is missing', async () => {
    renderAdmin('en');
    await finishInitialLoad();
    requestMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === '/api/admin/nightly-job' && options?.method === 'POST') {
        return response({ started: true, message: 'Nightly-Job wurde gestartet.' });
      }
      return response(null);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Background jobs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start nightly job' }));

    expect(await screen.findByText('Nightly job started.')).toBeDefined();
  });

  it('localizes job success messages from message metadata', async () => {
    renderAdmin('en');
    await finishInitialLoad();
    requestMock.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method !== 'POST') return response(null);
      const jobMessages: Record<string, { key: string; fallback: string }> = {
        '/api/admin/nightly-job': {
          key: 'errors.status.nightlyStarted',
          fallback: 'Nightly-Job wurde gestartet.',
        },
        '/api/admin/transcription-jobs': {
          key: 'errors.status.transcriptionStarted',
          fallback: 'Transkription-Jobs wurden gestartet.',
        },
        '/api/admin/bingo-suggestion-refill': {
          key: 'errors.status.bingoRefillStarted',
          fallback: 'Bingo-Vorschlags-Nachfüllung wurde gestartet.',
        },
      };
      const message = jobMessages[path];
      if (!message) return response(null);
      return response({
        started: true,
        message: message.fallback,
        messageKey: message.key,
        errorCode: message.key,
        params: { source: 'test' },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Background jobs' }));
    const jobs = [
      ['Start nightly job', 'Nightly job started.'],
      ['Start transcription', 'Transcription jobs started.'],
      ['Generate bingo suggestions', 'Bingo suggestion refill started.'],
    ] as const;

    for (const [buttonName, message] of jobs) {
      fireEvent.click(screen.getByRole('button', { name: buttonName }));
      await waitFor(() => expect(screen.getByText(message)).toBeDefined());
    }

    expect(screen.queryByText('Nightly-Job wurde gestartet.')).toBeNull();
    expect(screen.queryByText('Transkription-Jobs wurden gestartet.')).toBeNull();
    expect(screen.queryByText('Bingo-Vorschlags-Nachfüllung wurde gestartet.')).toBeNull();
  });
});
