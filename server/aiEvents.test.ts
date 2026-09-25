import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { getTimelineBroadcaster, sendTimelineStatus } from './timelineAiEvents.js';
import { getUserBroadcaster, notifyDiaryAiLog, releaseUserBroadcaster } from './diaryAiEvents.js';

function fakeSseResponse() {
  return {
    destroyed: false,
    writableEnded: false,
    write: vi.fn(() => true),
    end: vi.fn(),
  } as unknown as Response;
}

describe('structured AI event messages', () => {
  it('marks timeline completion with a machine-readable status code', () => {
    const response = fakeSseResponse();
    const remove = getTimelineBroadcaster().add(response);
    sendTimelineStatus({
      status: 'Aktualisierung der Zeitleiste abgeschlossen.',
      done: true,
      total: 0,
      current: 0,
      currentSessionName: null,
      statusCode: 'completed',
    });
    remove();

    const payload = String((response.write as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(payload).toContain('"statusCode":"completed"');
    expect(payload).toContain('"errorCode":"errors.status.completed"');
  });

  it('marks raw provider diagnostics as technical instead of translating them', () => {
    const response = fakeSseResponse();
    const broadcaster = getUserBroadcaster('event-test-user');
    const remove = broadcaster.add(response);
    notifyDiaryAiLog('event-test-user', 'error: Python traceback (technical detail)');
    releaseUserBroadcaster('event-test-user', broadcaster);
    remove();

    const payload = String((response.write as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(payload).toContain('"technical":true');
    expect(payload).toContain('Python traceback');
  });
});
