import { db } from '../database.js';
import type { TimelineDiaryLink, TimelineEvent, TimelineEventInput } from '../../shared/types.js';

/**
 * AI-generated campaign timeline: notable events per session, positioned on
 * the in-game day axis and filed into the session's story arc. Regeneration
 * for a session is transactional (replace all events + scenes); the arc is
 * captured from the session at write time, so arc re-assignments surface as
 * staleness on the next pending check.
 */

export interface PendingTimelineSession {
  id: number;
  name: string;
  arcId: number | null;
  longSummaryGeneratedAt: string | null;
}

interface EventRow {
  id: number;
  game_day: number;
  arc_id: number | null;
  session_id: number;
  title: string;
  description: string | null;
  generated_at: string;
  updated_at: string;
}

interface SceneRow {
  id: number;
  event_id: number;
  game_day: number;
  position: number;
  title: string;
  description: string | null;
}

interface DiaryLinkRow {
  id: number;
  title: string;
  display_name: string | null;
}

/**
 * Sessions ready for timeline generation: completed, transcribed, with an
 * in-game day and a finished long summary. A session is pending when it has
 * no events yet, or when its newest events are older than the current long
 * summary / were generated for a different arc (stale after re-summary or
 * arc re-assignment).
 */
export function listSessionsPendingTimeline(): PendingTimelineSession[] {
  return db
    .prepare(
      `SELECT s.id, s.name, s.arc_id as arcId, s.long_summary_generated_at as longSummaryGeneratedAt
       FROM recording_sessions s
       WHERE s.status = 'completed'
         AND s.transcript IS NOT NULL
         AND s.game_day IS NOT NULL
         AND s.long_summary IS NOT NULL
         AND s.long_summary_generated_at IS NOT NULL
         AND (
           NOT EXISTS (SELECT 1 FROM timeline_events e WHERE e.session_id = s.id)
           OR EXISTS (
             SELECT 1 FROM timeline_events e
             WHERE e.session_id = s.id
               AND (e.generated_at < s.long_summary_generated_at
                    OR e.arc_id IS NOT s.arc_id)
           )
         )
       ORDER BY s.started_at ASC`
    )
    .all() as PendingTimelineSession[];
}

interface TimelineEventContext {
  sessionName: string | null;
  sessionUserId: string | null;
}

/**
 * Events with their scenes and diary links. Diary entries are private per
 * author: players only see links to their own entries on the event's game
 * day, admins see every author's entry.
 */
export function listTimelineEvents(
  viewer: { userId: string; isAdmin: boolean },
  arcId?: number
): TimelineEvent[] {
  const params: (string | number)[] = [];
  let arcFilter = '';
  if (arcId !== undefined) {
    arcFilter = 'WHERE e.arc_id = ?';
    params.push(arcId);
  }
  const eventRows = db
    .prepare(
      `SELECT e.id, e.game_day, e.arc_id, e.session_id, e.title, e.description,
              e.generated_at, e.updated_at
       FROM timeline_events e
       ${arcFilter}
       ORDER BY e.game_day ASC, e.id ASC`
    )
    .all(...params) as EventRow[];

  if (eventRows.length === 0) return [];

  const eventIds = eventRows.map((row) => row.id);
  const placeholders = eventIds.map(() => '?').join(',');
  const sceneRows = db
    .prepare(
      `SELECT id, event_id, game_day, position, title, description
       FROM timeline_scenes WHERE event_id IN (${placeholders})
       ORDER BY position ASC, id ASC`
    )
    .all(...eventIds) as SceneRow[];

  // Diary links: entries of the viewing user (or every author for admins)
  // whose game day matches one of the events. Cross-join in SQL to keep the
  // per-event lookups out of the loop.
  const dayPlaceholders = [...new Set(eventRows.map((row) => row.game_day))]
    .map(() => '?')
    .join(',');
  const diaryParams: (string | number)[] = [...new Set(eventRows.map((row) => row.game_day))];
  if (!viewer.isAdmin) diaryParams.push(viewer.userId);
  const diaryRows = db
    .prepare(
      `SELECT d.id, d.title, d.game_day, u.display_name
       FROM diary_entries d JOIN users u ON u.id = d.user_id
       WHERE d.game_day IN (${dayPlaceholders})${viewer.isAdmin ? '' : ' AND d.user_id = ?'}
       ORDER BY d.id ASC`
    )
    .all(...diaryParams) as (DiaryLinkRow & { game_day: number | null })[];

  const scenesByEvent = new Map<number, SceneRow[]>();
  for (const scene of sceneRows) {
    const list = scenesByEvent.get(scene.event_id) ?? [];
    list.push(scene);
    scenesByEvent.set(scene.event_id, list);
  }

  // Session names for display; kept in one query to avoid N lookups.
  const sessionIds = [...new Set(eventRows.map((row) => row.session_id))];
  const sessionPlaceholders = sessionIds.map(() => '?').join(',');
  const sessionRows = db
    .prepare(
      `SELECT id, name, created_by FROM recording_sessions WHERE id IN (${sessionPlaceholders})`
    )
    .all(...sessionIds) as { id: number; name: string; created_by: string }[];
  const sessionContext = new Map<number, TimelineEventContext>();
  for (const row of sessionRows) {
    sessionContext.set(row.id, { sessionName: row.name, sessionUserId: row.created_by });
  }

  const diaryByDay = new Map<number, DiaryLinkRow[]>();
  for (const row of diaryRows) {
    if (row.game_day === null) continue;
    const list = diaryByDay.get(row.game_day) ?? [];
    list.push({ id: row.id, title: row.title, display_name: row.display_name });
    diaryByDay.set(row.game_day, list);
  }

  return eventRows.map((row) => ({
    id: row.id,
    gameDay: row.game_day,
    arcId: row.arc_id,
    sessionId: row.session_id,
    sessionName: sessionContext.get(row.session_id)?.sessionName ?? null,
    title: row.title,
    description: row.description,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    scenes: (scenesByEvent.get(row.id) ?? []).map((scene) => ({
      id: scene.id,
      eventId: scene.event_id,
      gameDay: scene.game_day,
      position: scene.position,
      title: scene.title,
      description: scene.description,
    })),
    diaryLinks: (diaryByDay.get(row.game_day) ?? []).map((link): TimelineDiaryLink => ({
      entryId: link.id,
      title: link.title,
      displayName: viewer.isAdmin ? (link.display_name ?? null) : null,
    })),
  }));
}

/** Number of timeline events a session currently has (AI write verification). */
export function countSessionEvents(sessionId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM timeline_events WHERE session_id = ?')
    .get(sessionId) as { n: number };
  return row.n;
}

export interface TimelineSessionWrite {
  gameDay: number;
  title: string;
  description: string | null;
  scenes: TimelineEventInput['scenes'];
}

/**
 * Replaces every event of the session with the given generation result in one
 * transaction. Arc and display day are captured from the session so the AI
 * cannot pin events to a foreign arc. Sessions without events end up empty.
 */
export function replaceSessionEvents(sessionId: number, events: TimelineEventInput[]): void {
  const session = db
    .prepare('SELECT arc_id, game_day FROM recording_sessions WHERE id = ?')
    .get(sessionId) as { arc_id: number | null; game_day: number | null } | undefined;
  if (!session) return;

  const arcId = session.arc_id;
  const fallbackDay = session.game_day;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM timeline_events WHERE session_id = ?').run(sessionId);
    const insertEvent = db.prepare(
      `INSERT INTO timeline_events (game_day, arc_id, session_id, title, description, generated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertScene = db.prepare(
      `INSERT INTO timeline_scenes (event_id, game_day, position, title, description)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const event of events) {
      const day =
        Number.isInteger(event.gameDay) && event.gameDay > 0 ? event.gameDay : fallbackDay;
      if (day === null) continue;
      const result = insertEvent.run(
        day,
        arcId,
        sessionId,
        event.title.trim(),
        event.description?.trim() || null,
        now,
        now
      );
      const eventId = Number(result.lastInsertRowid);
      event.scenes.forEach((scene, index) => {
        const sceneDay = Number.isInteger(scene.gameDay) && scene.gameDay > 0 ? scene.gameDay : day;
        insertScene.run(
          eventId,
          sceneDay,
          index,
          scene.title.trim(),
          scene.description?.trim() || null
        );
      });
    }
  });
  tx();
}
