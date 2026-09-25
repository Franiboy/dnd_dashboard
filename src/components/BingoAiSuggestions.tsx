import { useCallback, useEffect, useState } from 'react';
import type { BingoSuggestion, TaskAudience, VersionInfo } from '../../shared/types';
import type { TFunction, TranslationKey } from '../i18n/messages';
import { useApi, type ApiResponse } from '../hooks/useApi';
import { useI18n } from '../hooks/useI18n';
import { localizeServerMessage } from '../i18n/serverMessages';
import { Loading } from './Loading';

interface BingoAiSuggestionsProps {
  isSetup: boolean;
  /** Which suggestion pool to show; the server enforces permissions. */
  audience?: TaskAudience;
}

type LocalizedApiError = Pick<
  ApiResponse<unknown>,
  'error' | 'errorCode' | 'messageKey' | 'errorParams' | 'params'
>;

function localizeApiError(
  response: LocalizedApiError,
  t: TFunction,
  fallbackKey: TranslationKey
): string | null {
  const { error, errorCode, messageKey, errorParams, params } = response;
  if (!error) return null;
  if (!messageKey && !errorCode) return error;

  return (
    localizeServerMessage(
      {
        message: error,
        errorCode,
        messageKey,
        params: errorParams ?? params,
      },
      t,
      { fallback: error, fallbackKey }
    ) ?? t(fallbackKey)
  );
}

export function BingoAiSuggestions({ isSetup, audience }: BingoAiSuggestionsProps) {
  const { request } = useApi();
  const { t } = useI18n();
  const [suggestions, setSuggestions] = useState<BingoSuggestion[]>([]);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);

  const fetchVersion = useCallback(() => {
    return request<VersionInfo>('/api/version', undefined, false).then((response) => {
      const { data } = response;
      if (response.error) {
        setStatusError(localizeApiError(response, t, 'bingo.suggestions.statusError'));
        setAiEnabled(false);
        return;
      }
      setStatusError(null);
      setAiEnabled(!!data?.aiEnabled);
    });
  }, [request, t]);

  const fetchSuggestions = useCallback(() => {
    return request<{ suggestions: BingoSuggestion[] }>(
      audience ? `/api/bingo/suggestions?audience=${audience}` : '/api/bingo/suggestions',
      undefined,
      false
    ).then((response) => {
      setSuggestions(response.data?.suggestions ?? []);
      setLoadError(localizeApiError(response, t, 'bingo.suggestions.error'));
      setLoading(false);
    });
  }, [request, audience, t]);

  useEffect(() => {
    fetchVersion();
  }, [fetchVersion]);

  useEffect(() => {
    if (!isSetup) return;
    if (aiEnabled === null) return;
    if (!aiEnabled) return;

    fetchSuggestions();
    const id = setInterval(fetchSuggestions, 5000);
    return () => clearInterval(id);
  }, [isSetup, aiEnabled, fetchSuggestions, audience]);

  const accept = async (id: number) => {
    if (processingId !== null) return;
    setProcessingId(id);
    try {
      const response = await request(
        `/api/bingo/suggestions/${id}/accept`,
        { method: 'POST' },
        false
      );
      if (!response.error) {
        setLoadError(null);
        await fetchSuggestions();
      } else {
        setLoadError(localizeApiError(response, t, 'bingo.suggestions.error'));
      }
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async (id: number) => {
    if (processingId !== null) return;
    setProcessingId(id);
    try {
      const response = await request(
        `/api/bingo/suggestions/${id}/reject`,
        { method: 'POST' },
        false
      );
      if (!response.error) {
        setLoadError(null);
        await fetchSuggestions();
      } else {
        setLoadError(localizeApiError(response, t, 'bingo.suggestions.error'));
      }
    } finally {
      setProcessingId(null);
    }
  };

  if (!isSetup) return null;

  if (aiEnabled === null) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <Loading text={t('bingo.suggestions.loadingStatus')} size="sm" />
      </div>
    );
  }

  if (aiEnabled === false) {
    return (
      <div className="text-slate-500 text-sm">
        {statusError ?? t('bingo.suggestions.unavailable')}
      </div>
    );
  }

  const isBusy = processingId !== null;

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-slate-400 text-sm">{t('bingo.suggestions.description')}</span>
      </div>

      {loadError && (
        <p role="alert" className="text-[var(--danger)] text-sm text-center">
          {loadError}
        </p>
      )}

      {loading && suggestions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <Loading text={t('bingo.suggestions.loading')} size="sm" />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm text-center gap-2 min-h-0">
          <p>{t('bingo.suggestions.empty')}</p>
          <p>{t('bingo.suggestions.generating')}</p>
        </div>
      ) : (
        <ul className="flex-1 min-h-0 overflow-auto space-y-2">
          {suggestions.map((suggestion) => {
            const isProcessing = processingId === suggestion.id;
            return (
              <li
                key={suggestion.id}
                className="flex items-start justify-between gap-2 p-2 rounded bg-slate-900/50 border border-[var(--border)] group"
              >
                <span className="text-[var(--text-h)] text-sm leading-tight">
                  {suggestion.text}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => accept(suggestion.id)}
                    disabled={isBusy}
                    title={t('bingo.suggestions.accept')}
                    aria-label={t('bingo.suggestions.accept')}
                    className="px-2 py-1 rounded bg-[var(--accent)] text-[var(--accent-contrast)] text-xs font-semibold hover:brightness-110 transition disabled:opacity-50"
                  >
                    {isProcessing ? '...' : '+'}
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(suggestion.id)}
                    disabled={isBusy}
                    title={t('bingo.suggestions.reject')}
                    aria-label={t('bingo.suggestions.reject')}
                    className="px-2 py-1 rounded bg-slate-800 text-[var(--danger)] text-xs font-semibold hover:bg-slate-700 transition disabled:opacity-50"
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
