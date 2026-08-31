import { db } from '../database.js';

/**
 * Shared "now" reference for in-game time.
 *
 * The campaign timeline is the central, monotonic campaign_days table (one row
 * per in-game day). Recording sessions and diary entries reference a day via
 * their game_day column; knowledge entries reference the same day numbers via
 * their validity window (valid_from / valid_until). The current day is the
 * highest day present in campaign_days.
 */

export interface CampaignDay {
  day: number;
  /** Optional display label, e.g. "Feast of the Moon". */
  label: string | null;
}

export function listCampaignDays(): CampaignDay[] {
  const rows = db
    .prepare('SELECT day, label FROM campaign_days ORDER BY day ASC')
    .all() as CampaignDay[];
  return rows;
}

export function getCampaignDay(day: number): CampaignDay | null {
  const row = db.prepare('SELECT day, label FROM campaign_days WHERE day = ?').get(day) as
    CampaignDay | undefined;
  return row ?? null;
}

export function getCurrentGameDay(): number | null {
  const row = db.prepare('SELECT MAX(day) AS m FROM campaign_days').get() as { m: number | null };
  return row.m ?? null;
}

/** Next free in-game day (one above the highest known), or 1 for an empty timeline. */
export function getNextGameDay(): number {
  return (getCurrentGameDay() ?? 0) + 1;
}

/**
 * Registers a campaign day with the given label (upsert by day). Ensures the
 * in-game timeline row exists so sessions/diary entries can reference it and
 * the current day advances.
 */
export function ensureCampaignDay(day: number, label: string | null): CampaignDay {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO campaign_days (day, label, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       label = COALESCE(excluded.label, campaign_days.label),
       updated_at = excluded.updated_at`
  ).run(day, label?.trim() ?? null, now, now);
  return getCampaignDay(day)!;
}

export function getSessionGameDay(sessionId: number): number | null {
  const row = db
    .prepare('SELECT game_day AS d FROM recording_sessions WHERE id = ?')
    .get(sessionId) as { d: number | null } | undefined;
  return row?.d ?? null;
}

export function getSessionGameDayRange(
  sessionId: number
): { start: number | null; end: number | null } | null {
  const row = db
    .prepare('SELECT game_day AS start, game_day_end AS end FROM recording_sessions WHERE id = ?')
    .get(sessionId) as { start: number | null; end: number | null } | undefined;
  return row ? { start: row.start, end: row.end ?? row.start } : null;
}

export function getDiaryGameDay(entryId: number): number | null {
  const row = db.prepare('SELECT game_day AS d FROM diary_entries WHERE id = ?').get(entryId) as
    { d: number | null } | undefined;
  return row?.d ?? null;
}

export function setSessionGameDay(
  sessionId: number,
  gameDay: number | null,
  gameDateLabel: string | null
): void {
  if (gameDay !== null) ensureCampaignDay(gameDay, gameDateLabel);
  db.prepare(
    'UPDATE recording_sessions SET game_day = ?, game_date_label = ?, updated_at = ? WHERE id = ?'
  ).run(gameDay, gameDateLabel?.trim() ?? null, new Date().toISOString(), sessionId);
}

export function setSessionGameDayRange(
  sessionId: number,
  gameDayStart: number | null,
  gameDayEnd: number | null,
  gameDateLabel: string | null
): void {
  const start = gameDayStart;
  const end = gameDayEnd ?? start;
  if (start !== null) {
    for (let d = start; d <= (end ?? start); d++) {
      ensureCampaignDay(d, d === start ? gameDateLabel : null);
    }
  }
  db.prepare(
    'UPDATE recording_sessions SET game_day = ?, game_day_end = ?, game_date_label = ?, updated_at = ? WHERE id = ?'
  ).run(start, end, gameDateLabel?.trim() ?? null, new Date().toISOString(), sessionId);
}

export function setDiaryGameDay(
  entryId: number,
  gameDay: number | null,
  gameDateLabel: string | null
): void {
  if (gameDay !== null) ensureCampaignDay(gameDay, gameDateLabel);
  db.prepare(
    'UPDATE diary_entries SET game_day = ?, game_date_label = ?, updated_at = ? WHERE id = ?'
  ).run(gameDay, gameDateLabel?.trim() ?? null, new Date().toISOString(), entryId);
}
