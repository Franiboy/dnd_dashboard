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
  {
    name: 'add_diary_rewrite_file_and_session',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(diary_entries)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'rewritten_file_path')) {
        db.exec('ALTER TABLE diary_entries ADD COLUMN rewritten_file_path TEXT');
      }
      if (!columns.some((c) => c.name === 'rewrite_session_id')) {
        db.exec('ALTER TABLE diary_entries ADD COLUMN rewrite_session_id TEXT');
      }
    },
  },
  {
    name: 'create_entity_knowledge_entries_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entity_knowledge_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK(entity_type IN ('persons', 'organizations', 'locations')),
          entity_name TEXT NOT NULL,
          title TEXT,
          content TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
          status_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entity_knowledge_entries_lookup
        ON entity_knowledge_entries (entity_type, entity_name);
      `);
    },
  },
  {
    name: 'add_entity_knowledge_status',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(entity_knowledge_entries)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'status')) {
        db.exec("ALTER TABLE entity_knowledge_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))");
      }
      if (!columns.some((c) => c.name === 'status_reason')) {
        db.exec('ALTER TABLE entity_knowledge_entries ADD COLUMN status_reason TEXT');
      }
    },
  },
  {
    name: 'create_entity_summaries_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entity_summaries (
          entity_type TEXT NOT NULL CHECK(entity_type IN ('persons', 'organizations', 'locations')),
          entity_name TEXT NOT NULL,
          summary TEXT,
          is_dirty INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT,
          PRIMARY KEY (entity_type, entity_name)
        );
      `);
    },
  },
  {
    name: 'add_users_disabled_apps',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'disabled_apps')) {
        db.exec('ALTER TABLE users ADD COLUMN disabled_apps TEXT');
      }
    },
  },
  {
    name: 'create_recording_config_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recording_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          channel_id TEXT,
          updated_at TEXT
        );
      `);
    },
  },
  {
    name: 'add_recording_session_trim',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(recording_sessions)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'trim_start_seconds')) {
        db.exec('ALTER TABLE recording_sessions ADD COLUMN trim_start_seconds REAL DEFAULT 0');
      }
      if (!columns.some((c) => c.name === 'trim_end_seconds')) {
        db.exec('ALTER TABLE recording_sessions ADD COLUMN trim_end_seconds REAL');
      }
    },
  },
  {
    name: 'add_diary_entries_ai_dirty',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(diary_entries)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'ai_dirty')) {
        db.exec('ALTER TABLE diary_entries ADD COLUMN ai_dirty INTEGER NOT NULL DEFAULT 0');
      }
      if (!columns.some((c) => c.name === 'ai_processed_at')) {
        db.exec('ALTER TABLE diary_entries ADD COLUMN ai_processed_at TEXT');
      }
    },
  },
  {
    name: 'add_entity_mini_summary',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(entity_summaries)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'mini_summary')) {
        db.exec('ALTER TABLE entity_summaries ADD COLUMN mini_summary TEXT');
      }
    },
  },
  {
    name: 'create_logs_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          level TEXT NOT NULL,
          category TEXT NOT NULL,
          message TEXT NOT NULL,
          args TEXT NOT NULL DEFAULT '[]'
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_id ON logs (id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_level_id ON logs (level, id);`);
    },
  },
  {
    name: 'create_bingo_suggestions_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bingo_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'ai',
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_bingo_suggestions_created_at ON bingo_suggestions (created_at);`);
    },
  },
  {
    name: 'add_bingo_suggestion_status_columns',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(bingo_suggestions)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'accepted_at')) {
        db.exec('ALTER TABLE bingo_suggestions ADD COLUMN accepted_at TEXT');
      }
      if (!columns.some((c) => c.name === 'rejected_at')) {
        db.exec('ALTER TABLE bingo_suggestions ADD COLUMN rejected_at TEXT');
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_bingo_suggestions_status ON bingo_suggestions (accepted_at, rejected_at, created_at);`);
    },
  },
  {
    name: 'add_discord_token_columns_to_users',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'discord_access_token')) {
        db.exec('ALTER TABLE users ADD COLUMN discord_access_token TEXT');
      }
      if (!columns.some((c) => c.name === 'discord_refresh_token')) {
        db.exec('ALTER TABLE users ADD COLUMN discord_refresh_token TEXT');
      }
      if (!columns.some((c) => c.name === 'discord_token_expires_at')) {
        db.exec('ALTER TABLE users ADD COLUMN discord_token_expires_at TEXT');
      }
    },
  },
  {
    name: 'create_ai_settings_table',
    run: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          normal_model TEXT,
          cheap_model TEXT,
          updated_at TEXT
        );
      `);
    },
  },
  {
    name: 'add_users_active_person',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'active_person')) {
        db.exec('ALTER TABLE users ADD COLUMN active_person TEXT');
      }
    },
  },
  {
    name: 'add_recording_session_transcribed_trim',
    run: () => {
      const columns = db.prepare('PRAGMA table_info(recording_sessions)').all() as { name: string }[];
      if (!columns.some((c) => c.name === 'transcribed_trim_start_seconds')) {
        db.exec('ALTER TABLE recording_sessions ADD COLUMN transcribed_trim_start_seconds REAL');
      }
      if (!columns.some((c) => c.name === 'transcribed_trim_end_seconds')) {
        db.exec('ALTER TABLE recording_sessions ADD COLUMN transcribed_trim_end_seconds REAL');
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
