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
});
