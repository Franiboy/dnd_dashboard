import { mkdirSync, writeFileSync } from 'node:fs';
import { createLogger } from '../logger.js';
import { getSessionById, getSessionSummaryById } from '../repositories/recordings.js';
import { findExistingEntitiesInText } from '../repositories/diary.js';
import { markEntitySummaryDirty } from '../repositories/entitySummaries.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { distributeKnowledgeFromText } from './knowledge.js';
import { getSessionWorkDir, getSessionWorkFile } from './sessionWorkdir.js';

const log = createLogger('sessionSummary');

function formatOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export interface SessionSummaryResult {
  summary: string | null;
  longSummary: string | null;
}

export async function summarizeSessionWithAi(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
): Promise<SessionSummaryResult> {
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`summarizeSessionWithAi called without transcript for session ${sessionId}`);
    return { summary: null, longSummary: null };
  }

  const workFile = getSessionWorkFile(sessionId);
  mkdirSync(getSessionWorkDir(sessionId), { recursive: true });
  writeFileSync(workFile, session.transcript, 'utf-8');

  log.info(
    `Starting session summaries for session ${sessionId} (${session.transcript.length} bytes)`
  );

  const longSummary = await generateLongSessionSummary(sessionId, workFile, user, model, onLog);
  if (!longSummary) {
    log.warn(`No long summary generated for session ${sessionId}`);
    return { summary: null, longSummary: null };
  }

  const shortSummary = await generateShortSessionSummary(
    sessionId,
    longSummary,
    user,
    model,
    onLog
  );
  if (!shortSummary) {
    log.warn(`No short summary generated for session ${sessionId}`);
    return { summary: null, longSummary };
  }

  log.info(`Session summaries loaded for session ${sessionId}`);
  return { summary: shortSummary, longSummary };
}

async function generateLongSessionSummary(
  sessionId: number,
  workFile: string,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
): Promise<string | null> {
  const session = getSessionById(sessionId);
  const boundaryHints =
    session?.gameBoundaryDetectedAt &&
    session.gameStartSeconds !== null &&
    session.gameEndSeconds !== null
      ? [
          '',
          `Die eigentliche Spiel-Session beginnt im Transkript bei Offset ${session.gameStartSeconds} Sekunden (${formatOffset(session.gameStartSeconds)}) und endet bei Offset ${session.gameEndSeconds} Sekunden (${formatOffset(session.gameEndSeconds)}).`,
          'Alles davor (Vorbesprechung, Small Talk) und danach (Small Talk, Verabschiedung) gehört NICHT zur Session und darf inhaltlich NICHT in die Zusammenfassung einfließen oder zählen.',
        ]
      : [
          '',
          'Achte darauf, dass die Aufnahme vor und nach der eigentlichen Spiel-Session Vorbesprechung/Teambesprechung und Small Talk enthält. Beziehe dich in der Zusammenfassung nur auf die tatsächliche Spiel-Session, nicht auf organisatorisches Vorgeplänkel oder Verabschiedungen.',
        ];

  const prompt = [
    'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Erstelle eine ausführliche Zusammenfassung der D&D-Session ${sessionId} im HTML-Format.`,
    '',
    'Vorgehen:',
    `1. Lies die Datei ${workFile} mit dem read-Tool.`,
    '2. Nutze get_previous_session_summaries, list_entities, get_entity und search_diary_entries, um Hintergrundinformationen zu sammeln. Da du Admin-Rechte hast, siehst du alle Tagebücher aller Spieler und alle bisherigen Session-Zusammenfassungen.',
    '3. Erstelle eine ausführliche, gut strukturierte HTML-Zusammenfassung der Session. Gliedere sie in Abschnitte (z. B. Orte, Personen, Ereignisse, Kämpfe, Entscheidungen). Verwende dafür <h2>, <h3>, <p>, <ul>/<li> und andere sinnvolle HTML-Elemente.',
    `4. Rufe set_session_long_summary(sessionId=${sessionId}, longSummary) mit deinem HTML auf.`,
    '5. Gib danach nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
    '',
    'Wichtig:',
    '- Halte dich strikt an den vorliegenden Text und erfinke keine Details.',
    '- Verwende die exakte Schreibweise von Entitäten aus der Datenbank.',
    '- Nutze HTML, aber keine Markdown-Code-Blöcke.',
    '- Wenn keine relevanten Hintergrundinformationen existieren, erstelle die Zusammenfassung trotzdem direkt.',
    ...boundaryHints,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-long-summary-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'recording:summarize', 'diary:read', 'entity:read'],
    user,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for long session summary ${sessionId}: exitCode=${result.exitCode}`);
    return null;
  }

  const updatedSession = getSessionSummaryById(sessionId);
  if (!updatedSession?.longSummary) {
    log.warn(`No long summary saved for session ${sessionId}`);
    return null;
  }

  log.info(
    `Long summary loaded for session ${sessionId} (${updatedSession.longSummary.length} chars)`
  );
  return updatedSession.longSummary;
}

async function generateShortSessionSummary(
  sessionId: number,
  longSummary: string,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
): Promise<string | null> {
  const prompt = [
    'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Erstelle eine knappe Zusammenfassung der D&D-Session ${sessionId} aus der folgenden ausführlichen Zusammenfassung.`,
    '',
    'Vorgehen:',
    `1. Rufe set_session_summary(sessionId=${sessionId}, summary) mit einer kurzen Zusammenfassung auf.`,
    '2. Die Zusammenfassung darf maximal 500 Zeichen lang sein, sollte 3–5 knappe Stichpunkte enthalten (einer pro Zeile) und ohne Markdown-Code-Block sein.',
    '3. Nenne nur die gröbsten Ereignisse, Orte und Handlungsstränge.',
    '4. Gib danach nur eine kurze Bestätigung aus, nicht die Zusammenfassung selbst.',
    '',
    'Ausführliche Zusammenfassung:',
    longSummary,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-short-summary-${sessionId}-${Date.now()}`,
    scopes: ['recording:summarize'],
    user,
    onLog,
  });

  if (!result.success) {
    log.error(
      `OpenCode failed for short session summary ${sessionId}: exitCode=${result.exitCode}`
    );
    return null;
  }

  const updatedSession = getSessionSummaryById(sessionId);
  if (!updatedSession?.summary) {
    log.warn(`No short summary saved for session ${sessionId}`);
    return null;
  }

  log.info(
    `Short summary loaded for session ${sessionId} (${updatedSession.summary.length} chars)`
  );
  return updatedSession.summary;
}

export async function processSessionSummaryEntities(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
): Promise<SessionSummaryResult> {
  const result = await summarizeSessionWithAi(sessionId, user, model, onLog);
  if (!result.longSummary || !result.summary) {
    return result;
  }

  const longEntities = findExistingEntitiesInText(result.longSummary);
  const shortEntities = findExistingEntitiesInText(result.summary);
  const allEntities = {
    persons: Array.from(new Set([...longEntities.persons, ...shortEntities.persons])),
    organizations: Array.from(
      new Set([...longEntities.organizations, ...shortEntities.organizations])
    ),
    locations: Array.from(new Set([...longEntities.locations, ...shortEntities.locations])),
  };
  for (const name of allEntities.persons) markEntitySummaryDirty('persons', name);
  for (const name of allEntities.organizations) markEntitySummaryDirty('organizations', name);
  for (const name of allEntities.locations) markEntitySummaryDirty('locations', name);

  try {
    await distributeKnowledgeFromText(result.longSummary, model, onLog);
  } catch (err) {
    log.warn(`Knowledge distribution failed for session summary ${sessionId}:`, err);
  }

  log.info(
    `Session ${sessionId}: marked ${allEntities.persons.length + allEntities.organizations.length + allEntities.locations.length} entities dirty and distributed knowledge`
  );
  return result;
}
