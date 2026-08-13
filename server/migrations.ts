// Idempotent schema migration engine.
//
// The target schema is declared in ./schema.ts. At startup this module diffs
// the live database against it and applies the missing tables, columns and
// indexes. Non-generative data migrations (format transforms, backfills,
// destructive drops) run as explicit code hooks below.

import { db } from './database.js';
import { schema, type TableDef, type ColumnDef } from './schema.js';
import { createLogger } from './logger.js';

const log = createLogger('migrations');

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { '1': number } | undefined;
  return !!row;
}

function getExistingColumns(
  table: string
): Map<string, { type: string; notNull: boolean; default: string | null; pk: number }> {
  const cols = db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  return new Map(
    cols.map((c) => [
      c.name,
      { type: c.type, notNull: !!c.notnull, default: c.dflt_value, pk: c.pk },
    ])
  );
}

function quote(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function columnSql(name: string, def: ColumnDef, inlinePk: boolean): string {
  const parts = [`${quote(name)} ${def.type}`];
  if (inlinePk) parts.push('PRIMARY KEY');
  if (def.autoIncrement) parts.push('AUTOINCREMENT');
  if (def.notNull) parts.push('NOT NULL');
  if (def.default !== undefined) parts.push(`DEFAULT ${def.default}`);
  return parts.join(' ');
}

function groupPk(def: TableDef): string | null {
  const pkCols = Object.entries(def.columns)
    .filter(([, c]) => c.primaryKey)
    .map(([name]) => quote(name));
  if (pkCols.length === 0) return null;
  if (pkCols.length === 1) return null; // handled inline on the column
  return `PRIMARY KEY (${pkCols.join(', ')})`;
}

function referencesSql(def: TableDef): string {
  const refs = (def.references ?? []).map(
    (r) =>
      `FOREIGN KEY (${r.columns.map(quote).join(', ')}) REFERENCES ${quote(r.table)} (${r.references
        .map(quote)
        .join(', ')})${r.onDelete ? ` ON DELETE ${r.onDelete}` : ''}`
  );
  return refs.join(', ');
}

function createTableSql(name: string, def: TableDef): string {
  const hasGroupPk = !!groupPk(def);
  const lines = Object.entries(def.columns).map(([colName, colDef]) => {
    const inlinePk = !!colDef.primaryKey && !hasGroupPk;
    return columnSql(colName, colDef, inlinePk);
  });
  const pk = groupPk(def);
  if (pk) lines.push(pk);
  if (def.check) lines.push(`CHECK (${def.check})`);
  const refs = referencesSql(def);
  if (refs) lines.push(refs);
  return `CREATE TABLE IF NOT EXISTS ${quote(name)} (\n  ${lines.join(',\n  ')}\n);`;
}

function applySchema(): void {
  for (const [table, def] of Object.entries(schema)) {
    if (!tableExists(table)) {
      db.exec(createTableSql(table, def));
      log.info(`Created table "${table}"`);
    } else {
      const existing = getExistingColumns(table);
      for (const [colName, colDef] of Object.entries(def.columns)) {
        if (!existing.has(colName)) {
          // DEFAULT with string literal needs quoting safety; here all defaults are
          // provided pre-quoted (e.g. "'ai'") or numeric.
          const add = `ALTER TABLE ${quote(table)} ADD COLUMN ${columnSql(colName, colDef, false)}`;
          db.exec(add);
          log.info(`Added column "${table}.${colName}"`);
        }
      }
    }
    // Ensure indexes exist (idempotent).
    for (const index of def.indexes ?? []) {
      const unique = index.unique ? 'UNIQUE ' : '';
      db.exec(
        `CREATE ${unique}INDEX IF NOT EXISTS ${quote(index.name)} ON ${quote(table)} (${index.columns
          .map(quote)
          .join(', ')})`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Data migrations (non-generative, idempotent code hooks)
// ---------------------------------------------------------------------------

// Legacy entity_blacklist rows used singular types ('person', 'organization', 'location').
// In place migration of the table definition to the new CHECK constraint.
function migrateEntityBlacklistTypes(): void {
  if (!tableExists('entity_blacklist')) return;
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entity_blacklist'")
    .get() as { sql: string } | undefined;
  // Already the new shape when it no longer references singular type tokens.
  if (
    !row ||
    !/'person'/.test(row.sql) ||
    !/'organization'/.test(row.sql) ||
    !/'location'/.test(row.sql)
  ) {
    return;
  }
  db.exec('ALTER TABLE entity_blacklist RENAME TO entity_blacklist_old;');
  db.exec(createTableSql('entity_blacklist', schema.entity_blacklist));
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
  db.exec('DROP TABLE entity_blacklist_old;');
  log.info('Migrated entity_blacklist types to plural form');
}

// Backfill recording_sessions.updated_at from the most recent timestamp column.
function fillRecordingSessionUpdatedAt(): void {
  if (!tableExists('recording_sessions')) return;
  const cols = getExistingColumns('recording_sessions');
  if (!cols.has('updated_at')) return;
  db.exec(`
    UPDATE recording_sessions
    SET updated_at = COALESCE(
      max(started_at, stopped_at, transcript_improved_at, summary_generated_at, long_summary_generated_at),
      started_at
    )
    WHERE updated_at IS NULL
  `);
}

// Drop the old, unused diary_entries.entry_date column if present (legacy DBs only).
function dropLegacyDiaryEntryDate(): void {
  if (!tableExists('diary_entries')) return;
  const cols = getExistingColumns('diary_entries');
  if (cols.has('entry_date')) {
    db.exec('ALTER TABLE diary_entries DROP COLUMN entry_date');
    log.info('Dropped legacy column diary_entries.entry_date');
  }
}

export function runMigrations(): void {
  // Apply non-generative data migrations that reshape schema first.
  migrateEntityBlacklistTypes();
  dropLegacyDiaryEntryDate();
  // Apply the declarative schema diff (tables, columns, indexes).
  applySchema();
  // Backfills that depend on the schema being present.
  fillRecordingSessionUpdatedAt();
}
