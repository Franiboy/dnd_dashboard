import { useContext } from 'react';
import { StoryArcContext } from '../contexts/StoryArcContext';
import type { SelectedArc } from '../contexts/StoryArcProvider';

export function useStoryArcs() {
  const ctx = useContext(StoryArcContext);
  if (!ctx) {
    throw new Error('useStoryArcs must be used within a StoryArcProvider');
  }
  return ctx;
}

export type { SelectedArc };
