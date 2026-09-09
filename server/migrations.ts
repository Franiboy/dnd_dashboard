// Idempotent schema migration engine.
//
// The target schema is declared in ./schema.ts. At startup this module diffs
// the live database against it and applies the missing tables, columns and
// indexes. Non-generative data migrations (format transforms, backfills,
// destructive drops) run as explicit code hooks below.

import { db } from './database.js';
import { schema, type TableDef, type ColumnDef } from './schema.js';
import { stripHtml } from './ai/rewrite.js';
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
  if (def.collate) parts.push(`COLLATE ${def.collate}`);
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

// Legacy whiteboard_elements tables only allow the original element types
// in their CHECK constraint (without 'shape', 'stroke' or 'text'). Rebuild
// the table so rows of every current type are accepted; all existing columns
// are copied 1:1.
function migrateWhiteboardElementTypes(): void {
  if (!tableExists('whiteboard_elements')) return;
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'whiteboard_elements'")
    .get() as { sql: string } | undefined;
  // Already rebuilt when the CHECK constraint knows the text type, which was
  // added after 'shape'/'stroke'.
  if (!row || /'text'/.test(row.sql)) return;
  db.exec('ALTER TABLE whiteboard_elements RENAME TO whiteboard_elements_old;');
  db.exec(createTableSql('whiteboard_elements', schema.whiteboard_elements));
  const oldCols = new Set([...getExistingColumns('whiteboard_elements_old').keys()]);
  const shared = Object.keys(schema.whiteboard_elements.columns)
    .filter((col) => oldCols.has(col))
    .map((col) => `"${col}"`)
    .join(', ');
  db.exec(`
    INSERT INTO whiteboard_elements (${shared})
    SELECT ${shared} FROM whiteboard_elements_old;
  `);
  db.exec('DROP TABLE whiteboard_elements_old;');
  log.info('Migrated whiteboard_elements to full element type list');
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

// Remove the obsolete in-game date label columns from databases created before
// the timeline was reduced to numeric days.
function dropLegacyGameDateLabels(): void {
  const columns: Array<[string, string]> = [
    ['recording_sessions', 'game_date_label'],
    ['diary_entries', 'game_date_label'],
    ['campaign_days', 'label'],
  ];
  for (const [table, column] of columns) {
    if (tableExists(table) && getExistingColumns(table).has(column)) {
      db.exec(`ALTER TABLE ${quote(table)} DROP COLUMN ${quote(column)}`);
      log.info(`Dropped legacy column ${table}.${column}`);
    }
  }
}

// Seed the in-game day counter (game_day) for legacy data from the real
// chronology. Sessions and diary entries without a game_day get a monotonic
// counter following their real date order; the counter continues from the
// highest known value so repeated runs are no-ops.
function backfillGameDays(): void {
  if (!tableExists('recording_sessions') || !tableExists('diary_entries')) return;
  const sessionCols = getExistingColumns('recording_sessions');
  const diaryCols = getExistingColumns('diary_entries');
  if (!sessionCols.has('game_day') || !diaryCols.has('game_day')) return;

  const maxRow = db
    .prepare(
      `SELECT COALESCE(MAX(m), 0) AS m FROM (
         SELECT game_day AS m FROM recording_sessions
         UNION ALL
         SELECT game_day AS m FROM diary_entries
       )`
    )
    .get() as { m: number };
  let next = maxRow.m;

  const pending = db
    .prepare(
      `SELECT kind, id FROM (
         SELECT 'session' AS kind, id, started_at AS dt FROM recording_sessions WHERE game_day IS NULL
         UNION ALL
         SELECT 'diary' AS kind, id, created_at AS dt FROM diary_entries WHERE game_day IS NULL
       )
       ORDER BY dt, kind`
    )
    .all() as { kind: string; id: number }[];

  const updateSession = db.prepare('UPDATE recording_sessions SET game_day = ? WHERE id = ?');
  const updateDiary = db.prepare('UPDATE diary_entries SET game_day = ? WHERE id = ?');
  for (const row of pending) {
    next += 1;
    if (row.kind === 'session') updateSession.run(next, row.id);
    else updateDiary.run(next, row.id);
  }
  if (pending.length > 0) {
    log.info(`Backfilled game_day for ${pending.length} sessions/diary entries`);
  }
}

// Sessions that span multiple in-game days store a range [game_day, game_day_end].
// Backfill legacy rows that only have a start day.
function backfillSessionGameDayEnd(): void {
  if (!tableExists('recording_sessions')) return;
  const cols = getExistingColumns('recording_sessions');
  if (!cols.has('game_day_end') || !cols.has('game_day')) return;
  db.exec(`
    UPDATE recording_sessions
    SET game_day_end = game_day
    WHERE game_day IS NOT NULL AND game_day_end IS NULL
  `);
}

// Legacy knowledge entries extracted from a session or diary inherit the
// source's game_day as their valid_from, so already-known facts receive a
// starting point on the in-game timeline.
function backfillKnowledgeValidity(): void {
  if (!tableExists('entity_knowledge_entries') || !tableExists('recording_sessions')) return;
  if (!tableExists('diary_entries')) return;
  const cols = getExistingColumns('entity_knowledge_entries');
  if (!cols.has('valid_from')) return;
  db.exec(`
    UPDATE entity_knowledge_entries
    SET valid_from = COALESCE(
      (SELECT s.game_day FROM recording_sessions s
       WHERE origin_type = 'session' AND s.id = entity_knowledge_entries.origin_id),
      (SELECT d.game_day FROM diary_entries d
       WHERE origin_type = 'diary' AND d.id = entity_knowledge_entries.origin_id)
    )
    WHERE valid_from IS NULL AND origin_type IS NOT NULL
  `);
}

// Populate the central campaign_days timeline from all game_day values that
// already exist on sessions and diary entries. This is the single source of
// truth for the in-game day numbers; knowledge validity windows and editors
// resolve against it.
function seedCampaignDays(): void {
  if (!tableExists('campaign_days')) return;
  const cols = getExistingColumns('campaign_days');
  if (!cols.has('day')) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO campaign_days (day, created_at, updated_at)
     SELECT m AS day, ? AS created_at, ? AS updated_at
     FROM (
       SELECT DISTINCT game_day AS m FROM recording_sessions WHERE game_day IS NOT NULL
       UNION
       SELECT DISTINCT game_day_end AS m FROM recording_sessions WHERE game_day_end IS NOT NULL
       UNION
       SELECT DISTINCT game_day AS m FROM diary_entries WHERE game_day IS NOT NULL
     )`
  ).run(now, now);
  // For sessions that span a range, ensure every day in the interval exists.
  if (getExistingColumns('recording_sessions').has('game_day_end')) {
    const sessions = db
      .prepare(
        'SELECT game_day, game_day_end FROM recording_sessions WHERE game_day IS NOT NULL AND game_day_end IS NOT NULL'
      )
      .all() as { game_day: number; game_day_end: number }[];
    const insert = db.prepare(
      'INSERT OR IGNORE INTO campaign_days (day, created_at, updated_at) VALUES (?, ?, ?)'
    );
    for (const s of sessions) {
      const start = s.game_day;
      const end = s.game_day_end ?? start;
      if (end - start > 30) {
        log.warn(`Skipping seed for session range ${start}-${end} too large (max 30)`);
        continue;
      }
      for (let d = start; d <= end; d++) {
        insert.run(d, now, now);
      }
    }
  }
}

// Legacy ai_settings rows used separate normal_model/cheap_model columns.
// Collapse any stored override into the single model column (normal wins).
function migrateAiSettingsSingleModel(): void {
  if (!tableExists('ai_settings')) return;
  const cols = getExistingColumns('ai_settings');
  if (!cols.has('model') || !cols.has('normal_model')) return;
  db.exec(`
    UPDATE ai_settings
    SET model = COALESCE(
      NULLIF(TRIM(normal_model), ''),
      NULLIF(TRIM(cheap_model), '')
    )
    WHERE id = 1
      AND (model IS NULL OR TRIM(model) = '');
  `);
}

// Legacy persons/organizations/locations tables bake UNIQUE(name) into their
// DDL and lack the qualifier column, so homonyms cannot exist. Rebuild them
// following the official SQLite table-rebuild order (create *_new, copy,
// drop old, rename) so the diary link tables' foreign key references - which
// keep pointing at the unchanged table name - stay intact.
//
// Pragma calls are no-ops inside a transaction, so this hook runs outside
// the runMigrations() transaction with foreign keys temporarily disabled.
function rebuildEntityTablesForQualifier(): void {
  const tables = ['persons', 'organizations', 'locations', 'items'] as const;
  const stale = tables.filter((name) => {
    if (!tableExists(name)) return false;
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { sql: string } | undefined;
    return !!row && !/\bqualifier\b/.test(row.sql);
  });
  if (stale.length === 0) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const name of stale) {
        const temp = `${name}_qualifier_rebuild`;
        db.exec(`DROP TABLE IF EXISTS ${quote(temp)}`);
        db.exec(createTableSql(temp, schema[name]));
        db.exec(
          `INSERT INTO ${quote(temp)} (id, name, qualifier) SELECT id, name, '' FROM ${quote(name)};`
        );
        db.exec(`DROP TABLE ${quote(name)}`);
        db.exec(`ALTER TABLE ${quote(temp)} RENAME TO ${quote(name)}`);
        log.info(`Rebuilt table "${name}" with qualifier column`);
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// entity_summaries used to be keyed by (entity_type, entity_name) only.
// Summaries belong to a specific homonym, so the qualifier joins the primary
// key. Nothing references this table, so a plain rename-rebuild is safe.
function rebuildEntitySummariesForQualifier(): void {
  if (!tableExists('entity_summaries')) return;
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entity_summaries'")
    .get() as { sql: string } | undefined;
  if (!row || /\bentity_qualifier\b/.test(row.sql)) return;

  db.exec('ALTER TABLE entity_summaries RENAME TO entity_summaries_old;');
  db.exec(createTableSql('entity_summaries', schema.entity_summaries));
  db.exec(`
    INSERT INTO entity_summaries (
      entity_type, entity_name, entity_qualifier, summary, is_dirty, updated_at, mini_summary
    )
    SELECT entity_type, entity_name, '', summary, is_dirty, updated_at, mini_summary
    FROM entity_summaries_old;
  `);
  db.exec('DROP TABLE entity_summaries_old;');
  log.info('Rebuilt entity_summaries with qualifier in primary key');
}

// The entity tables' CHECK constraints (entity_blacklist, entity_knowledge_entries,
// entity_summaries) only allowed the original three types. Rebuild them so they
// also accept 'items', copying all existing columns 1:1. Runs outside the
// transaction with foreign_keys disabled (analogous to rebuildEntityTablesForQualifier).
function migrateEntityTypeChecksForItems(): void {
  const targets: Array<[string, TableDef]> = [
    ['entity_blacklist', schema.entity_blacklist],
    ['entity_aliases', schema.entity_aliases],
    ['entity_knowledge_entries', schema.entity_knowledge_entries],
    ['entity_summaries', schema.entity_summaries],
  ];

  db.pragma('foreign_keys = OFF');
  try {
    for (const [table, def] of targets) {
      if (!tableExists(table)) continue;
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { sql: string } | undefined;
      // Already rebuilt when the CHECK constraint accepts 'items'.
      if (!row || /'items'/.test(row.sql)) continue;
      // Let the existing blacklist migration convert legacy singular values
      // before rebuilding this table for the new entity type.
      if (table === 'entity_blacklist' && /'person'|'organization'|'location'/.test(row.sql)) {
        continue;
      }

      const old = `${table}_items_rebuild`;
      const oldCols = getExistingColumns(table);
      const shared = Object.keys(def.columns)
        .filter((col) => oldCols.has(col))
        .map((col) => `"${col}"`)
        .join(', ');

      db.exec(`ALTER TABLE ${quote(table)} RENAME TO ${quote(old)};`);
      db.exec(createTableSql(table, def));
      db.exec(`INSERT INTO ${quote(table)} (${shared}) SELECT ${shared} FROM ${quote(old)};`);
      db.exec(`DROP TABLE ${quote(old)};`);
      log.info(`Rebuilt table "${table}" to allow 'items' entity type`);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// One-time introduction of story arcs: when the story_arcs table appears for
// the first time, seed a single active arc and file every existing session and
// diary entry into it. Guarded by the "table is new in this run" flag, so it
// never re-runs later (e.g. after an admin deliberately deleted all arcs).
function seedStoryArcs(tableIsNew: boolean): void {
  if (!tableIsNew || !tableExists('story_arcs')) return;

  const now = new Date().toISOString();
  const count = db.prepare('SELECT COUNT(*) AS n FROM story_arcs').get() as { n: number };
  if (count.n > 0) return;

  const result = db
    .prepare(
      "INSERT INTO story_arcs (name, description, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)"
    )
    .run('Erster Arc', null, now, now);
  const arcId = Number(result.lastInsertRowid);

  db.prepare('UPDATE recording_sessions SET arc_id = ? WHERE arc_id IS NULL').run(arcId);
  db.prepare('UPDATE diary_entries SET arc_id = ? WHERE arc_id IS NULL').run(arcId);
  log.info(`Seeded story arc ${arcId} ("Erster Arc") and assigned all existing sessions/entries`);
}

// ---------------------------------------------------------------------------
// Global search index (FTS5)
//
// The declarative schema engine cannot express FTS5 virtual tables, so the
// index lives entirely in this hook: idempotent creation of the virtual table,
// sync triggers on the three source tables and a guarded backfill.
// ---------------------------------------------------------------------------

const SEARCH_INDEX_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    title, body,
    source_type UNINDEXED,
    source_id UNINDEXED,
    owner_user_id UNINDEXED,
    arc_id UNINDEXED,
    entity_type UNINDEXED,
    entity_name UNINDEXED,
    entity_qualifier UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3'
  );
`;

// Indexed document per source table. Expressions use {r} as the row prefix
// ("new" inside triggers, the table alias inside the backfill). The diary body
// prefers the plain-text copy (content_text) because SQL triggers cannot strip
// HTML; rewritten_content is deliberately not indexed (AI draft of the same
// text). Knowledge facts are only indexed while status = 'active'.
interface SearchSourceDef {
  key: 'diary' | 'session' | 'knowledge';
  table: string;
  alias: string;
  title: string;
  body: string;
  ownerUserId: string;
  arcId: string;
  entityType: string;
  entityName: string;
  entityQualifier: string;
  where: string | null;
}

const SEARCH_SOURCES: SearchSourceDef[] = [
  {
    key: 'diary',
    table: 'diary_entries',
    alias: 'd',
    title: '{r}.title',
    body: `COALESCE({r}.content_text, {r}.content) || ' ' || COALESCE({r}.summary, '')`,
    ownerUserId: '{r}.user_id',
    arcId: '{r}.arc_id',
    entityType: "''",
    entityName: "''",
    entityQualifier: "''",
    where: null,
  },
  {
    key: 'session',
    table: 'recording_sessions',
    alias: 's',
    title: '{r}.name',
    body: `COALESCE({r}.transcript, '') || ' ' || COALESCE({r}.summary, '') || ' ' || COALESCE({r}.long_summary, '')`,
    ownerUserId: '{r}.created_by',
    arcId: '{r}.arc_id',
    entityType: "''",
    entityName: "''",
    entityQualifier: "''",
    where: null,
  },
  {
    key: 'knowledge',
    table: 'entity_knowledge_entries',
    alias: 'k',
    title: `COALESCE(NULLIF({r}.title, ''), {r}.entity_name)`,
    body: '{r}.content',
    ownerUserId: "''",
    arcId: 'NULL',
    entityType: '{r}.entity_type',
    entityName: '{r}.entity_name',
    entityQualifier: '{r}.entity_qualifier',
    where: `{r}.status = 'active'`,
  },
];

function renderDocumentSql(def: SearchSourceDef, rowPrefix: string): string {
  const fill = (expr: string) => expr.replaceAll('{r}', rowPrefix);
  return [
    fill(def.title),
    fill(def.body),
    `'${def.key}'`,
    `${rowPrefix}.id`,
    fill(def.ownerUserId),
    fill(def.arcId),
    fill(def.entityType),
    fill(def.entityName),
    fill(def.entityQualifier),
  ].join(',\n         ');
}

function searchIndexColumnMismatch(): boolean {
  if (!tableExists('search_index')) return false;
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'search_index'")
    .get() as { sql: string } | undefined;
  // The tokenize/prefix options are baked into the stored DDL; a mismatch
  // means the index was created by an older definition and must be rebuilt.
  return !row || !/remove_diacritics/.test(row.sql) || !/prefix/.test(row.sql);
}

function createSearchSyncTriggers(): void {
  const statements: string[] = [];
  for (const def of SEARCH_SOURCES) {
    const insert = `
        INSERT INTO search_index (title, body, source_type, source_id, owner_user_id, arc_id,
                                  entity_type, entity_name, entity_qualifier)
        SELECT ${renderDocumentSql(def, 'new')}`;
    const where = def.where ? `\n        WHERE ${def.where.replaceAll('{r}', 'new')}` : '';
    statements.push(`DROP TRIGGER IF EXISTS trg_search_${def.key}_ai;`);
    statements.push(`
      CREATE TRIGGER trg_search_${def.key}_ai AFTER INSERT ON ${def.table}
      BEGIN${insert}${where};
      END;`);
    statements.push(`DROP TRIGGER IF EXISTS trg_search_${def.key}_au;`);
    statements.push(`
      CREATE TRIGGER trg_search_${def.key}_au AFTER UPDATE ON ${def.table}
      BEGIN
        DELETE FROM search_index WHERE source_type = '${def.key}' AND source_id = new.id;${insert}${where};
      END;`);
    statements.push(`DROP TRIGGER IF EXISTS trg_search_${def.key}_ad;`);
    statements.push(`
      CREATE TRIGGER trg_search_${def.key}_ad AFTER DELETE ON ${def.table}
      BEGIN
        DELETE FROM search_index WHERE source_type = '${def.key}' AND source_id = old.id;
      END;`);
  }
  db.exec(statements.join('\n'));
}

// Insert index rows that are still missing (first run / newly added sources).
// The NOT EXISTS guard makes repeated runs no-ops; the triggers cover every
// later change.
function backfillSearchIndex(): void {
  const before = db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number };
  for (const def of SEARCH_SOURCES) {
    const where = [
      def.where ? def.where.replaceAll('{r}', def.alias) : null,
      `NOT EXISTS (
           SELECT 1 FROM search_index si
           WHERE si.source_type = '${def.key}' AND si.source_id = ${def.alias}.id
         )`,
    ]
      .filter(Boolean)
      .join(' AND ');
    db.exec(`
      INSERT INTO search_index (title, body, source_type, source_id, owner_user_id, arc_id,
                                entity_type, entity_name, entity_qualifier)
      SELECT ${renderDocumentSql(def, def.alias)}
      FROM ${def.table} ${def.alias}
      WHERE ${where}`);
  }
  const after = db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number };
  if (after.n > before.n) {
    log.info(`Backfilled search_index (${before.n} -> ${after.n} documents)`);
  }
}

// Legacy diary rows carry HTML-only content; fill the plain-text copy once so
// the diary trigger bodies index stripped text.
function backfillDiaryContentText(): void {
  const rows = db
    .prepare('SELECT id, content FROM diary_entries WHERE content_text IS NULL')
    .all() as { id: number; content: string }[];
  if (rows.length === 0) return;
  const update = db.prepare('UPDATE diary_entries SET content_text = ? WHERE id = ?');
  for (const row of rows) {
    update.run(stripHtml(row.content), row.id);
  }
  log.info(`Backfilled content_text for ${rows.length} diary entries`);
}

function setupSearchIndex(): void {
  if (!tableExists('diary_entries') || !tableExists('recording_sessions')) return;
  if (searchIndexColumnMismatch()) {
    // DROP on an FTS5 table also drops its triggers' target; triggers are
    // recreated right after and the backfill reindexes from the sources.
    db.exec('DROP TABLE IF EXISTS search_index;');
  }
  db.exec(SEARCH_INDEX_DDL);
  createSearchSyncTriggers();
  backfillDiaryContentText();
  backfillSearchIndex();
}

export function runMigrations(): void {
  // Table rebuilds that require foreign_keys = OFF must run outside the
  // outer transaction; the pragma is a no-op while a transaction is open.
  rebuildEntityTablesForQualifier();
  migrateEntityTypeChecksForItems();
  // Captured before applySchema() so the story-arc seed runs exactly once,
  // on the first startup where the table is introduced.
  const storyArcsTableIsNew = !tableExists('story_arcs');
  db.transaction(() => {
    // Apply non-generative data migrations that reshape schema first.
    migrateEntityBlacklistTypes();
    migrateWhiteboardElementTypes();
    dropLegacyDiaryEntryDate();
    dropLegacyGameDateLabels();
    migrateWhiteboardElementTypes();
    rebuildEntitySummariesForQualifier();
    // Apply the declarative schema diff (tables, columns, indexes).
    applySchema();
    // FTS5 global search index: cannot live in schema.ts (virtual table) and
    // depends on diary_entries.content_text existing first.
    setupSearchIndex();
    // Backfills that depend on the schema being present.
    migrateAiSettingsSingleModel();
    fillRecordingSessionUpdatedAt();
    backfillGameDays();
    backfillSessionGameDayEnd();
    seedCampaignDays();
    backfillKnowledgeValidity();
    seedStoryArcs(storyArcsTableIsNew);
  })();
}
