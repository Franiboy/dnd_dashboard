import { mkdirSync, writeFileSync } from 'node:fs';
import { createLogger } from '../logger.js';
import { getSessionById, getSessionSummaryById } from '../repositories/recordings.js';
import { findExistingEntitiesInText } from '../repositories/diary.js';
import { splitEntityLabel } from '../repositories/entityRefs.js';
import { markEntitySummaryDirty } from '../repositories/entitySummaries.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { distributeKnowledgeFromText } from './knowledge.js';
import { getSessionWorkDir, getSessionWorkFile } from './sessionWorkdir.js';
import { resolveSessionArcContext } from './arcContext.js';
import type { Language } from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

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
  onLog?: (line: string) => void,
  language?: Language
): Promise<SessionSummaryResult> {
  const runLanguage = language ?? getAiLanguage();
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

  const longSummary = await generateLongSessionSummary(
    sessionId,
    workFile,
    user,
    model,
    onLog,
    runLanguage
  );
  if (!longSummary) {
    log.warn(`No long summary generated for session ${sessionId}`);
    return { summary: null, longSummary: null };
  }

  const shortSummary = await generateShortSessionSummary(
    sessionId,
    longSummary,
    user,
    model,
    onLog,
    runLanguage
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
  onLog?: (line: string) => void,
  language?: Language
): Promise<string | null> {
  const runLanguage = language ?? getAiLanguage();
  const session = getSessionById(sessionId);
  const arcContext = resolveSessionArcContext(sessionId, runLanguage);
  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const boundaryHints =
    session?.gameBoundaryDetectedAt &&
    session.gameStartSeconds !== null &&
    session.gameEndSeconds !== null
      ? [
          '',
          t(
            `Die eigentliche Spiel-Session beginnt im Transkript bei Offset ${session.gameStartSeconds} Sekunden (${formatOffset(session.gameStartSeconds)}) und endet bei Offset ${session.gameEndSeconds} Sekunden (${formatOffset(session.gameEndSeconds)}).`,
            `The actual game session begins in the transcript at offset ${session.gameStartSeconds} seconds (${formatOffset(session.gameStartSeconds)}) and ends at offset ${session.gameEndSeconds} seconds (${formatOffset(session.gameEndSeconds)}).`
          ),
          t(
            'Alles davor (Vorbesprechung, Small Talk) und danach (Small Talk, Verabschiedung) gehört NICHT zur Session und darf inhaltlich NICHT in die Zusammenfassung einfließen oder zählen.',
            'Everything before it (pre-session discussion, small talk) and afterward (small talk, goodbyes) does NOT belong to the session and must not influence or count toward the summary.'
          ),
        ]
      : [
          '',
          t(
            'Achte darauf, dass die Aufnahme vor und nach der eigentlichen Spiel-Session Vorbesprechung/Teambesprechung und Small Talk enthält. Beziehe dich in der Zusammenfassung nur auf die tatsächliche Spiel-Session, nicht auf organisatorisches Vorgeplänkel oder Verabschiedungen.',
            'Note that the recording contains pre-session or team discussion and small talk before and after the actual game session. Base the summary only on the actual game session, not on organizational planning or goodbyes.'
          ),
        ];

  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D session system. You work with files and tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Erstelle eine ausführliche Zusammenfassung der D&D-Session ${sessionId} im HTML-Format.`,
      `Task: Create a detailed HTML summary of D&D session ${sessionId}.`
    ),
    ...(arcContext?.promptLines ?? []),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      `1. Lies die Datei ${workFile} mit dem read-Tool.`,
      `1. Read the file ${workFile} with the read tool.`
    ),
    t(
      '2. Nutze get_previous_session_summaries, list_entities, get_entity und search_diary_entries, um Hintergrundinformationen zu sammeln. Da du Admin-Rechte hast, siehst du alle Tagebücher aller Spieler und alle bisherigen Session-Zusammenfassungen. Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), lies get_entity mit dem zum Kontext passenden Qualifier.',
      "2. Use get_previous_session_summaries, list_entities, get_entity, and search_diary_entries to gather background information. You have administrator access, so you can see every player's diary and all previous session summaries. If several entities have the same name (list_entities shows different qualifiers), use the context-appropriate qualifier with get_entity."
    ),
    t(
      '3. Erstelle eine ausführliche, gut strukturierte HTML-Zusammenfassung der Session. Gliedere sie in Abschnitte (z. B. Orte, Personen, Ereignisse, Kämpfe, Entscheidungen). Verwende dafür <h2>, <h3>, <p>, <ul>/<li> und andere sinnvolle HTML-Elemente.',
      '3. Create a detailed, well-structured HTML summary of the session. Divide it into sections (for example, locations, people, events, battles, and decisions). Use <h2>, <h3>, <p>, <ul>/<li>, and other suitable HTML elements.'
    ),
    t(
      `4. Rufe set_session_long_summary(sessionId=${sessionId}, longSummary) mit deinem HTML auf.`,
      `4. Call set_session_long_summary(sessionId=${sessionId}, longSummary) with your HTML.`
    ),
    t(
      '5. Gib danach nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
      '5. Then output only a short confirmation, not the HTML text itself.'
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- Halte dich strikt an den vorliegenden Text und erfinke keine Details.',
      '- Follow the supplied text strictly and do not invent details.'
    ),
    t(
      '- Verwende die exakte Schreibweise von Entitäten aus der Datenbank.',
      '- Use the exact database spelling for entities.'
    ),
    t('- Nutze HTML, aber keine Markdown-Code-Blöcke.', '- Use HTML, but no Markdown code blocks.'),
    t(
      '- Wenn keine relevanten Hintergrundinformationen existieren, erstelle die Zusammenfassung trotzdem direkt.',
      '- If no relevant background information exists, create the summary directly anyway.'
    ),
    ...boundaryHints,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-long-summary-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'recording:summarize', 'diary:read', 'entity:read'],
    user,
    arcId: arcContext?.arcId,
    language: runLanguage,
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
  onLog?: (line: string) => void,
  language?: Language
): Promise<string | null> {
  const runLanguage = language ?? getAiLanguage();
  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D session system. You work with tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Erstelle eine knappe Zusammenfassung der D&D-Session ${sessionId} aus der folgenden ausführlichen Zusammenfassung.`,
      `Task: Create a concise summary of D&D session ${sessionId} from the detailed summary below.`
    ),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      `1. Rufe set_session_summary(sessionId=${sessionId}, summary) mit einer kurzen Zusammenfassung auf.`,
      `1. Call set_session_summary(sessionId=${sessionId}, summary) with a concise summary.`
    ),
    t(
      '2. Die Zusammenfassung darf maximal 500 Zeichen lang sein, sollte 3–5 knappe Stichpunkte enthalten (einer pro Zeile) und ohne Markdown-Code-Block sein.',
      '2. The summary may be at most 500 characters and should contain 3–5 concise bullet points (one per line), without a Markdown code block.'
    ),
    t(
      '3. Nenne nur die gröbsten Ereignisse, Orte und Handlungsstränge.',
      '3. Mention only the broadest events, locations, and plot threads.'
    ),
    t(
      '4. Gib danach nur eine kurze Bestätigung aus, nicht die Zusammenfassung selbst.',
      '4. Then output only a short confirmation, not the summary itself.'
    ),
    '',
    t('Ausführliche Zusammenfassung:', 'Detailed summary:'),
    longSummary,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-short-summary-${sessionId}-${Date.now()}`,
    scopes: ['recording:summarize'],
    user,
    language: runLanguage,
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
  onLog?: (line: string) => void,
  language?: Language
): Promise<SessionSummaryResult> {
  const runLanguage = language ?? getAiLanguage();
  const result = await summarizeSessionWithAi(sessionId, user, model, onLog, runLanguage);
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
    items: Array.from(new Set([...longEntities.items, ...shortEntities.items])),
  };
  // Detected entities are qualified labels ("Name (Qualifier)") - parse them
  // back so the dirty flag lands on the exact homonym.
  const markDirty = (
    type: 'persons' | 'organizations' | 'locations' | 'items',
    labels: string[]
  ) => {
    for (const label of labels) {
      const { name, qualifier } = splitEntityLabel(label);
      markEntitySummaryDirty(type, name, qualifier);
    }
  };
  markDirty('persons', allEntities.persons);
  markDirty('organizations', allEntities.organizations);
  markDirty('locations', allEntities.locations);
  markDirty('items', allEntities.items);

  try {
    await distributeKnowledgeFromText(result.longSummary, {
      model,
      onLog,
      user,
      origin: { type: 'session', id: sessionId },
      language: runLanguage,
    });
  } catch (err) {
    log.warn(`Knowledge distribution failed for session summary ${sessionId}:`, err);
  }

  log.info(
    `Session ${sessionId}: marked ${
      allEntities.persons.length +
      allEntities.organizations.length +
      allEntities.locations.length +
      allEntities.items.length
    } entities dirty and distributed knowledge`
  );
  return result;
}
