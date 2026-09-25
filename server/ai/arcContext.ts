import type { Language } from '../../shared/types.js';
import {
  getArcIdForDiaryEntry,
  getArcIdForSession,
  getStoryArc,
  getStoryArcDayRange,
} from '../repositories/storyArcs.js';
import { getAiLanguage } from './languageConfig.js';
import { localize } from './promptLanguage.js';

export interface StoryArcContext {
  arcId: number;
  name: string;
  gameDayStart: number | null;
  gameDayEnd: number | null;
  /** Prompt lines announcing the arc-restricted context to the model. */
  promptLines: string[];
}

export function buildArcPromptLines(
  arcName: string,
  start: number | null,
  end: number | null,
  language: Language
): string[] {
  const range =
    start !== null
      ? localize(
          language,
          ` (Spieltag ${start}${end !== null && end !== start ? `–${end}` : ''})`,
          ` (game day ${start}${end !== null && end !== start ? `–${end}` : ''})`
        )
      : '';
  return [
    '',
    localize(
      language,
      `Story-Arc: Diese Aufgabe ist dem Story Arc "${arcName}"${range} zugeordnet.`,
      `Story arc: This task belongs to the story arc "${arcName}"${range}.`
    ),
    localize(
      language,
      '- Kontext-Abfragen (Tagebucheinträge, Session-Zusammenfassungen) liefern nur Inhalte dieses Arcs. Andere Arcs sind absichtlich nicht sichtbar.',
      '- Context queries (diary entries and session summaries) return content from this arc only. Other arcs are intentionally not visible.'
    ),
  ];
}

function buildContext(arcId: number, language: Language): StoryArcContext | null {
  const arc = getStoryArc(arcId);
  if (!arc) return null;
  const { start, end } = getStoryArcDayRange(arcId);
  return {
    arcId,
    name: arc.name,
    gameDayStart: start,
    gameDayEnd: end,
    promptLines: buildArcPromptLines(arc.name, start, end, language),
  };
}

/** Arc context of the diary entry being processed; null when unassigned. */
export function resolveDiaryEntryArcContext(
  entryId: number,
  language: Language = getAiLanguage()
): StoryArcContext | null {
  const arcId = getArcIdForDiaryEntry(entryId);
  return arcId === null ? null : buildContext(arcId, language);
}

/** Arc context of the session being processed; null when unassigned. */
export function resolveSessionArcContext(
  sessionId: number,
  language: Language = getAiLanguage()
): StoryArcContext | null {
  const arcId = getArcIdForSession(sessionId);
  return arcId === null ? null : buildContext(arcId, language);
}

/** Arc context for an explicitly chosen arc (e.g. world dialogs); null when unknown. */
export function resolveArcContextById(
  arcId: number,
  language: Language = getAiLanguage()
): StoryArcContext | null {
  return buildContext(arcId, language);
}
