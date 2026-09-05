import {
  getArcIdForDiaryEntry,
  getArcIdForSession,
  getStoryArc,
  getStoryArcDayRange,
} from '../repositories/storyArcs.js';

export interface StoryArcContext {
  arcId: number;
  name: string;
  gameDayStart: number | null;
  gameDayEnd: number | null;
  /** Prompt lines announcing the arc-restricted context to the model. */
  promptLines: string[];
}

function buildContext(arcId: number): StoryArcContext | null {
  const arc = getStoryArc(arcId);
  if (!arc) return null;
  const { start, end } = getStoryArcDayRange(arcId);
  const range =
    start !== null ? ` (Spieltag ${start}${end !== null && end !== start ? `–${end}` : ''})` : '';
  return {
    arcId,
    name: arc.name,
    gameDayStart: start,
    gameDayEnd: end,
    promptLines: [
      '',
      `Story-Arc: Diese Aufgabe ist dem Story Arc "${arc.name}"${range} zugeordnet.`,
      '- Kontext-Abfragen (Tagebucheinträge, Session-Zusammenfassungen) liefern nur Inhalte dieses Arcs. Andere Arcs sind absichtlich nicht sichtbar.',
    ],
  };
}

/** Arc context of the diary entry being processed; null when unassigned. */
export function resolveDiaryEntryArcContext(entryId: number): StoryArcContext | null {
  const arcId = getArcIdForDiaryEntry(entryId);
  return arcId === null ? null : buildContext(arcId);
}

/** Arc context of the session being processed; null when unassigned. */
export function resolveSessionArcContext(sessionId: number): StoryArcContext | null {
  const arcId = getArcIdForSession(sessionId);
  return arcId === null ? null : buildContext(arcId);
}

/** Arc context for an explicitly chosen arc (e.g. world dialogs); null when unknown. */
export function resolveArcContextById(arcId: number): StoryArcContext | null {
  return buildContext(arcId);
}
