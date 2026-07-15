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
];

export function runMigrations() {
  ensureMigrationsTable();
  for (const migration of migrations) {
    if (wasApplied(migration.name)) continue;
    migration.run();
    markApplied(migration.name);
  }
}
