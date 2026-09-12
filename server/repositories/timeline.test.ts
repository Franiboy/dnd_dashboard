import { describe, expect, it } from 'vitest';
import { db } from '../database.js';
import { runMigrations } from '../migrations.js';
import {
  listSessionsPendingTimeline,
  listTimelineEvents,
  replaceSessionEvents,
} from './timeline.js';
import { createStoryArc, activateStoryArc } from './storyArcs.js';

interface InsertSessionOptions {
  arcId?: number | null;
  gameDay?: number | null;
  longSummary?: string | null;
  longSummaryGeneratedAt?: string | null;
  status?: string;
  startedAt?: string;
}

function insertSession(options: InsertSessionOptions = {}): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO recording_sessions
           (name, status, guild_id, channel_id, created_by, started_at, directory, transcript,
            long_summary, long_summary_generated_at, arc_id, game_day, game_day_end)
         VALUES (?, ?, 'g', 'c', 'tester', ?, 'dir', 'transcript text', ?, ?, ?, ?, ?)`
      )
      .run(
        'Session',
        options.status ?? 'completed',
        options.startedAt ?? now,
        // Long summary + timestamp are the gate for pending-ness; both must be
        // present for a session to be considered at all.
        options.longSummary !== undefined ? options.longSummary : 'long summary',
        options.longSummaryGeneratedAt !== undefined ? options.longSummaryGeneratedAt : now,
        options.arcId ?? null,
        options.gameDay ?? null,
        options.gameDay ?? null
      ).lastInsertRowid
  );
}

function insertUser(id: string): void {
  db.prepare(
    `INSERT INTO users (id, username, display_name, is_approved, disabled_apps, failed_login_attempts, created_at)
     VALUES (?, ?, ?, 1, '[]', 0, ?)`
  ).run(id, id, id, new Date().toISOString());
}

function insertEntry(user: string, gameDay: number | null): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO diary_entries (user_id, title, content, arc_id, game_day, created_at, updated_at)
         VALUES (?, 'Tagebucheintrag', 'Inhalt', NULL, ?, ?, ?)`
      )
      .run(user, gameDay, now, now).lastInsertRowid
  );
}

describe('timeline repository', () => {
  it('treats sessions without events as pending once a summary exists', () => {
    runMigrations();
    const withoutSummary = insertSession({
      gameDay: 1,
      longSummary: null,
      longSummaryGeneratedAt: null,
    });
    const withSummary = insertSession({ gameDay: 2 });
    insertSession({ gameDay: 3, status: 'recording' });
    insertSession({ gameDay: null });

    const pending = listSessionsPendingTimeline().map((s) => s.id);
    expect(pending).toContain(withSummary);
    expect(pending).not.toContain(withoutSummary);
  });

  it('marks sessions stale after a newer summary and after arc re-assignment', () => {
    runMigrations();
    const arcA = createStoryArc({ name: 'Kapitel A' });
    const arcB = createStoryArc({ name: 'Kapitel B' });
    const sessionId = insertSession({ arcId: arcA.id, gameDay: 5 });

    replaceSessionEvents(sessionId, [
      {
        gameDay: 5,
        title: 'Erstes Ereignis',
        description: '<p>Beschreibung</p>',
        scenes: [{ gameDay: 5, title: 'Szene', description: null }],
      },
    ]);
    expect(listSessionsPendingTimeline().map((s) => s.id)).not.toContain(sessionId);

    // Backdating the events makes them older than the summary -> stale.
    db.prepare('UPDATE timeline_events SET generated_at = ? WHERE session_id = ?').run(
      new Date(Date.now() - 60000).toISOString(),
      sessionId
    );
    expect(listSessionsPendingTimeline().map((s) => s.id)).toContain(sessionId);

    // Regenerating again clears it; re-assigning the arc makes it stale again.
    replaceSessionEvents(sessionId, [{ gameDay: 5, title: 'Neu', description: null, scenes: [] }]);
    expect(listSessionsPendingTimeline().map((s) => s.id)).not.toContain(sessionId);
    db.prepare('UPDATE recording_sessions SET arc_id = ? WHERE id = ?').run(arcB.id, sessionId);
    expect(listSessionsPendingTimeline().map((s) => s.id)).toContain(sessionId);
  });

  it('writes events with arc and day from the session and cascades scenes', () => {
    runMigrations();
    const arc = createStoryArc({ name: 'Kapitel C' });
    activateStoryArc(arc.id);
    const sessionId = insertSession({ arcId: arc.id, gameDay: 7 });

    replaceSessionEvents(sessionId, [
      {
        gameDay: 999,
        title: 'Drachenkampf',
        description: '<p>Sieg über den Drachen</p>',
        scenes: [
          { gameDay: 7, title: 'Vorbereitung', description: null },
          { gameDay: 7, title: 'Kampf', description: '<p>Der Kampf</p>' },
        ],
      },
      { gameDay: 0, title: 'Ohne gültigen Tag', description: null, scenes: [] },
    ]);

    const events = listTimelineEvents({ userId: 'tester', isAdmin: false }).filter(
      (e) => e.sessionId === sessionId
    );
    expect(events).toHaveLength(2);
    const battle = events.find((e) => e.title === 'Drachenkampf');
    // A plausible AI day is taken as-is, positioned on the campaign axis.
    expect(battle?.gameDay).toBe(999);
    expect(battle?.arcId).toBe(arc.id);
    expect(battle?.scenes).toHaveLength(2);
    expect(battle?.scenes.map((s) => s.title)).toEqual(['Vorbereitung', 'Kampf']);
    // An invalid day (0) falls back to the session's game day.
    const invalid = events.find((e) => e.title === 'Ohne gültigen Tag');
    expect(invalid?.gameDay).toBe(7);

    // Regeneration replaces events and scenes instead of appending.
    replaceSessionEvents(sessionId, [
      { gameDay: 7, title: 'Nur noch eins', description: null, scenes: [] },
    ]);
    const after = listTimelineEvents({ userId: 'tester', isAdmin: false }).filter(
      (e) => e.sessionId === sessionId
    );
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe('Nur noch eins');
    expect(after[0].scenes).toHaveLength(0);
  });

  it('links diary entries of the same game day, scoped to the viewer', () => {
    runMigrations();
    insertUser('tester');
    insertUser('someone-else');
    const sessionId = insertSession({ gameDay: 10 });
    replaceSessionEvents(sessionId, [
      { gameDay: 10, title: 'Begegnung', description: null, scenes: [] },
    ]);
    const ownEntry = insertEntry('tester', 10);
    const otherEntry = insertEntry('someone-else', 10);

    const asPlayer = listTimelineEvents({ userId: 'tester', isAdmin: false }).find(
      (e) => e.sessionId === sessionId
    )!;
    expect(asPlayer.diaryLinks.map((l) => l.entryId)).toEqual([ownEntry]);
    expect(asPlayer.diaryLinks[0].displayName).toBeNull();

    const asAdmin = listTimelineEvents({ userId: 'admin', isAdmin: true }).find(
      (e) => e.sessionId === sessionId
    )!;
    expect(asAdmin.diaryLinks.map((l) => l.entryId)).toEqual([ownEntry, otherEntry]);
    expect(asAdmin.diaryLinks[0].displayName).toBe('tester');
  });
});
