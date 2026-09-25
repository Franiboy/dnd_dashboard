import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n';
import { WhiteboardImageServerError, localizeWhiteboardImageError } from './imageUpload';

const fallback = 'Upload failed.';

describe('localizeWhiteboardImageError', () => {
  it('retains structured server metadata and localizes it', () => {
    const error = new WhiteboardImageServerError(
      {
        error: 'Zu viele Uploads. Bitte später erneut versuchen.',
        errorCode: 'errors.rateLimit.upload',
        messageKey: 'errors.rateLimit.upload',
        params: { retryAfter: 30 },
      },
      fallback
    );

    expect(error.message).toBe(fallback);
    expect(error.serverPayload).toMatchObject({
      errorCode: 'errors.rateLimit.upload',
      messageKey: 'errors.rateLimit.upload',
      params: { retryAfter: 30 },
    });
    expect(error.errorCode).toBe('errors.rateLimit.upload');
    expect(error.messageKey).toBe('errors.rateLimit.upload');
    expect(error.params).toEqual({ retryAfter: 30 });
    expect(localizeWhiteboardImageError(error, createTranslator('en'), fallback)).toBe(
      'Too many uploads. Please try again later.'
    );
  });

  it('uses the localized fallback when the server has no message metadata', () => {
    const error = new WhiteboardImageServerError({ error: 'Serverfehler' }, fallback);

    expect(localizeWhiteboardImageError(error, createTranslator('en'), fallback)).toBe(fallback);
  });
});
