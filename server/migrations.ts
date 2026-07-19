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
];

export function runMigrations() {
  ensureMigrationsTable();
  for (const migration of migrations) {
    if (wasApplied(migration.name)) continue;
    migration.run();
    markApplied(migration.name);
  }
}
