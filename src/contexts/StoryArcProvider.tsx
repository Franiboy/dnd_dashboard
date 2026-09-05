import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../hooks/useApi';
import { StoryArcContext } from './StoryArcContext';
import type { StoryArc } from '../../shared/types';

const STORAGE_KEY = 'dnd_dashboard.selectedArcId';

export type SelectedArc = number | 'none' | null;

function readStoredSelection(): SelectedArc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'none') return 'none';
    if (raw === null || raw === '') return null;
    const num = Number(raw);
    return Number.isInteger(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

interface StoryArcProviderProps {
  children: ReactNode;
}

export function StoryArcProvider({ children }: StoryArcProviderProps) {
  const { request } = useApi();
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [selectedArcId, setSelectedArcIdState] = useState<SelectedArc>(readStoredSelection);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    const { data, error } = await request<{ arcs: StoryArc[] }>('/api/story-arcs');
    const result = data?.arcs ?? [];
    // A failed request keeps the previous list instead of emptying the filter.
    if (!error && generation === generationRef.current) {
      setArcs(result);
    }
    return result;
  }, [request]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setSelectedArcId = useCallback((arcId: SelectedArc) => {
    setSelectedArcIdState(arcId);
    try {
      localStorage.setItem(STORAGE_KEY, arcId === null ? '' : String(arcId));
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still works.
    }
  }, []);

  // Drop the stored selection when the arc no longer exists. Skipped while the
  // list is empty (load failed or no arcs yet) so a transient error never
  // wipes the user's persisted choice.
  useEffect(() => {
    if (arcs.length === 0) return;
    if (typeof selectedArcId === 'number' && !arcs.some((a) => a.id === selectedArcId)) {
      setSelectedArcId(null);
    }
  }, [arcs, selectedArcId, setSelectedArcId]);

  const activeArcId = useMemo(() => arcs.find((a) => a.status === 'active')?.id ?? null, [arcs]);

  const value = useMemo(
    () => ({ arcs, activeArcId, selectedArcId, setSelectedArcId, refresh }),
    [arcs, activeArcId, selectedArcId, setSelectedArcId, refresh]
  );

  return <StoryArcContext.Provider value={value}>{children}</StoryArcContext.Provider>;
}
