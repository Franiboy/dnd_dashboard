import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { getSessionById } from '../repositories/recordings.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getNormalModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';

const log = createLogger('sessionRewrite');

const BASE_DIR = join(process.cwd(), 'data', 'sessions');

function getWorkDir(sessionId: number): string {
  return join(BASE_DIR, String(sessionId));
}

function getWorkFile(sessionId: number): string {
  return join(getWorkDir(sessionId), 'transcript.txt');
}

export interface SessionRewriteResult {
  transcript: string | null;
}

export async function improveSessionTranscriptWithAi(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
): Promise<SessionRewriteResult> {
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`improveSessionTranscriptWithAi called without transcript for session ${sessionId}`);
    return { transcript: null };
  }

  const workFile = getWorkFile(sessionId);
  mkdirSync(getWorkDir(sessionId), { recursive: true });
  writeFileSync(workFile, session.transcript, 'utf-8');

  log.info(`Starting transcript improvement for session ${sessionId} (${session.transcript.length} bytes)`);

  const prompt = [
    'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Verbessere das Transkript der D&D-Session ${sessionId}.`,
    '',
    'Vorgehen:',
    `1. Lies die Datei ${workFile} mit dem read-Tool.`,
    '2. Korrigiere offensichtliche Fehler der Spracherkennung direkt in dieser Datei mit dem edit-Tool: falsch geschriebene Namen, falsche oder verwechslte Wörter und versehentlich eingedeutschte oder fälschlich englische Wörter.',
    '3. Nutze bei Unsicherheiten zu Namen und Begriffen die Tools list_entities, get_entity und search_diary_entries, um die korrekten Schreibweisen zu ermitteln.',
    '4. Prüfe danach mit dem read-Tool, ob deine Korrekturen gespeichert sind. Danach bist du fertig.',
    '',
    'Wichtig:',
    '- BEHALTE das Format exakt bei: Behalte alle Zeitstempel ([MM:SS] oder [HH:MM:SS]) und die Zeilenstruktur unverändert. Ändere nur den gesprochenen Text innerhalb einer Zeile. Füge keine Zeilen hinzu und entferne keine Zeilen.',
    '- Verändere keine Fakten oder Ereignisse und erfinde nichts, was nicht gesprochen wurde.',
    `- Bearbeite NUR die Datei ${workFile} mit kleinen edit-Operationen. Schreibe die Datei nicht komplett neu und gib das Transkript nicht in deiner Antwort aus.`,
    '- Arbeite zügig: Recherchiere höchstens kurz, wenn dir eine Schreibweise unsicher ist, aber schließe die Bearbeitung der Datei unbedingt ab.',
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getNormalModel(),
    title: `dnd-session-rewrite-${sessionId}-${Date.now()}`,
    scopes: ['entity:read', 'diary:read'],
    user,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for session ${sessionId}: exitCode=${result.exitCode}`);
    return { transcript: null };
  }

  const improved = readFileSync(workFile, 'utf-8');
  if (!improved.trim() || improved === session.transcript) {
    log.warn(`Transcript unchanged for session ${sessionId}`);
    return { transcript: null };
  }

  log.info(`Improved transcript loaded for session ${sessionId}`);
  return { transcript: improved };
}
