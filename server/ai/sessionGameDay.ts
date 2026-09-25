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
import { resolveSessionArcContext } from './arcContext.js';
import type { Language } from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

const log = createLogger('sessionGameDay');

export interface SessionGameDayResult {
  gameDay: number | null;
  gameDayEnd: number | null;
}

export function getPreviousSessionsContext(
  currentSessionId: number,
  limit = 5,
  language: Language = getAiLanguage()
): string {
  try {
    // Context is limited to sessions of the same story arc (NULL arc sees
    // only other unassigned sessions) so the day estimate stays arc-local.
    const rows = db
      .prepare(
        `SELECT id, name, started_at AS startedAt, game_day AS gameDay, game_day_end AS gameDayEnd
         FROM recording_sessions
         WHERE id != ?
           AND arc_id IS (SELECT arc_id FROM recording_sessions WHERE id = ?)
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(currentSessionId, currentSessionId, limit) as {
      id: number;
      name: string;
      startedAt: string;
      gameDay: number | null;
      gameDayEnd: number | null;
    }[];
    if (rows.length === 0) {
      return localize(language, '(keine vorherigen Sessions)', '(no previous sessions)');
    }
    return rows
      .map((r) => {
        const dayInfo =
          r.gameDay !== null
            ? r.gameDayEnd !== null && r.gameDayEnd !== r.gameDay
              ? localize(
                  language,
                  `Spieltag ${r.gameDay}–${r.gameDayEnd}`,
                  `game day ${r.gameDay}–${r.gameDayEnd}`
                )
              : localize(language, `Spieltag ${r.gameDay}`, `game day ${r.gameDay}`)
            : localize(language, 'Spieltag unbekannt', 'game day unknown');
        return localize(
          language,
          `- Session ${r.id} (${r.name}, ${r.startedAt}): ${dayInfo}`,
          `- Session ${r.id} (${r.name}, ${r.startedAt}): ${dayInfo}`
        );
      })
      .join('\n');
  } catch {
    return localize(
      language,
      '(Kontext konnte nicht geladen werden)',
      '(context could not be loaded)'
    );
  }
}

export async function detectSessionGameDay(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  options?: { force?: boolean; language?: Language }
): Promise<SessionGameDayResult> {
  const runLanguage = options?.language ?? getAiLanguage();
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`detectSessionGameDay called without transcript for session ${sessionId}`);
    return { gameDay: null, gameDayEnd: null };
  }

  // Never overwrite a manually set day unless explicitly forced (admin re-run).
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
  const previousContext = getPreviousSessionsContext(sessionId, 5, runLanguage);
  const arcContext = resolveSessionArcContext(sessionId, runLanguage);

  log.info(
    `Starting game day detection for session ${sessionId} (${session.transcript.length} bytes, currentDay=${currentGameDay}, next=${nextGameDay})`
  );

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Sessions-System. Du arbeitest mit Dateien und Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D session system. You work with files and tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Bestimme für die D&D-Session ${sessionId} (${session.name}, ${session.startedAt}) die betroffenen In-Game-Spieltage (game_day bis game_day_end).`,
      `Task: Determine the in-game days affected by D&D session ${sessionId} (${session.name}, ${session.startedAt}) (game_day through game_day_end).`
    ),
    ...(arcContext?.promptLines ?? []),
    '',
    t('Hintergrund:', 'Background:'),
    t(
      '- Spieltage sind fortlaufende Integer (campaign_days). Der aktuelle Spieltag ist der höchste Tag in campaign_days.',
      '- Game days are consecutive integers (campaign_days). The current game day is the highest day in campaign_days.'
    ),
    t(
      `- Aktueller Spieltag der Kampagne: ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}.`,
      `- Current campaign game day: ${currentGameDay ?? 'unknown (no game day has been set yet)'}.`
    ),
    t(`- Nächster freier Spieltag: ${nextGameDay}.`, `- Next available game day: ${nextGameDay}.`),
    t(
      `- Bekannte Campaign-Tage: ${campaignDays || '(noch keine)'}.`,
      `- Known campaign days: ${campaignDays || '(none yet)'}.`
    ),
    t('- Vorherige Sessions (neueste zuerst):', '- Previous sessions (newest first):'),
    previousContext,
    '',
    t(
      'Ein Tagebucheintrag entspricht einem Spieltag; eine Session kann aber mehrere Spieltage umspannen (Übernachtungen/Long Rests).',
      'One diary entry corresponds to one game day, but a session may span several game days (overnight stays or long rests).'
    ),
    t(
      'game_day ist der erste Tag der Session (inklusive), game_day_end der letzte Tag (inklusive). Single-Day: beide gleich.',
      'game_day is the first day of the session (inclusive), and game_day_end is the last day (inclusive). For a single-day session, both are equal.'
    ),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      `1. Lies die Datei ${workFile} mit dem read-Tool. Sie enthält das vollständige, ggf. verbesserte Transkript (mit Timestamps [MM:SS]/[HH:MM:SS]).`,
      `1. Read the file ${workFile} with the read tool. It contains the complete, possibly improved transcript (with timestamps [MM:SS]/[HH:MM:SS]).`
    ),
    t(
      `2. Nutze optional get_previous_session_summaries(sessionId=${sessionId}) und get_session_summary für narrativen Kontext, falls die Tageszuordnung unklar ist.`,
      `2. Optionally use get_previous_session_summaries(sessionId=${sessionId}) and get_session_summary for narrative context if the day assignment is unclear.`
    ),
    t(
      '3. Analysiere das Transkript auf Zeit-Hinweise:',
      '3. Analyze the transcript for time clues:'
    ),
    t(
      '   - Explizite Nennungen wie "Tag 5", "Spieltag 12", "Tag 3 bis 5".',
      '   - Explicit references such as "day 5", "game day 12", or "day 3 through 5".'
    ),
    t(
      '   - Implizite Tageswechsel: Long Rest / lange Rast / Übernachtung / "wir schlafen", "am nächsten Morgen", "Ihr erwacht", "es wird hell", "die Nacht bricht herein und endet".',
      '   - Implicit day changes: long rest / long break / overnight stay / "we sleep", "the next morning", "you awaken", "it gets light", or "the night passes and ends".'
    ),
    t(
      '   - Kurzrast (short rest) zählt NICHT als Tageswechsel.',
      '   - A short rest does NOT count as a day change.'
    ),
    t(
      '   - DM-Ansagen wie "am nächsten Tag", "nach der Nachtruhe", "morgens", "abends des nächsten Tages".',
      '   - DM statements such as "the next day", "after the night\'s rest", "in the morning", or "in the evening of the next day".'
    ),
    t('4. Bestimme startDay:', '4. Determine startDay:'),
    t(
      '   - Wenn das Transkript einen expliziten Start-Tag nennt, nutze diesen.',
      '   - If the transcript names an explicit start day, use it.'
    ),
    t(
      '   - Sonst: wenn der Inhalt direkt an die vorherige Session anschließt (gleiche Szene, kein Zeitsprung), nutze deren End-Tag.',
      "   - Otherwise, if the content directly continues the previous session (same scene, no time jump), use that session's end day."
    ),
    t(
      '   - Sonst: nutze den nächsten freien Tag (nextGameDay) als Start. Rate bewusst – lasse NICHT null.',
      '   - Otherwise, use the next available day (nextGameDay) as the start. Make a deliberate estimate; do NOT leave it null.'
    ),
    t('5. Bestimme endDay:', '5. Determine endDay:'),
    t(
      '   - Zähle die impliziten Übernachtungen/Long Rests im Transkript. Jede Übernachtung = +1 Tag.',
      '   - Count implicit overnight stays or long rests in the transcript. Each overnight stay = +1 day.'
    ),
    t(
      '   - Bei expliziter Bereichsangabe ("Tag 5 bis 7") nutze das Ende.',
      '   - For an explicit range ("day 5 through 7"), use the stated end.'
    ),
    t(
      '   - Ohne Tageswechsel: end = start. Maximal 30 Tage Spanne (gameDayEnd - gameDay <= 30).',
      '   - Without a day change: end = start. The maximum span is 30 days (gameDayEnd - gameDay <= 30).'
    ),
    t(
      `6. Rufe genau einmal set_session_game_day(sessionId=${sessionId}, gameDay, gameDayEnd) auf. gameDayEnd kann = gameDay sein für Single-Day.`,
      `6. Call set_session_game_day(sessionId=${sessionId}, gameDay, gameDayEnd) exactly once. gameDayEnd may equal gameDay for a single-day session.`
    ),
    t(
      '7. Gib danach nur eine kurze Bestätigung aus, z. B. "Spieltag gesetzt: X bis Y".',
      '7. Then output only a short confirmation, for example "Game day set: X through Y".'
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- Du MUSST immer set_session_game_day aufrufen – auch bei Unsicherheit mit bester Schätzung (Bereich raten). Niemals ohne Tool-Aufruf enden.',
      '- You MUST always call set_session_game_day, even when uncertain, using your best estimate (guess a range if necessary). Never finish without the tool call.'
    ),
    t(
      '- Halte dich an die Transkript-Hinweise, erfinke aber keinen Widerspruch: wenn unklar, nimm Fortschreibung (previous.End+1 oder nextGameDay).',
      '- Follow the transcript clues but do not invent a contradiction: if unclear, continue from the previous session (previous.End+1 or nextGameDay).'
    ),
    t('- Verwende nur positive ganze Zahlen.', '- Use positive integers only.'),
    t(
      '- Verändere keine Dateien außer dem Tool-Aufruf.',
      '- Do not change any files apart from the tool call.'
    ),
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-gameday-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'recording:game-day'],
    user,
    recordingSessionId: sessionId,
    arcId: arcContext?.arcId,
    language: runLanguage,
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
