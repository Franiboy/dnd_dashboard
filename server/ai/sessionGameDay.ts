import { mkdirSync, writeFileSync } from 'node:fs';
import { createLogger } from '../logger.js';
import { getSessionById } from '../repositories/recordings.js';
import {
  getCurrentGameDay,
  getNextGameDay,
  listCampaignDays,
} from '../repositories/gameTimeline.js';
import { db } from '../database.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getModel } from './modelConfig.js';
import { runOpenCode } from './opencode.js';
import { getSessionWorkDir, getSessionWorkFile } from './sessionWorkdir.js';

const log = createLogger('sessionGameDay');

export interface SessionGameDayResult {
  gameDay: number | null;
  gameDayEnd: number | null;
}

function getPreviousSessionsContext(currentSessionId: number, limit = 5): string {
  try {
    const rows = db
      .prepare(
        `SELECT id, name, started_at AS startedAt, game_day AS gameDay, game_day_end AS gameDayEnd
         FROM recording_sessions
         WHERE id != ?
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(currentSessionId, limit) as {
      id: number;
      name: string;
      startedAt: string;
      gameDay: number | null;
      gameDayEnd: number | null;
    }[];
    if (rows.length === 0) return '(keine vorherigen Sessions)';
    return rows
      .map((r) => {
        const dayInfo =
          r.gameDay !== null
            ? r.gameDayEnd !== null && r.gameDayEnd !== r.gameDay
              ? `Spieltag ${r.gameDay}–${r.gameDayEnd}`
              : `Spieltag ${r.gameDay}`
            : 'Spieltag unbekannt';
        return `- Session ${r.id} (${r.name}, ${r.startedAt}): ${dayInfo}`;
      })
      .join('\n');
  } catch {
    return '(Kontext konnte nicht geladen werden)';
  }
}

export async function detectSessionGameDay(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  options?: { force?: boolean }
): Promise<SessionGameDayResult> {
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`detectSessionGameDay called without transcript for session ${sessionId}`);
    return { gameDay: null, gameDayEnd: null };
  }

  // Never overwrite a manually set day (requirement: "Nie überschreiben"),
  // unless explicitly forced (admin re-run).
  if (session.gameDay !== null && !options?.force) {
    log.info(
      `Session ${sessionId} already has gameDay ${session.gameDay}–${session.gameDayEnd ?? session.gameDay}, skipping auto-detection`
    );
    return { gameDay: session.gameDay, gameDayEnd: session.gameDayEnd ?? session.gameDay };
  }

  const workDir = getSessionWorkDir(sessionId);
  mkdirSync(workDir, { recursive: true });
  const workFile = getSessionWorkFile(sessionId);
  writeFileSync(workFile, session.transcript, 'utf-8');

  const currentGameDay = getCurrentGameDay();
  const nextGameDay = getNextGameDay();
  const campaignDays = listCampaignDays()
    .map((d) => d.day)
    .join(', ');
  const previousContext = getPreviousSessionsContext(sessionId);

  log.info(
    `Starting game day detection for session ${sessionId} (${session.transcript.length} bytes, currentDay=${currentGameDay}, next=${nextGameDay})`
  );

  const prompt = [
    'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Bestimme für die D&D-Session ${sessionId} (${session.name}, ${session.startedAt}) die betroffenen In-Game-Spieltage (game_day bis game_day_end).`,
    '',
    'Hintergrund:',
    '- Spieltage sind fortlaufende Integer (campaign_days). Der aktuelle Spieltag ist der höchste Tag in campaign_days.',
    `- Aktueller Spieltag der Kampagne: ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}.`,
    `- Nächster freier Spieltag: ${nextGameDay}.`,
    `- Bekannte Campaign-Tage: ${campaignDays || '(noch keine)'}.`,
    '- Vorherige Sessions (neueste zuerst):',
    previousContext,
    '',
    'Ein Tagebucheintrag entspricht einem Spieltag; eine Session kann aber mehrere Spieltage umspannen (Übernachtungen/Long Rests).',
    'game_day ist der erste Tag der Session (inklusive), game_day_end der letzte Tag (inklusive). Single-Day: beide gleich.',
    '',
    'Vorgehen:',
    `1. Lies die Datei ${workFile} mit dem read-Tool. Sie enthält das vollständige, ggf. verbesserte Transkript (mit Timestamps [MM:SS]/[HH:MM:SS]).`,
    `2. Nutze optional get_previous_session_summaries(sessionId=${sessionId}) und get_session_summary für narrativen Kontext, falls die Tageszuordnung unklar ist.`,
    '3. Analysiere das Transkript auf Zeit-Hinweise:',
    '   - Explizite Nennungen wie "Tag 5", "Spieltag 12", "Tag 3 bis 5".',
    '   - Implizite Tageswechsel: Long Rest / lange Rast / Übernachtung / "wir schlafen", "am nächsten Morgen", "Ihr erwacht", "es wird hell", "die Nacht bricht herein und endet".',
    '   - Kurzrast (short rest) zählt NICHT als Tageswechsel.',
    '   - DM-Ansagen wie "am nächsten Tag", "nach der Nachtruhe", "morgens", "abends des nächsten Tages".',
    '4. Bestimme startDay:',
    '   - Wenn das Transkript einen expliziten Start-Tag nennt, nutze diesen.',
    '   - Sonst: wenn der Inhalt direkt an die vorherige Session anschließt (gleiche Szene, kein Zeitsprung), nutze deren End-Tag.',
    '   - Sonst: nutze den nächsten freien Tag (nextGameDay) als Start. Rate bewusst – lasse NICHT null.',
    '5. Bestimme endDay:',
    '   - Zähle die impliziten Übernachtungen/Long Rests im Transkript. Jede Übernachtung = +1 Tag.',
    '   - Bei expliziter Bereichsangabe ("Tag 5 bis 7") nutze das Ende.',
    '   - Ohne Tageswechsel: end = start. Maximal 30 Tage Spanne (gameDayEnd - gameDay <= 30).',
    `6. Rufe genau einmal set_session_game_day(sessionId=${sessionId}, gameDay, gameDayEnd) auf. gameDayEnd kann = gameDay sein für Single-Day.`,
    '7. Gib danach nur eine kurze Bestätigung aus, z. B. "Spieltag gesetzt: X bis Y".',
    '',
    'Wichtig:',
    '- Du MUSST immer set_session_game_day aufrufen – auch bei Unsicherheit mit bester Schätzung (Bereich raten). Niemals ohne Tool-Aufruf enden.',
    '- Halte dich an die Transkript-Hinweise, erfinke aber keinen Widerspruch: wenn unklar, nimm Fortschreibung (previous.End+1 oder nextGameDay).',
    '- Verwende nur positive ganze Zahlen.',
    '- Verändere keine Dateien außer dem Tool-Aufruf.',
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-gameday-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'recording:game-day'],
    user,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for session game day ${sessionId}: exitCode=${result.exitCode}`);
    return { gameDay: null, gameDayEnd: null };
  }

  const updated = getSessionById(sessionId);
  if (updated?.gameDay === null || updated?.gameDay === undefined) {
    log.warn(`No game day saved for session ${sessionId} (AI may have skipped tool)`);
    return { gameDay: null, gameDayEnd: null };
  }

  log.info(
    `Game day for session ${sessionId}: ${updated.gameDay}–${updated.gameDayEnd ?? updated.gameDay}`
  );
  return { gameDay: updated.gameDay, gameDayEnd: updated.gameDayEnd ?? updated.gameDay };
}
