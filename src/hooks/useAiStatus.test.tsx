import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDiaryAiStatus } from './useDiaryAiStatus';
import { useTimelineAiStatus } from './useTimelineAiStatus';
import { renderWithProviders } from '../test-utils/renderWithProviders';

class MockEventSource {
  static instances: MockEventSource[] = [];
  private listeners = new Map<string, (event: Event) => void>();
  readonly url: string;
  readonly init?: EventSourceInit;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === 'function') {
      this.listeners.set(type, listener as (event: Event) => void);
    }
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  close(): void {}

  emit(type: string, data: string): void {
    const listener = this.listeners.get(type);
    if (!listener) return;
    const event = new MessageEvent(type, { data });
    listener(event);
  }
}

function DiaryProbe() {
  const { aiStatus } = useDiaryAiStatus();
  return <output data-testid="diary-status">{aiStatus ?? ''}</output>;
}

function TimelineProbe({ onDone }: { onDone: () => void }) {
  const { aiStatus } = useTimelineAiStatus(onDone);
  return <output data-testid="timeline-status">{aiStatus ?? ''}</output>;
}

afterEach(() => {
  MockEventSource.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('AI SSE message localization', () => {
  it.each([
    ['de', 'KI schreibt den Text um...', 'KI schreibt den Text um...'],
    ['en', 'KI schreibt den Text um...', 'AI is rewriting the text...'],
  ] as const)('translates diary status messages for %s', async (language, fallback, expected) => {
    vi.stubGlobal('EventSource', MockEventSource);
    const view = renderWithProviders(<DiaryProbe />, { language });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      MockEventSource.instances[0].emit(
        'log',
        JSON.stringify({
          message: fallback,
          errorCode: 'errors.status.rewriteStarted',
          messageKey: 'errors.status.rewriteStarted',
          statusCode: 'progress',
        })
      );
    });
    expect(view.getByTestId('diary-status').textContent).toBe(expected);
  });

  it('uses the structured completion marker instead of parsing translated text', async () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const onDone = vi.fn();
    const view = renderWithProviders(<TimelineProbe onDone={onDone} />, { language: 'en' });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => {
      MockEventSource.instances[0].emit(
        'log',
        JSON.stringify({
          message: 'Aktualisierung der Zeitleiste abgeschlossen.',
          errorCode: 'errors.status.completed',
          messageKey: 'errors.status.completed',
          statusCode: 'completed',
        })
      );
    });

    expect(onDone).toHaveBeenCalledOnce();
    expect(view.getByTestId('timeline-status').textContent).toBe('');
  });
});
