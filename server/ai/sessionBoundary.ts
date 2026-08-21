import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { getSessionById } from '../repositories/recordings.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { getSessionWorkDir, getSessionWorkFile } from './sessionWorkdir.js';

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
  onLog?: (line: string) => void
): Promise<SessionBoundaryResult> {
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

  const prompt = [
    'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Bestimme für die D&D-Session ${sessionId} den exakten Start und das Ende der eigentlichen Spiel-Session innerhalb der Aufnahme.`,
    '',
    'Hintergrund: Die Gruppe nimmt ihren Discord-Sprachkanal auf. Vor der eigentlichen Session findet üblicherweise eine Vorbesprechung/Teambesprechung statt: Es wird über Organisatorisches, Teambelange, Charakter- oder Einkaufsfragen und Alltägliches (Small Talk, Technik, etc.) geredet. Auch nach der Session wird noch Small Talk gehalten und man verabschiedet sich. Diese Phasen gehören NICHT zur eigentlichen Spiel-Session und dürfen nicht als Beginn oder Ende der Session gewertet werden.',
    '',
    'Vorgehen:',
    `1. Lies die Datei ${headDescription} mit dem read-Tool. Sie enthält den Anfang der Aufnahme${tailDescription ? ' (die ersten ca. 90 Minuten)' : ''}.`,
    ...(tailDescription
      ? [
          `2. Lies die Datei ${tailDescription} mit dem read-Tool. Sie enthält das Ende der Aufnahme (die letzten ca. 90 Minuten).`,
        ]
      : []),
    `3. Bestimme anhand der Zeitstempel [MM:SS] bzw. [HH:MM:SS] den Zeitpunkt, ab dem die eigentliche Spiel-Session beginnt: die ersten klaren Spielhandlungen (z. B. der Spielleiter eröffnet die Session, eine Spielszene beginnt, Würfeln, Erkundung, Dialog in der Spielwelt) direkt NACH dem Ende von Vorbesprechung und Small Talk.`,
    `4. Bestimme den Zeitpunkt, an dem die letzte Spielhandlung endet (z. B. Szenenabschluss, Kampfende, Level-Up, \u201EWir machen Schluss f\u00FCr heute\u201C, Questabschluss) direkt VOR beginnendem Small Talk, Organisatorischem oder Verabschiedung.`,
    `5. Rechne die beiden Zeitstempel in Sekunden seit Aufnahmebeginn um: [12:30] = 750 Sekunden, [01:45:30] = 6330 Sekunden, [05:35:33] = 20133 Sekunden.`,
    `6. Rufe genau einmal set_session_boundaries(sessionId=${sessionId}, startSeconds, endSeconds) mit diesen Sekundenwerten auf.`,
    '7. Gib danach nur eine kurze Bestätigung aus, z. B. \u201EGrenzen gespeichert: Xs bis Ys\u201C.',
    '',
    'Wichtig:',
    '- Halte dich strikt an die Zeitstempel im Transkript und erfinde keine.',
    '- Verändere keine Dateien außer dem (optionalen) Aufruf des Tools; bearbeite das Transkript nicht.',
    '- Wenn der Übergang fließend ist, wähle den vernünftigsten erkennbaren Punkt für Beginn und Ende.',
    '- Rufe das Tool genau einmal auf und speichere gültige Zahlen (endSeconds > startSeconds).',
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-boundaries-${sessionId}-${Date.now()}`,
    scopes: ['recording:boundaries'],
    user,
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
