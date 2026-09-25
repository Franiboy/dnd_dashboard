import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { getSessionById, updateSession } from '../repositories/recordings.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { getSessionWorkDir, getSessionWorkFile } from './sessionWorkdir.js';
import type { Language } from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

const log = createLogger('sessionRewrite');

export interface SessionRewriteResult {
  transcript: string | null;
}

export async function improveSessionTranscriptWithAi(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<SessionRewriteResult> {
  const runLanguage = language ?? getAiLanguage();
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`improveSessionTranscriptWithAi called without transcript for session ${sessionId}`);
    return { transcript: null };
  }

  const workFile = getSessionWorkFile(sessionId);
  mkdirSync(getSessionWorkDir(sessionId), { recursive: true });
  writeFileSync(workFile, session.transcript, 'utf-8');

  log.info(
    `Starting transcript improvement for session ${sessionId} (${session.transcript.length} bytes)`
  );

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D session system. You work with files and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Verbessere das Transkript der D&D-Session ${sessionId}.`,
      `Task: Improve the transcript of D&D session ${sessionId}.`
    ),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      `1. Lies die Datei ${workFile} mit dem read-Tool.`,
      `1. Read the file ${workFile} with the read tool.`
    ),
    t(
      '2. Korrigiere offensichtliche Fehler der Spracherkennung direkt in dieser Datei mit dem edit-Tool: falsch geschriebene Namen, falsche oder verwechslte Wörter und versehentlich eingedeutschte oder fälschlich englische Wörter. Ist der gesprochene Text nicht auf Deutsch, übersetze ihn ins Deutsche; technische Namen, Zahlen und Nutzerbefehle bleiben unverändert.',
      '2. Correct obvious speech-recognition errors directly in this file with the edit tool: misspellings of names, incorrect or confused words, and words accidentally translated into the wrong language. If the spoken text is not English, translate it into English; technical names, numbers, and user commands remain unchanged.'
    ),
    t(
      '3. Nutze bei Unsicherheiten zu Namen und Begriffen die Tools list_entities, get_entity und search_diary_entries, um die korrekten Schreibweisen zu ermitteln.',
      '3. When unsure about names or terms, use the list_entities, get_entity, and search_diary_entries tools to determine the correct spellings.'
    ),
    t(
      '4. Prüfe danach mit dem read-Tool, ob deine Korrekturen gespeichert sind. Danach bist du fertig.',
      '4. Then use the read tool to verify that your corrections were saved. You are finished afterward.'
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- BEHALTE das Format exakt bei: Behalte alle Zeitstempel ([MM:SS] oder [HH:MM:SS]) und die Zeilenstruktur unverändert. Ändere nur den gesprochenen Text innerhalb einer Zeile. Füge keine Zeilen hinzu und entferne keine Zeilen.',
      '- Keep the format exactly: preserve all timestamps ([MM:SS] or [HH:MM:SS]) and the line structure unchanged. Change only the spoken text within a line. Do not add or remove lines.'
    ),
    t(
      '- Verändere keine Fakten oder Ereignisse und erfinde nichts, was nicht gesprochen wurde.',
      '- Do not change facts or events, and do not invent anything that was not spoken.'
    ),
    t(
      `- Bearbeite NUR die Datei ${workFile} mit kleinen edit-Operationen. Schreibe die Datei nicht komplett neu und gib das Transkript nicht in deiner Antwort aus.`,
      `- Edit ONLY the file ${workFile} with small edit operations. Do not rewrite the entire file and do not output the transcript in your response.`
    ),
    t(
      '- Arbeite zügig: Recherchiere höchstens kurz, wenn dir eine Schreibweise unsicher ist, aber schließe die Bearbeitung der Datei unbedingt ab.',
      '- Work efficiently: research briefly only when a spelling is uncertain, but always finish editing the file.'
    ),
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-rewrite-${sessionId}-${Date.now()}`,
    scopes: ['entity:read', 'diary:read'],
    user,
    language: runLanguage,
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

  const transcriptPath = join(session.directory, 'transcript.txt');
  await writeFile(transcriptPath, improved);
  updateSession(sessionId, {
    transcript: improved,
    transcriptImprovedAt: new Date().toISOString(),
  });

  log.info(`Improved transcript saved for session ${sessionId}`);
  return { transcript: improved };
}
