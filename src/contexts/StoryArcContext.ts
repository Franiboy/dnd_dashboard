import { createContext } from 'react';
import type { StoryArc } from '../../shared/types';

export interface StoryArcContextValue {
  arcs: StoryArc[];
  /** The arc new sessions/entries are filed into (server-side status). */
  activeArcId: number | null;
  /**
   * Arc the global filter is set to. `null` shows everything; `'none'` shows
   * only unassigned content (the sentinel is needed because arc ids are
   * numbers and `null` already means "all").
   */
  selectedArcId: number | 'none' | null;
  setSelectedArcId: (arcId: number | 'none' | null) => void;
  refresh: () => Promise<StoryArc[]>;
}

export const StoryArcContext = createContext<StoryArcContextValue | null>(null);
