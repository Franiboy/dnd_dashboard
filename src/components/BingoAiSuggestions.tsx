import { useCallback, useEffect, useState } from 'react';
import type { BingoSuggestion, TaskAudience, VersionInfo } from '../../shared/types';
import { useApi } from '../hooks/useApi';
import { Loading } from './Loading';

interface BingoAiSuggestionsProps {
  isSetup: boolean;
  /** Which suggestion pool to show; the server enforces permissions. */
  audience?: TaskAudience;
}

export function BingoAiSuggestions({ isSetup, audience }: BingoAiSuggestionsProps) {
  const { request } = useApi();
  const [suggestions, setSuggestions] = useState<BingoSuggestion[]>([]);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);

  const fetchVersion = useCallback(() => {
    return request<VersionInfo>('/api/version', undefined, false).then(({ data }) => {
      setAiEnabled(!!data?.aiEnabled);
    });
  }, [request]);

  const fetchSuggestions = useCallback(() => {
    return request<{ suggestions: BingoSuggestion[] }>(
      audience ? `/api/bingo/suggestions?audience=${audience}` : '/api/bingo/suggestions',
      undefined,
      false
    ).then(({ data, error: reqError }) => {
      setSuggestions(data?.suggestions ?? []);
      setError(reqError);
      setLoading(false);
    });
  }, [request, audience]);

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
      const { error } = await request(`/api/bingo/suggestions/${id}/accept`, { method: 'POST' });
      if (!error) {
        await fetchSuggestions();
      }
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async (id: number) => {
    if (processingId !== null) return;
    setProcessingId(id);
    try {
      const { error } = await request(`/api/bingo/suggestions/${id}/reject`, { method: 'POST' });
      if (!error) {
        await fetchSuggestions();
      }
    } finally {
      setProcessingId(null);
    }
  };

  if (!isSetup) return null;

  if (aiEnabled === null) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <Loading text="Lade KI-Status..." size="sm" />
      </div>
    );
  }

  if (aiEnabled === false) {
    return (
      <div className="text-slate-500 text-sm">
        KI-Vorschläge sind nicht verfügbar, weil die KI nicht konfiguriert ist.
      </div>
    );
  }

  const isBusy = processingId !== null;

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-slate-400 text-sm">
          Vorgenerierte Vorschläge basierend auf Entitäten und aktuellen Aufgaben.
        </span>
      </div>

      {loading && suggestions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <Loading text="Vorschläge laden..." size="sm" />
        </div>
      ) : error && !loading && suggestions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--danger)] text-sm text-center gap-2 min-h-0">
          <p>{error}</p>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm text-center gap-2 min-h-0">
          <p>Keine Vorschläge verfügbar.</p>
          <p>Sie werden im Hintergrund vorgeneriert.</p>
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
                    onClick={() => accept(suggestion.id)}
                    disabled={isBusy}
                    title="Als Aufgabe übernehmen"
                    className="px-2 py-1 rounded bg-[var(--accent)] text-slate-900 text-xs font-semibold hover:bg-green-400 transition disabled:opacity-50"
                  >
                    {isProcessing ? '...' : '+'}
                  </button>
                  <button
                    onClick={() => reject(suggestion.id)}
                    disabled={isBusy}
                    title="Vorschlag ablehnen"
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
