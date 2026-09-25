import { useCallback, useEffect, useRef } from 'react';
import type { ServerMessageParams } from '../../shared/types';
import {
  getServerMessageCode,
  getServerMessageKey,
  getServerMessagePayload,
  localizeServerMessage,
  type ServerMessageLike,
} from '../i18n/serverMessages';
import { useError } from './useError';
import { useI18n } from './useI18n';

export interface ApiResponse<T> {
  data: T | null;
  /** Localized text for UI callers. */
  error: string | null;
  /** Stable machine-readable server metadata, retained for programmatic callers. */
  errorCode?: string;
  messageKey?: string;
  errorParams?: ServerMessageParams;
  /** Alias matching the wire payload field for callers that pass metadata on. */
  params?: ServerMessageParams;
  /** Original server text for logging/diagnostics; never use this for UI text. */
  rawError?: string;
}

interface ErrorResponseBody {
  error?: unknown;
  message?: unknown;
  errorCode?: unknown;
  messageKey?: unknown;
  params?: unknown;
}

function asPayload(value: unknown): ServerMessageLike | null {
  const payload = getServerMessagePayload(value);
  if (payload) return payload;
  if (value && typeof value === 'object') {
    const body = value as ErrorResponseBody;
    if (typeof body.error === 'string' || typeof body.message === 'string') {
      const error = typeof body.error === 'string' ? body.error : undefined;
      const message = typeof body.message === 'string' ? body.message : error;
      return {
        message,
        error,
        errorCode: typeof body.errorCode === 'string' ? body.errorCode : undefined,
        messageKey: typeof body.messageKey === 'string' ? body.messageKey : undefined,
        params:
          body.params && typeof body.params === 'object'
            ? (body.params as ServerMessageParams)
            : undefined,
      };
    }
  }
  return null;
}

function getRawError(payload: ServerMessageLike | null, fallback: string): string {
  if (typeof payload?.error === 'string' && payload.error) return payload.error;
  if (typeof payload?.message === 'string' && payload.message) return payload.message;
  return fallback;
}

function makeResponseError(
  payload: ServerMessageLike | null,
  t: ReturnType<typeof useI18n>['t']
): {
  error: string;
  errorCode?: string;
  messageKey?: string;
  errorParams?: ServerMessageParams;
  params?: ServerMessageParams;
  rawError: string;
} {
  const rawError = getRawError(payload, '');
  const localized = localizeServerMessage(payload, t, { fallback: rawError });
  const error = localized ?? t('common.unknownError');
  const errorCode = getServerMessageCode(payload);
  const messageKey = getServerMessageKey(payload) ?? undefined;
  return {
    error,
    ...(errorCode ? { errorCode } : {}),
    ...(messageKey ? { messageKey } : {}),
    ...(payload?.params !== undefined
      ? { errorParams: payload.params, params: payload.params }
      : {}),
    rawError: rawError || error,
  };
}

export function useApi() {
  const { showError } = useError();
  const { t } = useI18n();
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const request = useCallback(
    async <T>(path: string, options?: RequestInit, notify = true): Promise<ApiResponse<T>> => {
      try {
        const res = await fetch(path, {
          ...options,
          credentials: options?.credentials ?? 'include',
        });

        if (res.ok) {
          const data = (await res.json()) as T;
          return { data, error: null };
        }

        const body = (await res.json().catch(() => ({}))) as unknown;
        const payload = asPayload(body);
        const responseError = makeResponseError(payload, tRef.current);
        if (notify) showError(responseError.error);
        return { data: null, ...responseError };
      } catch {
        const payload: ServerMessageLike = {
          message: 'Server nicht erreichbar',
          errorCode: 'common.serverUnavailable',
          messageKey: 'common.serverUnavailable',
        };
        const responseError = makeResponseError(payload, tRef.current);
        if (notify) showError(responseError.error);
        return { data: null, ...responseError };
      }
    },
    [showError]
  );

  return { request };
}
