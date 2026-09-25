import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { toSocketErrorPayload } from './socket.js';

describe('socket error payloads', () => {
  it('keeps structured product errors intact', () => {
    expect(
      toSocketErrorPayload(
        new AppError(409, 'Board ist gesperrt.', { messageKey: 'errors.bingo.boardLocked' })
      )
    ).toEqual({
      message: 'Board ist gesperrt.',
      errorCode: 'errors.bingo.boardLocked',
      messageKey: 'errors.bingo.boardLocked',
    });
  });

  it('does not expose unexpected exception details to clients', () => {
    const payload = toSocketErrorPayload(new Error('unexpected internal detail'));

    expect(payload).toEqual({
      message: 'Internal Server Error',
      errorCode: 'errors.internal',
      messageKey: 'errors.internal',
    });
    expect(JSON.stringify(payload)).not.toContain('internal detail');
  });
});
