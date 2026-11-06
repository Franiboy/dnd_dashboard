import { describe, expect, it } from 'vitest';
import { isDiscardableEmptyAutoSession } from './autoRecording.js';

const START = '2026-11-05T15:46:01.304Z';

describe('isDiscardableEmptyAutoSession', () => {
  it('keeps manually created sessions', () => {
    expect(isDiscardableEmptyAutoSession('user-123', START, '2026-11-05T15:46:11.836Z')).toBe(
      false
    );
  });

  it('discards short auto sessions without audio', () => {
    expect(isDiscardableEmptyAutoSession('auto', START, '2026-11-05T15:46:11.836Z')).toBe(true);
  });

  it('discards auto sessions up to the two minute window', () => {
    expect(isDiscardableEmptyAutoSession('auto', START, '2026-11-05T15:48:01.304Z')).toBe(true);
  });

  it('keeps longer auto sessions so real capture failures stay visible', () => {
    expect(isDiscardableEmptyAutoSession('auto', START, '2026-11-05T15:48:01.305Z')).toBe(false);
  });

  it('keeps sessions with invalid timestamps', () => {
    expect(isDiscardableEmptyAutoSession('auto', 'not-a-date', '2026-11-05T15:46:11.836Z')).toBe(
      false
    );
    expect(isDiscardableEmptyAutoSession('auto', START, 'not-a-date')).toBe(false);
  });

  it('keeps sessions that stop before they start', () => {
    expect(isDiscardableEmptyAutoSession('auto', START, '2026-11-05T15:45:00.000Z')).toBe(false);
  });
});
