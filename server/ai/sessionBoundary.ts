import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { getSessionById } from '../repositories/recordings.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { getSessionWorkDir, getSessionWorkFile } from './sessionWorkdir.js';
import type { Language } from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

const log = createLogger('sessionBoundary');

// Inspect the first and last window of the recording to find the actual game
// play, skipping pre-session team discussion and post-session small talk.
const BOUNDARY_WINDOW_SECONDS = 90 * 60;
const MAX_LINES_PER_SLICE = 2500;

export interface SessionBoundaryResult {
  gameStartSeconds: number | null;
  gameEndSeconds: number | null;
}

interface TranscriptLine {
  seconds: number | null;
  raw: string;
}

const TIMESTAMP_RE = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/;

export function parseTranscriptLines(transcript: string): TranscriptLine[] {
  return transcript.split('\n').map((raw) => {
    const match = raw.match(TIMESTAMP_RE);
    if (!match) return { seconds: null, raw };
    // [MM:SS] or [HH:MM:SS]: two groups mean minutes:seconds, three mean
    // hours:minutes:seconds.
    const seconds = match[3]
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      : Number(match[1]) * 60 + Number(match[2]);
    return { seconds, raw };
  });
}

export interface BoundarySlices {
  useFull: boolean;
  head: string | null;
  tail: string | null;
  maxSeconds: number;
  timedLineCount: number;
}

/**
 * Splits a transcript into the parts needed to detect the game boundaries:
 * for long recordings only the first and last ~90 minutes, otherwise the whole
 * transcript. Never alters the transcript itself.
 */
export function sliceTranscriptForBoundaryDetection(transcript: string): BoundarySlices {
  const lines = parseTranscriptLines(transcript);
  const timedLines = lines.filter(
    (l): l is TranscriptLine & { seconds: number } => l.seconds !== null
  );
  const maxSeconds = timedLines.length > 0 ? Math.max(...timedLines.map((l) => l.seconds)) : 0;

  if (timedLines.length === 0 || maxSeconds <= BOUNDARY_WINDOW_SECONDS * 2) {
    return { useFull: true, head: null, tail: null, maxSeconds, timedLineCount: timedLines.length };
  }

  const head = timedLines
    .filter((l) => l.seconds <= BOUNDARY_WINDOW_SECONDS)
    .slice(0, MAX_LINES_PER_SLICE)
    .map((l) => l.raw)
    .join('\n');
  const tail = timedLines
    .filter((l) => l.seconds >= maxSeconds - BOUNDARY_WINDOW_SECONDS)
    .slice(-MAX_LINES_PER_SLICE)
    .map((l) => l.raw)
    .join('\n');
  return { useFull: false, head, tail, maxSeconds, timedLineCount: timedLines.length };
}

export async function detectSessionBoundaries(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<SessionBoundaryResult> {
  const runLanguage = language ?? getAiLanguage();
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`detectSessionBoundaries called without transcript for session ${sessionId}`);
    return { gameStartSeconds: null, gameEndSeconds: null };
  }

  if (session.gameBoundaryDetectedAt) {
    log.info(`Session ${sessionId} already has detected game boundaries`);
    return {
      gameStartSeconds: session.gameStartSeconds,
      gameEndSeconds: session.gameEndSeconds,
    };
  }

  const workDir = getSessionWorkDir(sessionId);
  mkdirSync(workDir, { recursive: true });
  const workFile = getSessionWorkFile(sessionId);
  writeFileSync(workFile, session.transcript, 'utf-8');

  const slices = sliceTranscriptForBoundaryDetection(session.transcript);
  let headPath: string | null = null;
  let tailPath: string | null = null;
  if (slices.useFull) {
    // Short recording: the AI inspects the whole transcript.
    headPath = workFile;
  } else if (slices.head && slices.tail) {
    headPath = join(workDir, 'session_timeline_head.txt');
    tailPath = join(workDir, 'session_timeline_tail.txt');
    writeFileSync(headPath, slices.head, 'utf-8');
    writeFileSync(tailPath, slices.tail, 'utf-8');
  }

  log.info(
    `Starting game boundary detection for session ${sessionId} (${session.transcript.length} bytes, ${slices.timedLineCount} timed lines, max ${slices.maxSeconds}s)`
  );

  const headDescription = headPath === workFile ? workFile : 'session_timeline_head.txt';
  const tailDescription = tailPath ? 'session_timeline_tail.txt' : null;

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D session system. You work with files and tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Bestimme für die D&D-Session ${sessionId} den exakten Start und das Ende der eigentlichen Spiel-Session innerhalb der Aufnahme.`,
      `Task: Determine the exact start and end of the actual game session for D&D session ${sessionId} within the recording.`
    ),
    '',
    t(
      'Hintergrund: Die Gruppe nimmt ihren Discord-Sprachkanal auf. Vor der eigentlichen Session findet üblicherweise eine Vorbesprechung/Teambesprechung statt: Es wird über Organisatorisches, Teambelange, Charakter- oder Einkaufsfragen und Alltägliches (Small Talk, Technik, etc.) geredet. Auch nach der Session wird noch Small Talk gehalten und man verabschiedet sich. Diese Phasen gehören NICHT zur eigentlichen Spiel-Session und dürfen nicht als Beginn oder Ende der Session gewertet werden.',
      'Background: The group records its Discord voice channel. Before the actual session, there is usually a pre-session or team discussion about organization, team matters, character or shopping questions, and everyday matters (small talk, technical issues, etc.). After the session, there is also small talk and people say goodbye. These phases do NOT belong to the actual game session and must not be treated as its start or end.'
    ),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      `1. Lies die Datei ${headDescription} mit dem read-Tool. Sie enthält den Anfang der Aufnahme${tailDescription ? ' (die ersten ca. 90 Minuten)' : ''}.`,
      `1. Read the file ${headDescription} with the read tool. It contains the beginning of the recording${tailDescription ? ' (approximately the first 90 minutes)' : ''}.`
    ),
    ...(tailDescription
      ? [
          t(
            `2. Lies die Datei ${tailDescription} mit dem read-Tool. Sie enthält das Ende der Aufnahme (die letzten ca. 90 Minuten).`,
            `2. Read the file ${tailDescription} with the read tool. It contains the end of the recording (approximately the last 90 minutes).`
          ),
        ]
      : []),
    t(
      `3. Bestimme anhand der Zeitstempel [MM:SS] bzw. [HH:MM:SS] den Zeitpunkt, ab dem die eigentliche Spiel-Session beginnt: die ersten klaren Spielhandlungen (z. B. der Spielleiter eröffnet die Session, eine Spielszene beginnt, Würfeln, Erkundung, Dialog in der Spielwelt) direkt NACH dem Ende von Vorbesprechung und Small Talk.`,
      `3. Use the [MM:SS] or [HH:MM:SS] timestamps to determine when the actual game session begins: the first clear game actions (for example, the Dungeon Master opens the session, a game scene begins, dice rolling, exploration, or dialogue in the game world) directly AFTER the pre-session discussion and small talk.`
    ),
    t(
      `4. Bestimme den Zeitpunkt, an dem die letzte Spielhandlung endet (z. B. Szenenabschluss, Kampfende, Level-Up, \u201EWir machen Schluss f\u00FCr heute\u201C, Questabschluss) direkt VOR beginnendem Small Talk, Organisatorischem oder Verabschiedung.`,
      `4. Determine when the last game action ends (for example, a scene ends, combat ends, a level-up, "We are calling it a day", or a quest is completed), directly BEFORE small talk, organizational discussion, or goodbyes begin.`
    ),
    t(
      `5. Rechne die beiden Zeitstempel in Sekunden seit Aufnahmebeginn um: [12:30] = 750 Sekunden, [01:45:30] = 6330 Sekunden, [05:35:33] = 20133 Sekunden.`,
      `5. Convert both timestamps to seconds since the recording began: [12:30] = 750 seconds, [01:45:30] = 6330 seconds, [05:35:33] = 20133 seconds.`
    ),
    t(
      `6. Rufe genau einmal set_session_boundaries(sessionId=${sessionId}, startSeconds, endSeconds) mit diesen Sekundenwerten auf.`,
      `6. Call set_session_boundaries(sessionId=${sessionId}, startSeconds, endSeconds) exactly once with these second values.`
    ),
    t(
      '7. Gib danach nur eine kurze Bestätigung aus, z. B. \u201EGrenzen gespeichert: Xs bis Ys\u201C.',
      '7. Then output only a short confirmation, for example "Boundaries saved: Xs to Ys".'
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- Halte dich strikt an die Zeitstempel im Transkript und erfinde keine.',
      '- Follow the transcript timestamps strictly and do not invent any.'
    ),
    t(
      '- Verändere keine Dateien außer dem (optionalen) Aufruf des Tools; bearbeite das Transkript nicht.',
      '- Do not change any files apart from the optional tool call; do not edit the transcript.'
    ),
    t(
      '- Wenn der Übergang fließend ist, wähle den vernünftigsten erkennbaren Punkt für Beginn und Ende.',
      '- If the transition is gradual, choose the most reasonable recognizable point for the start and end.'
    ),
    t(
      '- Rufe das Tool genau einmal auf und speichere gültige Zahlen (endSeconds > startSeconds).',
      '- Call the tool exactly once and save valid numbers (endSeconds > startSeconds).'
    ),
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-boundaries-${sessionId}-${Date.now()}`,
    scopes: ['recording:boundaries'],
    user,
    language: runLanguage,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for session boundaries ${sessionId}: exitCode=${result.exitCode}`);
    return { gameStartSeconds: null, gameEndSeconds: null };
  }

  const updated = getSessionById(sessionId);
  if (!updated?.gameBoundaryDetectedAt) {
    log.warn(`No game boundaries saved for session ${sessionId}`);
    return { gameStartSeconds: null, gameEndSeconds: null };
  }

  log.info(
    `Game boundaries for session ${sessionId}: ${updated.gameStartSeconds}s - ${updated.gameEndSeconds}s`
  );
  return {
    gameStartSeconds: updated.gameStartSeconds,
    gameEndSeconds: updated.gameEndSeconds,
  };
}
