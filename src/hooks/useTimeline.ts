import { useCallback, useEffect, useState } from 'react';
import type { TimelineEvent } from '../../shared/types';
import { useApi } from './useApi';
import { useError } from './useError';

interface TimelineResponse {
  events: TimelineEvent[];
  pendingCount: number;
  running: boolean;
  aiEnabled: boolean;
}

/**
 * Timeline data of the campaign: notable events (AI-generated from session
 * summaries) plus the pending count for the "Zeitleiste aktualisieren"
 * button. Filtering by chapter happens in the page via the global filter.
 */
export function useTimeline() {
  const { request } = useApi();
  const { showError } = useError();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const applyData = useCallback((data: TimelineResponse) => {
    setEvents(data.events);
    setPendingCount(data.pendingCount);
    setRunning(data.running);
    setAiEnabled(data.aiEnabled);
  }, []);

  const loadTimeline = useCallback(async () => {
    const { data, error } = await request<TimelineResponse>('/api/timeline');
    if (data) applyData(data);
    setLoading(false);
    if (error) showError(error);
  }, [request, showError, applyData]);

  useEffect(() => {
    // Inline .then chain: the lint's data-flow analysis tracks promise
    // callbacks, unlike a discarded async loader call.
    request<TimelineResponse>('/api/timeline').then(({ data }) => {
      if (data) applyData(data);
      setLoading(false);
    });
  }, [request, applyData]);

  /**
   * Admin action: refresh/extend the timeline for all pending sessions.
   * Progress arrives via the SSE stream; the page reloads once the run
   * reports completion.
   */
  async function regenerate(): Promise<boolean> {
    const { data, error } = await request<{ started: boolean; pendingCount: number }>(
      '/api/timeline/generate',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    if (data) {
      setPendingCount(data.pendingCount);
      setRunning(true);
      return true;
    }
    if (error) {
      showError(error);
    }
    return false;
  }

  return {
    events,
    pendingCount,
    running,
    aiEnabled,
    loading,
    loadTimeline,
    regenerate,
  };
}
