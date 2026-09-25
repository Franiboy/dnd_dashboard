import { describe, expect, it } from 'vitest';
import { db } from './database.js';
import { schema } from './schema.js';
import { runMigrations } from './migrations.js';

describe('schema migrations', () => {
  it('creates every table declared in the schema', () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const tables = rows.map((r) => r.name);
    for (const name of Object.keys(schema)) {
      expect(tables).toContain(name);
    }
  });

  it('adds the expected columns for each declared table', () => {
    for (const [table, def] of Object.entries(schema)) {
      const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
      const names = new Set(cols.map((c) => c.name));
      for (const col of Object.keys(def.columns)) {
        expect(names.has(col), `${table}.${col} missing`).toBe(true);
      }
    }
  });

  it('creates the declared indexes', () => {
    for (const [table, def] of Object.entries(schema)) {
      for (const idx of def.indexes ?? []) {
        const row = db
          .prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? AND tbl_name = ?')
          .get('index', idx.name, table);
        expect(row, `index ${idx.name} on ${table} missing`).toBeDefined();
      }
    }
  });

  it('is idempotent (running migrations again is a no-op)', () => {
    expect(() => runMigrations()).not.toThrow();
    // Schema is still intact after the second run.
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const tables = rows.map((r) => r.name);
    for (const name of Object.keys(schema)) {
      expect(tables).toContain(name);
    }
  });

  it('migrates legacy ai_settings normal/cheap overrides into the single model column', () => {
    // Simulate a legacy database that still carries the old columns.
    db.exec('ALTER TABLE ai_settings ADD COLUMN normal_model TEXT');
    db.exec('ALTER TABLE ai_settings ADD COLUMN cheap_model TEXT');
    db.prepare('INSERT INTO ai_settings (id, model) VALUES (1, NULL)').run();
    db.prepare(
      "UPDATE ai_settings SET normal_model = 'opencode/legacy-normal', cheap_model = 'opencode/legacy-cheap' WHERE id = 1"
    ).run();

    runMigrations();

    const row = db.prepare('SELECT model FROM ai_settings WHERE id = 1').get() as {
      model: string | null;
    };
    expect(row.model).toBe('opencode/legacy-normal');
  });

  it('adds and backfills a valid default for the global AI language', () => {
    db.exec('ALTER TABLE ai_settings DROP COLUMN language');
    db.prepare('INSERT OR IGNORE INTO ai_settings (id, model) VALUES (1, NULL)').run();

    runMigrations();
    expect(
      (db.prepare('SELECT language FROM ai_settings WHERE id = 1').get() as { language: string })
        .language
    ).toBe('de');

    db.prepare("UPDATE ai_settings SET language = 'fr' WHERE id = 1").run();
    runMigrations();
    expect(
      (db.prepare('SELECT language FROM ai_settings WHERE id = 1').get() as { language: string })
        .language
    ).toBe('de');
  });

  it('rebuilds whiteboard_elements so shape/stroke rows pass the type check', () => {
    // Simulate a pre-shape database: old CHECK constraint, no drawing columns.
    db.exec('DROP INDEX IF EXISTS idx_whiteboard_elements_owner_zone');
    db.exec(`
      CREATE TABLE whiteboard_elements_legacy (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        zone TEXT NOT NULL DEFAULT 'private',
        owner_id TEXT NOT NULL,
        owner_name TEXT NOT NULL DEFAULT '',
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        x2 REAL,
        y2 REAL,
        width REAL NOT NULL DEFAULT 200,
        height REAL NOT NULL DEFAULT 160,
        color TEXT NOT NULL DEFAULT '#facc15',
        text TEXT NOT NULL DEFAULT '',
        description TEXT,
        status TEXT,
        url TEXT,
        from_id TEXT,
        to_id TEXT,
        locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (type IN ('note', 'task', 'arrow', 'link') AND zone IN ('public', 'private'))
      );
    `);
    const now = new Date().toISOString();
    db.exec('DROP TABLE whiteboard_elements;');
    db.exec('ALTER TABLE whiteboard_elements_legacy RENAME TO whiteboard_elements;');
    db.prepare(
      `INSERT INTO whiteboard_elements
         (id, type, zone, owner_id, owner_name, x, y, width, height, color, created_at, updated_at)
       VALUES ('wb-legacy-note-1', 'note', 'public', 'user-1', 'User', 1, 2, 200, 150, '#ffffff', ?, ?)`
    ).run(now, now);

    runMigrations();

    // Existing rows survive the rebuild...
    const kept = db
      .prepare("SELECT id FROM whiteboard_elements WHERE id = 'wb-legacy-note-1'")
      .get();
    expect(kept).toBeDefined();
    // ...and the rebuilt table accepts the new element types.
    expect(() =>
      db
        .prepare(
          `INSERT INTO whiteboard_elements
           (id, type, zone, owner_id, owner_name, x, y, width, height, stroke_width, points, created_at, updated_at)
         VALUES ('wb-mig-shape-1', 'shape', 'public', 'user-1', 'User', 0, 0, 100, 100, 4, '[[0,0],[1,1]]', ?, ?)`
        )
        .run(now, now)
    ).not.toThrow();
  });

  it('backfills game_day onto knowledge entries from their session/diary origin', () => {
    // Create a session and diary entry without game_day (legacy rows already
    // got one by setup; insert NULL explicitly via a fresh daily row).
    const now = new Date().toISOString();
    const sid = Number(
      db
        .prepare(
          `INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory, game_day)
           VALUES ('Legacy', 'stopped', 'g', 'c', 'tester', ?, 'dir', NULL)`
        )
        .run(now).lastInsertRowid
    );
    const did = Number(
      db
        .prepare(
          `INSERT INTO diary_entries (user_id, title, content, created_at, updated_at, game_day)
           VALUES ('tester', 'Legacy Diary', 'Inhalt', ?, ?, NULL)`
        )
        .run(now, now).lastInsertRowid
    );

    const eidS = Number(
      db
        .prepare(
          `INSERT INTO entity_knowledge_entries (entity_type, entity_name, title, content, source, status, created_at, updated_at, origin_type, origin_id)
           VALUES ('persons', 'Legacy Origin S', NULL, 'Fakt', 'ai_extracted', 'active', ?, ?, 'session', ?)`
        )
        .run(now, now, sid).lastInsertRowid
    );
    const eidD = Number(
      db
        .prepare(
          `INSERT INTO entity_knowledge_entries (entity_type, entity_name, title, content, source, status, created_at, updated_at, origin_type, origin_id)
           VALUES ('persons', 'Legacy Origin D', NULL, 'Fakt', 'ai_extracted', 'active', ?, ?, 'diary', ?)`
        )
        .run(now, now, did).lastInsertRowid
    );

    runMigrations();

    const sessionDay = db
      .prepare('SELECT game_day AS d FROM recording_sessions WHERE id = ?')
      .get(sid) as { d: number | null };
    const gotS = db
      .prepare('SELECT valid_from AS v FROM entity_knowledge_entries WHERE id = ?')
      .get(eidS) as { v: number | null };
    const gotD = db
      .prepare('SELECT valid_from AS v FROM entity_knowledge_entries WHERE id = ?')
      .get(eidD) as { v: number | null };

    // The backfill assigned a real day to the legacy rows...
    expect(sessionDay.d).toBeGreaterThan(0);
    // ...and the knowledge entries inherited it as their valid_from.
    expect(gotS.v).toBe(sessionDay.d);
    expect(gotD.v).toBeTruthy();
  });

  it('seeds the central campaign_days timeline from existing game_day rows', () => {
    // A session with a known day plus one with a freshly assigned legacy day.
    const now = new Date().toISOString();
    const legacySid = Number(
      db
        .prepare(
          `INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory, game_day)
           VALUES ('Campaign Seed', 'stopped', 'g', 'c', 'tester', ?, 'dir', NULL)`
        )
        .run(now).lastInsertRowid
    );

    runMigrations();

    const legacyDay = db
      .prepare('SELECT game_day AS d FROM recording_sessions WHERE id = ?')
      .get(legacySid) as { d: number | null };
    expect(legacyDay.d).toBeGreaterThan(0);

    // campaign_days must contain the day and the current day is the highest.
    const seeded = db.prepare('SELECT day FROM campaign_days WHERE day = ?').get(legacyDay.d) as
      { day: number } | undefined;
    expect(seeded).toBeDefined();

    const current = db.prepare('SELECT MAX(day) AS m FROM campaign_days').get() as {
      m: number | null;
    };
    expect(current.m).toBeGreaterThanOrEqual(legacyDay.d as number);
  });
});
