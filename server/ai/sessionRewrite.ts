import { createLogger } from '../logger.js';
import { getSessionById } from '../repositories/recordings.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getNormalModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';

const log = createLogger('sessionRewrite');

export interface SessionRewriteResult {
  transcript: string | null;
}

export async function improveSessionTranscriptWithAi(
  sessionId: number,
  transcript: string,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
): Promise<SessionRewriteResult> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    log.warn(`improveSessionTranscriptWithAi called with empty transcript for session ${sessionId}`);
    return { transcript: null };
  }

  log.info(`Starting transcript improvement for session ${sessionId}`);

  const prompt = [
    'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Verbessere das folgende Transkript der D&D-Session ${sessionId}.`,
    '',
    'Verfügbare Tools:',
    `- set_session_transcript(sessionId=${sessionId}, text): Speichert das verbesserte Transkript. MUSST du am Ende genau ein einziges Mal aufrufen.`,
    '- list_entities(type?): Listet alle bekannten Entitäten (Personen, Organisationen, Orte).',
    '- get_entity(type, name): Liefert Zusammenfassung, Wissen und Schreibweisen zu einer Entität.',
    '- search_diary_entries(query): Sucht in den Tagebüchern der Spieler.',
    '',
    'Wichtig:',
    '- Korrigiere offensichtliche Fehler der Spracherkennung: falsch geschriebene Namen, falsche oder verwechslte Wörter und versehentlich eingedeutschte oder fälschlich englische Wörter.',
    '- Nutze die bekannten Entitäten und die Tagebücher der Spieler, um die korrekten Namen und Begriffe zu ermitteln. Rufe list_entities, get_entity und search_diary_entries für erwähnte Personen, Orte und Organisationen auf, wenn dir Schreibweisen unsicher sind.',
    '- BEHALTE das Format exakt bei: Behalte alle Zeitstempel ([MM:SS] oder [HH:MM:SS]) und die Zeilenstruktur unverändert. Ändere nur den gesprochenen Text innerhalb einer Zeile. Füge keine Zeilen hinzu und entferne keine Zeilen.',
    '- Verändere keine Fakten oder Ereignisse und erfinde nichts, was nicht gesprochen wurde.',
    '- Gib nach dem Tool-Aufruf nur eine kurze Bestätigung aus, nicht das Transkript selbst.',
    '- DU MUSST die Tools nutzen, um unsichere Namen und Begriffe zu prüfen, BEVOR du set_session_transcript aufrufst.',
    '',
    'Transkript:',
    trimmed,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getNormalModel(),
    title: `dnd-session-rewrite-${sessionId}-${Date.now()}`,
    scopes: ['entity:read', 'diary:read', 'session:rewrite'],
    user,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for session ${sessionId}: exitCode=${result.exitCode}`);
    return { transcript: null };
  }

  const session = getSessionById(sessionId);
  if (!session || !session.transcript) {
    log.warn(`No transcript found for session ${sessionId} after improvement`);
    return { transcript: null };
  }

  log.info(`Improved transcript loaded for session ${sessionId}`);
  return { transcript: session.transcript };
}
