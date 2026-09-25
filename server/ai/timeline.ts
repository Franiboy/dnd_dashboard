import { createLogger } from '../logger.js';
import { getSessionById } from '../repositories/recordings.js';
import { countSessionEvents } from '../repositories/timeline.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { resolveSessionArcContext } from './arcContext.js';
import type { Language } from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

const log = createLogger('timeline');

/**
 * AI generation of the campaign timeline for one session: reads the session's
 * (long) summary plus arc-scoped diary context and writes the notable events
 * and their scenes via the MCP tool set_timeline_events. Like every AI
 * feature, results are persisted by the MCP tool handler, never parsed from
 * the AI's text output.
 */
export async function generateTimelineForSession(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<boolean> {
  const runLanguage = language ?? getAiLanguage();
  const session = getSessionById(sessionId);
  if (!session || !session.longSummary) {
    log.warn(`generateTimelineForSession called without summary for session ${sessionId}`);
    return false;
  }
  if (session.gameDay === null) {
    log.warn(`Session ${sessionId} has no game day; skipping timeline generation`);
    return false;
  }

  const arcContext = resolveSessionArcContext(sessionId, runLanguage);
  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const range =
    session.gameDayEnd !== null && session.gameDayEnd !== session.gameDay
      ? t(
          `Spieltag ${session.gameDay}–${session.gameDayEnd}`,
          `game day ${session.gameDay}–${session.gameDayEnd}`
        )
      : t(`Spieltag ${session.gameDay}`, `game day ${session.gameDay}`);

  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Kampagnen-System. Du arbeitest mit Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D campaign system. You work with tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Extrahiere aus der ausführlichen Zusammenfassung der D&D-Session ${sessionId} die nennenswerten Ereignisse für die Kampagnen-Zeitleiste.`,
      `Task: Extract the notable events for the campaign timeline from the detailed summary of D&D session ${sessionId}.`
    ),
    ...(arcContext?.promptLines ?? []),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      `1. Rufe get_session_summary(sessionId=${sessionId}) auf und lies die ausführliche Zusammenfassung.`,
      `1. Call get_session_summary(sessionId=${sessionId}) and read the detailed summary.`
    ),
    t(
      '2. Nutze get_previous_session_summaries und search_diary_entries für Einordnung (Vorgeschichte, Orte, Personen).',
      '2. Use get_previous_session_summaries and search_diary_entries for context (history, locations, and people).'
    ),
    t(
      `3. Rufe set_timeline_events(sessionId=${sessionId}, events=...) GENAU EINMAL mit dem Ergebnis auf.`,
      `3. Call set_timeline_events(sessionId=${sessionId}, events=...) EXACTLY ONCE with the result.`
    ),
    '',
    t('Gruppierung:', 'Grouping:'),
    t(
      '- Fasse jeden nennenswerten Spieltag zu GENAU EINEM Hauptevent zusammen. Zusammenhängende Abläufe desselben Tages (z. B. "Ankunft", "Verhör", "Flucht" am selben Tag) gehören in EIN Event, nicht in mehrere.',
      '- Combine each notable game day into EXACTLY ONE main event. Connected events on the same day (for example, "arrival", "interrogation", and "escape") belong in ONE event, not several.'
    ),
    t(
      '- Spieltage ohne nennenswertes Geschehen (Reise, Handel, Routine) erhalten KEIN Event.',
      '- Game days without notable events (travel, trade, routine) receive NO event.'
    ),
    t(
      '- Nur nennenswerte Tage: Kämpfe, wichtige Entscheidungen, Begegnungen, Funde, Wendepunkte. Typischerweise 1 Event pro nennenswertem Spieltag, insgesamt meist 2 bis 5 pro Session.',
      '- Include only notable days: battles, important decisions, encounters, discoveries, and turning points. Typically one event per notable game day, usually two to five events per session in total.'
    ),
    '',
    t('Regeln:', 'Rules:'),
    t(
      `- gameDay ist der Ingame-Spieltag des Ereignisses; die Session deckt ${range} ab. Ein Spieltag pro Event.`,
      `- gameDay is the in-game day of the event; the session covers ${range}. Use one game day per event.`
    ),
    t(
      '- title: prägnanter deutscher Titel für den Höhepunkt des Tages.',
      '- title: a concise English title for the highlight of the day.'
    ),
    t(
      '- description: komprimierte Kurzfassung des gesamten Tages (ein <p>, 2–4 Sätze) – was geschah und warum es für die Kampagne wichtig ist.',
      '- description: a compressed short account of the entire day (one <p>, 2–4 sentences) describing what happened and why it matters to the campaign.'
    ),
    t(
      '- scenes: die chronologischen Abläufe dieses Tages (3–8 Szenen, je Titel + knappe Beschreibung). Sie bilden die Detail-Ebene, die Nutzer beim Reinzoomen im Gruppenrahmen sehen.',
      '- scenes: the chronological events of that day (3–8 scenes, each with a title and brief description). They form the detail level users see when zooming into the group frame.'
    ),
    t(
      '- Halte dich strikt an die Zusammenfassung und erfinke keine Details.',
      '- Follow the summary strictly and do not invent details.'
    ),
    t(
      '- Verwende die exakte Schreibweise von Entitäten aus der Datenbank.',
      '- Use the exact database spelling for entities.'
    ),
    t('- Nutze HTML, aber keine Markdown-Code-Blöcke.', '- Use HTML, but no Markdown code blocks.'),
    '',
    t(
      'Gib danach nur eine kurze Bestätigung aus, nicht die Ereignisse selbst.',
      'Then output only a short confirmation, not the events themselves.'
    ),
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-timeline-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'diary:read', 'entity:read', 'timeline:write'],
    user,
    recordingSessionId: sessionId,
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for timeline of session ${sessionId}: exitCode=${result.exitCode}`);
    return false;
  }

  const written = countSessionEvents(sessionId);
  if (written === 0) {
    log.warn(`No timeline events saved for session ${sessionId}`);
    return false;
  }
  log.info(`Timeline for session ${sessionId} generated (${written} events)`);
  return true;
}
