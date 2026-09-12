import { createLogger } from '../logger.js';
import { getSessionById } from '../repositories/recordings.js';
import { countSessionEvents } from '../repositories/timeline.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { resolveSessionArcContext } from './arcContext.js';

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
  onLog?: (line: string) => void
): Promise<boolean> {
  const session = getSessionById(sessionId);
  if (!session || !session.longSummary) {
    log.warn(`generateTimelineForSession called without summary for session ${sessionId}`);
    return false;
  }
  if (session.gameDay === null) {
    log.warn(`Session ${sessionId} has no game day; skipping timeline generation`);
    return false;
  }

  const arcContext = resolveSessionArcContext(sessionId);
  const range =
    session.gameDayEnd !== null && session.gameDayEnd !== session.gameDay
      ? `Spieltag ${session.gameDay}–${session.gameDayEnd}`
      : `Spieltag ${session.gameDay}`;

  const prompt = [
    'Du bist ein Assistent für ein D&D-Kampagnen-System. Du arbeitest mit Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Extrahiere aus der ausführlichen Zusammenfassung der D&D-Session ${sessionId} die nennenswerten Ereignisse für die Kampagnen-Zeitleiste.`,
    ...(arcContext?.promptLines ?? []),
    '',
    'Vorgehen:',
    `1. Rufe get_session_summary(sessionId=${sessionId}) auf und lies die ausführliche Zusammenfassung.`,
    '2. Nutze get_previous_session_summaries und search_diary_entries für Einordnung (Vorgeschichte, Orte, Personen).',
    `3. Rufe set_timeline_events(sessionId=${sessionId}, events=...) GENAU EINMAL mit dem Ergebnis auf.`,
    '',
    'Regeln:',
    '- Nur nennenswerte Ereignisse: Kämpfe, wichtige Entscheidungen, Begegnungen, Funde, Wendepunkte, Reisen zu neuen Orten. Typischerweise 2 bis 6 pro Session – NICHT ein Ereignis pro Spieltag und keine Routinevorgänge.',
    `- gameDay ist der Ingame-Spieltag des Ereignisses; die Session deckt ${range} ab.`,
    '- title: prägnanter deutscher Titel (maximal ein Satz).',
    '- description: knappe HTML-Beschreibung (ein <p>, 2–4 Sätze), was geschah und warum es für die Kampagne wichtig ist.',
    '- scenes: 3–8 chronologische Szenen/Zwischenschritte genau dieses Ereignisses (je Titel + kurze Beschreibung). Sie bilden die Zoom-Ebene des Ereignisses.',
    '- Halte dich strikt an die Zusammenfassung und erfinke keine Details.',
    '- Verwende die exakte Schreibweise von Entitäten aus der Datenbank.',
    '- Nutze HTML, aber keine Markdown-Code-Blöcke.',
    '',
    'Gib danach nur eine kurze Bestätigung aus, nicht die Ereignisse selbst.',
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
