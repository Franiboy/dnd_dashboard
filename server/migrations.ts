import { db } from './database.js';

interface Migration {
  name: string;
  run: () => void;
}

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    );
  `);
}

function wasApplied(name: string): boolean {
  const row = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(name) as
    | { '1': number }
    | undefined;
  return !!row;
}

function markApplied(name: string) {
  db.prepare('INSERT INTO migrations (name, appliedAt) VALUES (?, ?)').run(
    name,
    new Date().toISOString(),
  );
}

const migrations: Migration[] = [
  {
    name: 'create_users_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          password_hash TEXT,
          discord_id TEXT UNIQUE,
          avatar_url TEXT,
          is_admin INTEGER NOT NULL DEFAULT 0,
          is_approved INTEGER NOT NULL DEFAULT 0,
          can_access_previews INTEGER NOT NULL DEFAULT 0,
          failed_login_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: 'create_games_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY,
          data TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: 'create_feature_requests_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS feature_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          requestedBy TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          branch TEXT,
          worktreePath TEXT,
          previewPort INTEGER,
          previewUrl TEXT,
          previewPid INTEGER,
          sessionTitle TEXT,
          sessionId TEXT,
          logs TEXT NOT NULL DEFAULT '',
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: 'add_users_can_access_previews',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(users)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'can_access_previews')) {
        db.exec('ALTER TABLE users ADD COLUMN can_access_previews INTEGER NOT NULL DEFAULT 0');
      }
    },
  },
  {
    name: 'add_feature_requests_session_columns',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(feature_requests)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'sessionTitle')) {
        db.exec('ALTER TABLE feature_requests ADD COLUMN sessionTitle TEXT');
      }
      if (!columns.some((c) => c.name === 'sessionId')) {
        db.exec('ALTER TABLE feature_requests ADD COLUMN sessionId TEXT');
      }
    },
  },
  {
    name: 'create_recording_tables',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recording_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'recording',
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          created_by TEXT NOT NULL,
          started_at TEXT NOT NULL,
          stopped_at TEXT,
          directory TEXT NOT NULL,
          transcript TEXT,
          error TEXT
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS recording_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          pcm_path TEXT NOT NULL,
          wav_path TEXT,
          duration REAL,
          transcript_path TEXT,
          FOREIGN KEY (session_id) REFERENCES recording_sessions(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    name: 'create_diary_entries_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS diary_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          summary TEXT,
          rewritten_content TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: 'remove_diary_entry_date',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(diary_entries)').all() as { name: string }[];
      if (columns.some((c) => c.name === 'entry_date')) {
        db.exec('ALTER TABLE diary_entries DROP COLUMN entry_date');
      }
    },
  },
  {
    name: 'add_diary_summary',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(diary_entries)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'summary')) {
        db.exec('ALTER TABLE diary_entries ADD COLUMN summary TEXT');
      }
    },
  },
  {
    name: 'create_persons_tables',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS persons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS diary_entry_persons (
          diary_entry_id INTEGER NOT NULL,
          person_id INTEGER NOT NULL,
          PRIMARY KEY (diary_entry_id, person_id),
          FOREIGN KEY (diary_entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE,
          FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    name: 'create_organizations_and_locations_tables',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS diary_entry_organizations (
          diary_entry_id INTEGER NOT NULL,
          organization_id INTEGER NOT NULL,
          PRIMARY KEY (diary_entry_id, organization_id),
          FOREIGN KEY (diary_entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS diary_entry_locations (
          diary_entry_id INTEGER NOT NULL,
          location_id INTEGER NOT NULL,
          PRIMARY KEY (diary_entry_id, location_id),
          FOREIGN KEY (diary_entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE,
          FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    name: 'create_entity_blacklist_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entity_blacklist (
          type TEXT NOT NULL CHECK(type IN ('persons', 'organizations', 'locations')),
          name TEXT NOT NULL,
          PRIMARY KEY (type, name)
        );
      `);
    },
  },
  {
    name: 'migrate_entity_blacklist_types',
    run: () => {
      const tableExists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_blacklist'")
        .get() as { '1': number } | undefined;
      if (!tableExists) return;

      db.exec(`
        ALTER TABLE entity_blacklist RENAME TO entity_blacklist_old;
      `);
      db.exec(`
        CREATE TABLE entity_blacklist (
          type TEXT NOT NULL CHECK(type IN ('persons', 'organizations', 'locations')),
          name TEXT NOT NULL,
          PRIMARY KEY (type, name)
        );
      `);
      db.exec(`
        INSERT OR IGNORE INTO entity_blacklist (type, name)
        SELECT
          CASE type
            WHEN 'person' THEN 'persons'
            WHEN 'organization' THEN 'organizations'
            WHEN 'location' THEN 'locations'
            ELSE type
          END,
          name
        FROM entity_blacklist_old;
      `);
      db.exec(`DROP TABLE entity_blacklist_old;`);
    },
  },
  {
    name: 'create_entity_aliases_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entity_aliases (
          type TEXT NOT NULL CHECK(type IN ('persons', 'organizations', 'locations')),
          alias TEXT NOT NULL,
          canonical TEXT NOT NULL,
          PRIMARY KEY (type, alias)
        );
      `);
    },
  },
];

export function runMigrations() {
  ensureMigrationsTable();
  for (const migration of migrations) {
    if (wasApplied(migration.name)) continue;
    migration.run();
    markApplied(migration.name);
  }
}
