import type { DiaryEntry } from '../../shared/types.js';
import type { DiaryEntities } from '../ai/rewrite.js';
import { stripHtml } from '../ai/rewrite.js';
import { db } from '../database.js';
import { AppError } from '../errors.js';
import { getRewrittenFilePath, readRewrittenFile, writeRewrittenFile } from '../diaryFiles.js';
import { sanitizeHtml, sanitizePlainText } from '../utils/sanitizeHtml.js';
import { mergeEntityKnowledge, renameEntityKnowledge } from './entityKnowledge.js';
import { mergeEntitySummary } from './entitySummaries.js';
import { ensureCampaignDay } from './gameTimeline.js';
import {
  deleteStoryArcEntitiesByName,
  getActiveArcId,
  linkStoryArcEntityForDiaryEntry,
  retargetStoryArcEntities,
} from './storyArcs.js';

interface EntityConfig {
  table: string;
  linkTable: string;
  column: string;
}

/**
 * Full identity of one world entity. Names alone are ambiguous in a campaign
 * ("Kerigan" the gnome vs "Kerigan" the paladin); the qualifier disambiguates.
 * An empty qualifier means the plain, unqualified name.
 */
export type { EntityRef } from './entityRefs.js';
export { entityLabel, splitEntityLabel } from './entityRefs.js';
import { entityLabel, splitEntityLabel, type EntityRef } from './entityRefs.js';

const entityConfig: Record<keyof DiaryEntities, EntityConfig> = {
  persons: { table: 'persons', linkTable: 'diary_entry_persons', column: 'person_id' },
  organizations: {
    table: 'organizations',
    linkTable: 'diary_entry_organizations',
    column: 'organization_id',
  },
  locations: { table: 'locations', linkTable: 'diary_entry_locations', column: 'location_id' },
  items: { table: 'items', linkTable: 'diary_entry_items', column: 'item_id' },
};

/** Finds the exact row for an entity identity (case-insensitive name). */
function findEntityRow(
  type: keyof DiaryEntities,
  ref: EntityRef
): { id: number; name: string; qualifier: string } | undefined {
  const { table } = entityConfig[type];
  return db
    .prepare(
      `SELECT id, name, qualifier FROM ${table} WHERE name = ? COLLATE NOCASE AND qualifier = ?`
    )
    .get(ref.name, ref.qualifier) as { id: number; name: string; qualifier: string } | undefined;
}

function rowToDiaryEntry(
  row: Record<string, unknown>,
  entities: DiaryEntities,
  includeRewritten = true
): DiaryEntry {
  const rewrittenFilePath = (row.rewritten_file_path as string | null | undefined) ?? null;
  const legacyRewrittenContent = (row.rewritten_content as string | null | undefined) ?? null;
  const rewrittenContent = includeRewritten
    ? rewrittenFilePath
      ? (readRewrittenFile(row.id as number) ?? legacyRewrittenContent)
      : legacyRewrittenContent
    : rewrittenFilePath
      ? null
      : legacyRewrittenContent;

  return {
    id: row.id as number,
    userId: row.user_id as string,
    title: row.title as string,
    content: row.content as string,
    summary: (row.summary as string | null | undefined) ?? null,
    rewrittenContent,
    rewrittenFilePath: (row.rewritten_file_path as string | null | undefined) ?? null,
    rewriteSessionId: (row.rewrite_session_id as string | null | undefined) ?? null,
    aiDirty: Boolean(row.ai_dirty),
    aiProcessedAt: (row.ai_processed_at as string | null | undefined) ?? null,
    sessionDraftFor: (row.session_draft_for as number | null | undefined) ?? null,
    sessionDraftForName: (row.session_name as string | null | undefined) ?? null,
    persons: entities.persons,
    organizations: entities.organizations,
    locations: entities.locations,
    items: entities.items,
    gameDay: (row.game_day as number | null | undefined) ?? null,
    arcId: (row.arc_id as number | null | undefined) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function emptyEntities(): DiaryEntities {
  return { persons: [], organizations: [], locations: [], items: [] };
}

function buildEntryEntitiesMap(entryIds: number[]): Map<number, DiaryEntities> {
  const map = new Map<number, DiaryEntities>();
  if (entryIds.length === 0) return map;

  for (const id of entryIds) {
    map.set(id, emptyEntities());
  }

  // Linked entities are exposed as qualified labels ("Name (Qualifier)") so
  // homonyms stay distinguishable; writing them back parses tolerantly.
  const load = (
    entityTable: string,
    linkTable: string,
    column: string,
    key: keyof DiaryEntities
  ) => {
    const rows = db
      .prepare(
        `SELECT l.diary_entry_id AS entry_id, e.name, e.qualifier
         FROM ${entityTable} e
         JOIN ${linkTable} l ON l.${column} = e.id
         WHERE l.diary_entry_id IN (${entryIds.map(() => '?').join(',')})
         ORDER BY e.name`
      )
      .all(...entryIds) as { entry_id: number; name: string; qualifier: string }[];

    for (const { entry_id, name, qualifier } of rows) {
      const entities = map.get(entry_id);
      if (entities) {
        entities[key].push(entityLabel({ name, qualifier }));
      }
    }
  };

  load('persons', 'diary_entry_persons', 'person_id', 'persons');
  load('organizations', 'diary_entry_organizations', 'organization_id', 'organizations');
  load('locations', 'diary_entry_locations', 'location_id', 'locations');
  load('items', 'diary_entry_items', 'item_id', 'items');

  return map;
}

export function getEntryEntities(entryId: number): DiaryEntities {
  const map = buildEntryEntitiesMap([entryId]);
  return map.get(entryId) ?? emptyEntities();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entityNameRegex(name: string): RegExp {
  const escaped = escapeRegex(name);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

function getEntityRefs(table: string): EntityRef[] {
  const rows = db
    .prepare(
      `SELECT name, qualifier FROM ${table} ORDER BY name COLLATE NOCASE, qualifier COLLATE NOCASE`
    )
    .all() as {
    name: string;
    qualifier: string;
  }[];
  return rows.map((r) => ({ name: r.name, qualifier: r.qualifier ?? '' }));
}

export function listAllEntityRefs(): Record<keyof DiaryEntities, EntityRef[]> {
  return {
    persons: getEntityRefs('persons'),
    organizations: getEntityRefs('organizations'),
    locations: getEntityRefs('locations'),
    items: getEntityRefs('items'),
  };
}

/** Resolves an entity identity through the alias chain to an existing row. */
export function findEntityCanonical(
  type: keyof DiaryEntities,
  name: string,
  qualifier = ''
): EntityRef | null {
  const resolved = resolveEntityRef({ name: name.trim(), qualifier }, type);
  const row = findEntityRow(type, resolved);
  return row ? { name: row.name, qualifier: row.qualifier ?? '' } : null;
}

export function ensureEntityExists(
  type: keyof DiaryEntities,
  name: string,
  qualifier = ''
): EntityRef {
  const canonical = findEntityCanonical(type, name, qualifier);
  if (canonical) return canonical;
  const { table } = entityConfig[type];
  // The name may arrive as a qualified label ("Name (Qualifier)"); an
  // explicitly given qualifier parameter takes precedence over a parsed one.
  const parsed = splitEntityLabel(name.trim());
  const resolved = resolveEntityRef(
    { name: parsed.name, qualifier: qualifier || parsed.qualifier },
    type
  );
  const existingByLabel = findEntityRow(type, resolved);
  if (existingByLabel) {
    return { name: existingByLabel.name, qualifier: existingByLabel.qualifier ?? '' };
  }
  db.prepare(`INSERT INTO ${table} (name, qualifier) VALUES (?, ?)`).run(
    resolved.name,
    resolved.qualifier
  );
  return resolved;
}

interface AliasEntry {
  alias: string;
  canonical: string;
  canonicalQualifier: string;
}

function getAliasEntries(type: keyof DiaryEntities): Map<string, AliasEntry> {
  const rows = db
    .prepare('SELECT alias, canonical, canonical_qualifier FROM entity_aliases WHERE type = ?')
    .all(type) as { alias: string; canonical: string; canonical_qualifier?: string }[];

  const map = new Map<string, AliasEntry>();
  for (const { alias, canonical, canonical_qualifier } of rows) {
    map.set(alias.toLowerCase(), {
      alias,
      canonical,
      canonicalQualifier: canonical_qualifier ?? '',
    });
  }
  return map;
}

/**
 * Follows the alias chain for a raw name and returns the targeted entity.
 * Without a matching alias the input passes through unchanged. Aliases fully
 * identify their target including its qualifier; an explicitly given
 * qualifier only applies when no alias redirects the name.
 */
export function resolveEntityRef(ref: EntityRef, type: keyof DiaryEntities): EntityRef {
  const aliases = getAliasEntries(type);
  let current = ref;
  const seen = new Set<string>();

  while (!seen.has(current.name.toLowerCase())) {
    seen.add(current.name.toLowerCase());
    const entry = aliases.get(current.name.toLowerCase());
    if (!entry) break;
    current = { name: entry.canonical, qualifier: entry.canonicalQualifier };
  }

  // A caller-provided qualifier survives when the name was not redirected.
  if (
    ref.qualifier &&
    seen.size === 1 &&
    current.name.toLowerCase() === ref.name.toLowerCase() &&
    !current.qualifier
  ) {
    return { name: current.name, qualifier: ref.qualifier };
  }
  return current;
}

/** Legacy helper: resolves only the canonical name part of an alias chain. */
export function resolveEntityName(name: string, type: keyof DiaryEntities): string {
  return resolveEntityRef({ name: name.trim(), qualifier: '' }, type).name;
}

interface EntityMapping {
  type: keyof DiaryEntities;
  canonical: string;
  qualifier: string;
  label: string;
  aliases: string[];
  miniSummary: string | null;
}

export function getEntityMappings(): EntityMapping[] {
  const result: EntityMapping[] = [];
  const blacklists = getBlacklists();

  for (const type of ['persons', 'organizations', 'locations', 'items'] as const) {
    const { table } = entityConfig[type];
    const refs = getEntityRefs(table);
    const aliasesByTarget = new Map<string, string[]>();

    const aliasRows = db
      .prepare('SELECT alias, canonical, canonical_qualifier FROM entity_aliases WHERE type = ?')
      .all(type) as { alias: string; canonical: string; canonical_qualifier?: string }[];
    for (const { alias, canonical, canonical_qualifier } of aliasRows) {
      const key = `${canonical.toLowerCase()}\n${canonical_qualifier ?? ''}`;
      const list = aliasesByTarget.get(key) ?? [];
      list.push(alias);
      aliasesByTarget.set(key, list);
    }

    const summaryRows = db
      .prepare(
        'SELECT entity_name, entity_qualifier, mini_summary FROM entity_summaries WHERE entity_type = ?'
      )
      .all(type) as {
      entity_name: string;
      entity_qualifier?: string;
      mini_summary: string | null;
    }[];
    const miniSummaries = new Map<string, string | null>();
    for (const { entity_name, entity_qualifier, mini_summary } of summaryRows) {
      miniSummaries.set(`${entity_name.toLowerCase()}\n${entity_qualifier ?? ''}`, mini_summary);
    }

    for (const ref of refs) {
      const lower = ref.name.toLowerCase();
      if (blacklists[type].has(lower)) continue;
      const key = `${lower}\n${ref.qualifier}`;
      result.push({
        type,
        canonical: ref.name,
        qualifier: ref.qualifier,
        label: entityLabel(ref),
        aliases: aliasesByTarget.get(key) ?? [],
        miniSummary: miniSummaries.get(key) ?? null,
      });
    }
  }

  return result;
}

export function findExistingEntitiesInText(text: string): DiaryEntities {
  const plainText = stripHtml(text);
  const result: DiaryEntities = emptyEntities();
  const blacklists = getBlacklists();

  const detect = (type: keyof DiaryEntities) => {
    const { table } = entityConfig[type];
    const refs = getEntityRefs(table);
    const aliases = getAliasEntries(type);

    // How many entities share a raw name? Plain-name mentions of homonyms
    // are ambiguous and must be resolved by the AI extraction instead of
    // being auto-linked to an arbitrary match.
    const rowCountByName = new Map<string, number>();
    for (const ref of refs) {
      const lower = ref.name.toLowerCase();
      rowCountByName.set(lower, (rowCountByName.get(lower) ?? 0) + 1);
    }

    interface Trigger {
      text: string;
      target: EntityRef;
      isAlias: boolean;
    }
    const triggers = new Map<string, Trigger>();
    for (const ref of refs) {
      const lower = ref.name.toLowerCase();
      if (!triggers.has(lower)) {
        triggers.set(lower, { text: ref.name, target: ref, isAlias: false });
      }
    }
    for (const entry of aliases.values()) {
      const lower = entry.alias.toLowerCase();
      if (!triggers.has(lower)) {
        triggers.set(lower, {
          text: entry.alias,
          target: { name: entry.canonical, qualifier: entry.canonicalQualifier },
          isAlias: true,
        });
      }
    }

    const seen = new Set<string>();
    for (const trigger of triggers.values()) {
      const row = findEntityRow(type, resolveEntityRef(trigger.target, type));
      if (!row) continue;
      const ref: EntityRef = { name: row.name, qualifier: row.qualifier ?? '' };
      const key = `${ref.name.toLowerCase()}\n${ref.qualifier}`;
      if (seen.has(key)) continue;

      // An alias pinpoints exactly one homonym; a bare name does not.
      if (!trigger.isAlias && (rowCountByName.get(ref.name.toLowerCase()) ?? 0) > 1) continue;

      const triggerLower = trigger.text.toLowerCase();
      if (blacklists[type].has(triggerLower) || blacklists[type].has(ref.name.toLowerCase())) {
        continue;
      }

      if (entityNameRegex(trigger.text).test(plainText)) {
        result[type].push(entityLabel(ref));
        seen.add(key);
      }
    }
  };

  detect('persons');
  detect('organizations');
  detect('locations');
  detect('items');

  return result;
}

export function mergeEntities(
  aiEntities: DiaryEntities,
  existingEntities: DiaryEntities
): DiaryEntities {
  const merge = (aiItems: string[], existingItems: string[]): string[] => {
    const byLower = new Map<string, string>();
    for (const name of existingItems) {
      byLower.set(name.toLowerCase(), name);
    }
    for (const name of aiItems) {
      const lower = name.toLowerCase();
      if (!byLower.has(lower)) {
        byLower.set(lower, name);
      }
    }
    return Array.from(byLower.values());
  };

  return {
    persons: merge(aiEntities.persons, existingEntities.persons),
    organizations: merge(aiEntities.organizations, existingEntities.organizations),
    locations: merge(aiEntities.locations, existingEntities.locations),
    items: merge(aiEntities.items, existingEntities.items),
  };
}

type EntityBlacklists = Record<keyof DiaryEntities, Set<string>>;

function getBlacklists(): EntityBlacklists {
  const rows = db.prepare('SELECT type, name FROM entity_blacklist').all() as {
    type: string;
    name: string;
  }[];

  const lists: EntityBlacklists = {
    persons: new Set<string>(),
    organizations: new Set<string>(),
    locations: new Set<string>(),
    items: new Set<string>(),
  };

  for (const { type, name } of rows) {
    if (type in lists) {
      lists[type as keyof EntityBlacklists].add(name.toLowerCase());
    }
  }

  return lists;
}

export function filterBlacklisted(entities: DiaryEntities): DiaryEntities {
  const blacklists = getBlacklists();

  return {
    persons: entities.persons.filter((name) => !blacklists.persons.has(name.toLowerCase())),
    organizations: entities.organizations.filter(
      (name) => !blacklists.organizations.has(name.toLowerCase())
    ),
    locations: entities.locations.filter((name) => !blacklists.locations.has(name.toLowerCase())),
    items: entities.items.filter((name) => !blacklists.items.has(name.toLowerCase())),
  };
}

/**
 * Name-level kill switch: blocks the string from being extracted or linked
 * and removes every entity row carrying that name (all qualifiers) plus its
 * aliases.
 */
export function blacklistEntity(name: string, type: keyof DiaryEntities): void {
  const normalized = name.trim();
  if (normalized.length === 0) return;

  const { table } = entityConfig[type];

  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO entity_blacklist (type, name) VALUES (?, ?)').run(
      type,
      normalized
    );
    db.prepare(`DELETE FROM ${table} WHERE name = ? COLLATE NOCASE`).run(normalized);
    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND (alias = ? OR canonical = ?)').run(
      type,
      normalized,
      normalized
    );
    // The name-level kill switch also drops the story-arc links of the name.
    deleteStoryArcEntitiesByName(type, normalized);
  });

  tx();
}

function entityExistsInAnyType(
  name: string,
  excludeType?: keyof DiaryEntities
): { type: keyof DiaryEntities; name: string } | null {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) return null;

  for (const type of ['persons', 'organizations', 'locations', 'items'] as const) {
    if (type === excludeType) continue;
    const { table } = entityConfig[type];
    const row = db.prepare(`SELECT name FROM ${table} WHERE name = ? COLLATE NOCASE`).get(name) as
      { name: string } | undefined;
    if (row) return { type, name: row.name };
  }

  return null;
}

function setLinkedEntities(
  entryId: number,
  labels: string[],
  entityTable: string,
  linkTable: string,
  column: string
): void {
  const type = entityTable as keyof DiaryEntities;
  const normalized = [...new Set(labels.map((n) => n.trim()).filter((n) => n.length > 0))];

  db.prepare(`DELETE FROM ${linkTable} WHERE diary_entry_id = ?`).run(entryId);
  if (normalized.length === 0) return;

  const blacklists = getBlacklists();
  const blacklist = blacklists[type];

  const linkEntity = db.prepare(
    `INSERT INTO ${linkTable} (diary_entry_id, ${column}) VALUES (?, ?)`
  );

  const tx = db.transaction((targetId: number, labelsToLink: string[]) => {
    for (const label of labelsToLink) {
      const labelLower = label.toLowerCase();

      // Resolve the label to an exact entity identity:
      // 1. The untouched string as a plain name (legacy round-trips and real
      //    names that contain parentheses).
      // 2. Alias resolution / "Name (Qualifier)" labels matched against exact
      //    (name, qualifier) rows - this is how qualified homonyms survive a
      //    client save round-trip.
      // 3. Unknown unredirected names are created (plain or with qualifier).
      //    Alias strings that point elsewhere are never materialized blindly.
      let ref: EntityRef | null = null;
      const exactRow = findEntityRow(type, { name: label, qualifier: '' });
      if (exactRow) {
        ref = { name: exactRow.name, qualifier: exactRow.qualifier ?? '' };
      } else {
        const parsed = splitEntityLabel(label);
        const resolved = resolveEntityRef(parsed, type);
        const redirected =
          resolved.name.toLowerCase() !== parsed.name.toLowerCase() ||
          resolved.qualifier !== parsed.qualifier;
        const row = findEntityRow(type, resolved);
        if (row) {
          ref = { name: row.name, qualifier: row.qualifier ?? '' };
        } else if (!redirected) {
          ref = resolved;
        }
      }

      if (!ref) continue;

      if (blacklist.has(labelLower) || blacklist.has(ref.name.toLowerCase())) continue;
      if (entityExistsInAnyType(ref.name, type)) continue;

      // OR IGNORE: the identity may already exist (linking is idempotent);
      // the composite unique index only ignores true duplicates.
      const insertEntity = db.prepare(
        `INSERT OR IGNORE INTO ${entityTable} (name, qualifier) VALUES (?, ?)`
      );
      insertEntity.run(ref.name, ref.qualifier);
      const entity = findEntityRow(type, ref);
      if (!entity) continue;
      linkEntity.run(targetId, entity.id);
      // Story-arc bookkeeping: an entity showing up in an entry of an arc is
      // additively filed into that arc (m:n, idempotent via the PK).
      linkStoryArcEntityForDiaryEntry(entryId, type, {
        name: entity.name,
        qualifier: entity.qualifier ?? '',
      });
    }
  });

  tx(entryId, normalized);
}

export function setDiaryEntryPersons(entryId: number, persons: string[]): void {
  setLinkedEntities(entryId, persons, 'persons', 'diary_entry_persons', 'person_id');
}

export function setDiaryEntryOrganizations(entryId: number, organizations: string[]): void {
  setLinkedEntities(
    entryId,
    organizations,
    'organizations',
    'diary_entry_organizations',
    'organization_id'
  );
}

export function setDiaryEntryLocations(entryId: number, locations: string[]): void {
  setLinkedEntities(entryId, locations, 'locations', 'diary_entry_locations', 'location_id');
}

export function setDiaryEntryItems(entryId: number, items: string[]): void {
  setLinkedEntities(entryId, items, 'items', 'diary_entry_items', 'item_id');
}

export function createDiaryEntry(
  userId: string,
  title: string,
  content: string,
  summary?: string | null,
  gameDay?: number | null,
  arcId?: number | null
): DiaryEntry {
  const now = new Date().toISOString();
  const day = gameDay ?? null;
  if (day !== null) ensureCampaignDay(day);
  // Explicit arc wins, otherwise the entry is filed into the active arc.
  const resolvedArcId = arcId !== undefined ? arcId : getActiveArcId();
  const result = db
    .prepare(
      `INSERT INTO diary_entries (user_id, title, content, summary, ai_dirty, game_day, arc_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      sanitizePlainText(title),
      sanitizeHtml(content).trim(),
      summary ? sanitizePlainText(summary) : null,
      1,
      day,
      resolvedArcId,
      now,
      now
    );
  return getDiaryEntryById(Number(result.lastInsertRowid))!;
}

/**
 * Creates the user's single diary entry for one game day inside one
 * transaction, or returns null when an entry for that day already exists.
 */
export function createDiaryEntryOncePerDay(
  userId: string,
  content: string,
  day: number,
  arcId?: number
): DiaryEntry | null {
  return db.transaction(() => {
    const existing = db
      .prepare('SELECT 1 FROM diary_entries WHERE user_id = ? AND game_day = ?')
      .get(userId, day) as { '1': number } | undefined;
    if (existing) return null;

    return createDiaryEntry(userId, `Spieltag ${day}`, content, undefined, day, arcId);
  })();
}

export function getDiaryEntryById(id: number): DiaryEntry | null {
  const row = db
    .prepare(
      `SELECT d.*, s.name AS session_name
       FROM diary_entries d
       LEFT JOIN recording_sessions s ON s.id = d.session_draft_for
       WHERE d.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToDiaryEntry(row, getEntryEntities(id));
}

export function listDiaryEntriesByUser(userId: string): DiaryEntry[] {
  const rows = db
    .prepare(
      `SELECT d.*, s.name AS session_name
       FROM diary_entries d
       LEFT JOIN recording_sessions s ON s.id = d.session_draft_for
       WHERE d.user_id = ?
       ORDER BY d.created_at DESC`
    )
    .all(userId) as Record<string, unknown>[];
  const entryIds = rows.map((row) => row.id as number);
  const entitiesMap = buildEntryEntitiesMap(entryIds);
  return rows.map((row) =>
    rowToDiaryEntry(row, entitiesMap.get(row.id as number) ?? emptyEntities(), false)
  );
}

export function listDiaryEntryHeadlinesByUser(
  userId: string,
  limit = 20,
  arcId?: number
): { id: number; title: string; content: string; createdAt: string }[] {
  const params: (string | number)[] = [userId];
  let sql = `SELECT id, title, content, created_at AS createdAt
       FROM diary_entries
       WHERE user_id = ?`;
  // Arc-scoped AI runs only see entries of their own story arc.
  if (arcId !== undefined) {
    sql += ' AND arc_id = ?';
    params.push(arcId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as {
    id: number;
    title: string;
    content: string;
    createdAt: string;
  }[];
  return rows.map((row) => ({
    ...row,
    content: stripHtml(row.content).slice(0, 300),
  }));
}

export function listPreviousDiaryEntriesByUser(
  userId: string,
  beforeCreatedAt: string,
  limit = 3,
  arcId?: number
): { id: number; title: string; content: string; createdAt: string }[] {
  const params: (string | number)[] = [userId, beforeCreatedAt];
  let sql = `SELECT id, title, content, created_at AS createdAt
       FROM diary_entries
       WHERE user_id = ? AND created_at < ?`;
  if (arcId !== undefined) {
    sql += ' AND arc_id = ?';
    params.push(arcId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as {
    id: number;
    title: string;
    content: string;
    createdAt: string;
  }[];
  return rows;
}

export function searchDiaryEntries(
  query: string,
  userId?: string,
  limit = 5,
  arcId?: number
): { id: number; title: string; content: string; createdAt: string }[] {
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const like = `%${escaped}%`;
  const params: (string | number)[] = [like, like];
  let sql = `SELECT id, title, content, created_at AS createdAt
       FROM diary_entries
       WHERE (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')`;
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  if (arcId !== undefined) {
    sql += ' AND arc_id = ?';
    params.push(arcId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as {
    id: number;
    title: string;
    content: string;
    createdAt: string;
  }[];
  return rows;
}

export function listDiaryEntryContentsByEntity(
  type: keyof DiaryEntities,
  name: string,
  userId?: string,
  qualifier = '',
  arcId?: number
): { id: number; title: string; content: string; createdAt: string; gameDay: number | null }[] {
  const { linkTable, column } = entityConfig[type];
  const row = findEntityRow(type, { name, qualifier });
  if (!row) return [];
  const params: (string | number)[] = [row.id];
  let sql = `SELECT de.id, de.title, de.content, de.created_at AS createdAt, de.game_day AS gameDay
       FROM diary_entries de
       JOIN ${linkTable} l ON l.diary_entry_id = de.id
       WHERE l.${column} = ?`;
  if (userId) {
    sql += ' AND de.user_id = ?';
    params.push(userId);
  }
  if (arcId !== undefined) {
    sql += ' AND de.arc_id = ?';
    params.push(arcId);
  }
  sql += ' ORDER BY de.created_at DESC';
  const rows = db.prepare(sql).all(...params) as {
    id: number;
    title: string;
    content: string;
    createdAt: string;
    gameDay: number | null;
  }[];
  return rows;
}

export function updateDiaryEntry(
  id: number,
  updates: Partial<
    Pick<
      DiaryEntry,
      | 'title'
      | 'content'
      | 'summary'
      | 'rewrittenContent'
      | 'persons'
      | 'organizations'
      | 'locations'
      | 'items'
      | 'aiDirty'
      | 'aiProcessedAt'
      | 'sessionDraftFor'
      | 'gameDay'
      | 'arcId'
    > & {
      rewrittenFilePath?: string | null;
      rewriteSessionId?: string | null;
    }
  >
): DiaryEntry | null {
  const existing = getDiaryEntryById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(sanitizePlainText(updates.title));
  }
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(sanitizeHtml(updates.content).trim());
    // Content changed -> AI summary/entities need reprocessing.
    fields.push('ai_dirty = ?');
    values.push(1);
    fields.push('ai_processed_at = ?');
    values.push(null);
  }
  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    values.push(updates.summary ? sanitizePlainText(updates.summary) : null);
  }
  if (updates.rewrittenContent !== undefined) {
    fields.push('rewritten_content = ?');
    values.push(updates.rewrittenContent ? sanitizeHtml(updates.rewrittenContent).trim() : null);
  }
  if (updates.rewrittenFilePath !== undefined) {
    fields.push('rewritten_file_path = ?');
    values.push(updates.rewrittenFilePath ? updates.rewrittenFilePath.trim() : null);
    if (!updates.rewrittenFilePath && updates.sessionDraftFor === undefined) {
      // Clearing the AI draft also detaches the session source.
      fields.push('session_draft_for = ?');
      values.push(null);
    }
  }
  if (updates.rewriteSessionId !== undefined) {
    fields.push('rewrite_session_id = ?');
    values.push(updates.rewriteSessionId ? updates.rewriteSessionId.trim() : null);
  }
  if (updates.sessionDraftFor !== undefined) {
    fields.push('session_draft_for = ?');
    values.push(updates.sessionDraftFor ?? null);
  }
  if (updates.gameDay !== undefined) {
    fields.push('game_day = ?');
    values.push(updates.gameDay);
    if (updates.gameDay !== null) {
      ensureCampaignDay(updates.gameDay);
    }
  }
  if (updates.arcId !== undefined) {
    fields.push('arc_id = ?');
    values.push(updates.arcId);
  }
  if (updates.aiDirty !== undefined) {
    fields.push('ai_dirty = ?');
    values.push(updates.aiDirty ? 1 : 0);
  }
  if (updates.aiProcessedAt !== undefined) {
    fields.push('ai_processed_at = ?');
    values.push(updates.aiProcessedAt ? updates.aiProcessedAt.trim() : null);
  }

  const hasPersonsUpdate = updates.persons !== undefined;
  const hasOrganizationsUpdate = updates.organizations !== undefined;
  const hasLocationsUpdate = updates.locations !== undefined;
  const hasItemsUpdate = updates.items !== undefined;

  if (
    fields.length === 0 &&
    !hasPersonsUpdate &&
    !hasOrganizationsUpdate &&
    !hasLocationsUpdate &&
    !hasItemsUpdate
  ) {
    return existing;
  }

  if (hasPersonsUpdate) {
    setDiaryEntryPersons(id, updates.persons || []);
  }
  if (hasOrganizationsUpdate) {
    setDiaryEntryOrganizations(id, updates.organizations || []);
  }
  if (hasLocationsUpdate) {
    setDiaryEntryLocations(id, updates.locations || []);
  }
  if (hasItemsUpdate) {
    setDiaryEntryItems(id, updates.items || []);
  }

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE diary_entries SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getDiaryEntryById(id);
}

export function createSessionDiaryDraft(
  userId: string,
  title: string,
  sessionId: number,
  html: string
): DiaryEntry {
  const now = new Date().toISOString();
  const session = db
    .prepare('SELECT game_day, arc_id FROM recording_sessions WHERE id = ?')
    .get(sessionId) as { game_day: number | null; arc_id: number | null } | undefined;
  const gameDay = session?.game_day ?? null;
  if (gameDay !== null) ensureCampaignDay(gameDay);
  // The draft belongs to the same story arc as its source session.
  const arcId = session?.arc_id ?? null;
  const derivedTitle = gameDay !== null ? `Spieltag ${gameDay}` : sanitizePlainText(title);
  const result = db
    .prepare(
      'INSERT INTO diary_entries (user_id, title, content, summary, ai_dirty, session_draft_for, game_day, arc_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      userId,
      derivedTitle,
      sanitizeHtml('').trim(),
      null,
      0,
      sessionId,
      gameDay,
      arcId,
      now,
      now
    );
  const entryId = Number(result.lastInsertRowid);
  const filePath = getRewrittenFilePath(entryId);
  writeRewrittenFile(entryId, sanitizeHtml(html).trim());
  db.prepare('UPDATE diary_entries SET rewritten_file_path = ? WHERE id = ?').run(
    filePath,
    entryId
  );
  return getDiaryEntryById(entryId)!;
}

export function applySessionDiaryDraftToEntry(
  entryId: number,
  sessionId: number,
  html: string
): DiaryEntry | null {
  const existing = getDiaryEntryById(entryId);
  if (!existing) return null;
  writeRewrittenFile(entryId, sanitizeHtml(html).trim());
  return updateDiaryEntry(entryId, {
    rewrittenFilePath: getRewrittenFilePath(entryId),
    sessionDraftFor: sessionId,
  });
}

export function getDiaryEntryBySessionDraftFor(
  sessionId: number,
  userId: string
): DiaryEntry | null {
  const row = db
    .prepare(
      'SELECT * FROM diary_entries WHERE session_draft_for = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1'
    )
    .get(sessionId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToDiaryEntry(row, getEntryEntities(row.id as number));
}

export function finalizeEntities(entities: DiaryEntities): DiaryEntities {
  const resolve = (items: string[], type: keyof DiaryEntities): string[] =>
    items.map((name) => resolveEntityName(name, type));

  const resolved: DiaryEntities = {
    persons: resolve(entities.persons, 'persons'),
    organizations: resolve(entities.organizations, 'organizations'),
    locations: resolve(entities.locations, 'locations'),
    items: resolve(entities.items, 'items'),
  };

  return filterBlacklisted(mergeEntities(resolved, emptyEntities()));
}

function isEntityBlacklisted(name: string, type: keyof DiaryEntities): boolean {
  return getBlacklists()[type].has(name.toLowerCase());
}

export function reclassifyEntity(
  name: string,
  fromType: keyof DiaryEntities,
  toType: keyof DiaryEntities,
  qualifier = ''
): void {
  const normalized = name.trim();
  if (normalized.length === 0 || fromType === toType) return;

  if (isEntityBlacklisted(normalized, toType)) return;

  const from = entityConfig[fromType];
  const to = entityConfig[toType];

  const tx = db.transaction(() => {
    const source = findEntityRow(fromType, { name: normalized, qualifier });
    if (!source) return;

    let targetId: number;
    const existingTarget = findEntityRow(toType, { name: normalized, qualifier });

    if (existingTarget) {
      targetId = existingTarget.id;
    } else {
      if (entityExistsInAnyType(normalized, fromType)) return;
      targetId = Number(
        db
          .prepare(`INSERT INTO ${to.table} (name, qualifier) VALUES (?, ?)`)
          .run(normalized, source.qualifier ?? '').lastInsertRowid
      );
    }

    const links = db
      .prepare(`SELECT diary_entry_id FROM ${from.linkTable} WHERE ${from.column} = ?`)
      .all(source.id) as { diary_entry_id: number }[];
    const insertLink = db.prepare(
      `INSERT OR IGNORE INTO ${to.linkTable} (diary_entry_id, ${to.column}) VALUES (?, ?)`
    );
    for (const { diary_entry_id } of links) {
      insertLink.run(diary_entry_id, targetId);
    }

    db.prepare(`DELETE FROM ${from.table} WHERE id = ?`).run(source.id);
    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND alias = ?').run(fromType, normalized);

    // Keep the identity-based story-arc links attached to the moved entity.
    retargetStoryArcEntities(
      fromType,
      { name: normalized, qualifier: source.qualifier ?? '' },
      toType,
      { name: normalized, qualifier: source.qualifier ?? '' }
    );

    const aliases = db
      .prepare(
        'SELECT alias FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE AND canonical_qualifier = ?'
      )
      .all(fromType, normalized, source.qualifier ?? '') as { alias: string }[];
    const insertAlias = db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (type, alias, canonical, canonical_qualifier) VALUES (?, ?, ?, ?)'
    );
    for (const { alias } of aliases) {
      insertAlias.run(toType, alias, normalized, source.qualifier ?? '');
    }
    db.prepare(
      'DELETE FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE AND canonical_qualifier = ?'
    ).run(fromType, normalized, source.qualifier ?? '');

    mergeEntityKnowledge(fromType, normalized, toType, normalized, qualifier, qualifier);
    mergeEntitySummary(fromType, normalized, toType, normalized, qualifier, qualifier);
  });

  tx();
}

export function addEntityAlias(
  type: keyof DiaryEntities,
  alias: string,
  canonical: string,
  canonicalQualifier = ''
): void {
  const aliasNormalized = alias.trim();
  const canonicalNormalized = canonical.trim();
  if (
    !aliasNormalized ||
    !canonicalNormalized ||
    (aliasNormalized.toLowerCase() === canonicalNormalized.toLowerCase() && !canonicalQualifier)
  ) {
    return;
  }

  if (
    isEntityBlacklisted(aliasNormalized, type) ||
    isEntityBlacklisted(canonicalNormalized, type)
  ) {
    return;
  }
  if (entityExistsInAnyType(aliasNormalized, type)) return;

  const { table, linkTable, column } = entityConfig[type];

  const tx = db.transaction(() => {
    const canonicalRow = findEntityRow(type, {
      name: canonicalNormalized,
      qualifier: canonicalQualifier,
    });
    if (!canonicalRow) return;

    // An alias string must not double as an entity name of another type.
    if (entityExistsInAnyType(canonicalNormalized, type)) return;

    const aliasRow = findEntityRow(type, { name: aliasNormalized, qualifier: '' }) ?? undefined;
    if (aliasRow && aliasRow.id !== canonicalRow.id) {
      const links = db
        .prepare(`SELECT diary_entry_id FROM ${linkTable} WHERE ${column} = ?`)
        .all(aliasRow.id) as { diary_entry_id: number }[];
      const insertLink = db.prepare(
        `INSERT OR IGNORE INTO ${linkTable} (diary_entry_id, ${column}) VALUES (?, ?)`
      );
      for (const { diary_entry_id } of links) {
        insertLink.run(diary_entry_id, canonicalRow.id);
      }
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(aliasRow.id);
      // The alias entity disappears; its story-arc links move to the target.
      retargetStoryArcEntities(
        type,
        { name: aliasRow.name, qualifier: aliasRow.qualifier ?? '' },
        type,
        { name: canonicalRow.name, qualifier: canonicalRow.qualifier ?? '' }
      );
      mergeEntityKnowledge(
        type,
        aliasNormalized,
        type,
        canonicalNormalized,
        '',
        canonicalQualifier
      );
      mergeEntitySummary(type, aliasNormalized, type, canonicalNormalized, '', canonicalQualifier);
    }

    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND alias = ?').run(
      type,
      aliasNormalized
    );

    db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (type, alias, canonical, canonical_qualifier) VALUES (?, ?, ?, ?)'
    ).run(type, aliasNormalized, canonicalRow.name, canonicalRow.qualifier ?? '');
  });

  tx();
}

export function getEntityDetail(
  type: keyof DiaryEntities,
  name: string,
  qualifier = ''
): { type: keyof DiaryEntities; canonical: string; qualifier: string; aliases: string[] } | null {
  const row = findEntityRow(type, resolveEntityRef({ name: name.trim(), qualifier }, type));
  if (!row) return null;

  const aliasRows = db
    .prepare(
      'SELECT alias FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE AND canonical_qualifier = ? ORDER BY alias COLLATE NOCASE'
    )
    .all(type, row.name, row.qualifier ?? '') as { alias: string }[];

  return {
    type,
    canonical: row.name,
    qualifier: row.qualifier ?? '',
    aliases: aliasRows.map((a) => a.alias),
  };
}

export function updateEntity(
  type: keyof DiaryEntities,
  oldName: string,
  newName: string,
  aliases: string[],
  oldQualifier = '',
  newQualifier = ''
): void {
  const oldNormalized = oldName.trim();
  const newNormalized = newName.trim();

  if (!oldNormalized || !newNormalized) {
    throw new AppError(400, 'Name ist erforderlich');
  }

  const { table } = entityConfig[type];

  const wantedAliases = [
    ...new Set(
      aliases
        .map((a) => a.trim())
        .filter(
          (a) => a.length > 0 && !(a.toLowerCase() === newNormalized.toLowerCase() && !newQualifier)
        )
    ),
  ];

  const tx = db.transaction(() => {
    const oldRow = findEntityRow(type, { name: oldNormalized, qualifier: oldQualifier });
    if (!oldRow) {
      throw new AppError(404, 'Entität nicht gefunden');
    }

    if (newNormalized !== oldRow.name || newQualifier !== (oldRow.qualifier ?? '')) {
      const clash = findEntityRow(type, { name: newNormalized, qualifier: newQualifier });
      if (clash && clash.id !== oldRow.id) {
        throw new AppError(409, 'Name existiert bereits');
      }
      db.prepare(`UPDATE ${table} SET name = ?, qualifier = ? WHERE id = ?`).run(
        newNormalized,
        newQualifier,
        oldRow.id
      );
      db.prepare(
        'UPDATE entity_aliases SET canonical = ?, canonical_qualifier = ? WHERE type = ? AND canonical = ? COLLATE NOCASE AND canonical_qualifier = ?'
      ).run(newNormalized, newQualifier, type, oldRow.name, oldRow.qualifier ?? '');
      renameEntityKnowledge(type, oldRow.name, newNormalized, oldRow.qualifier ?? '', newQualifier);
      // Follow the rename in the identity-based story-arc links.
      retargetStoryArcEntities(
        type,
        { name: oldRow.name, qualifier: oldRow.qualifier ?? '' },
        type,
        { name: newNormalized, qualifier: newQualifier }
      );
    } else {
      db.prepare(
        'UPDATE entity_aliases SET canonical_qualifier = ? WHERE type = ? AND canonical = ? COLLATE NOCASE AND canonical_qualifier = ?'
      ).run(newQualifier, type, oldRow.name, oldRow.qualifier ?? '');
    }

    db.prepare(
      'DELETE FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE AND canonical_qualifier = ?'
    ).run(type, newNormalized, newQualifier);

    const insertAlias = db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (type, alias, canonical, canonical_qualifier) VALUES (?, ?, ?, ?)'
    );
    const deleteAlias = db.prepare('DELETE FROM entity_aliases WHERE type = ? AND alias = ?');

    for (const alias of wantedAliases) {
      if (entityExistsInAnyType(alias)) {
        throw new AppError(409, `„${alias}“ ist bereits ein Hauptname`);
      }
      // A bare-name alias of a qualified homonym would hijack every plain
      // mention of that name; only allow it when it targets the plain name.
      const parsedAlias = splitEntityLabel(alias);
      if (
        parsedAlias.name.toLowerCase() === newNormalized.toLowerCase() &&
        parsedAlias.qualifier &&
        parsedAlias.qualifier !== newQualifier
      ) {
        throw new AppError(409, `„${alias}“ kollidiert mit dem Hauptnamen`);
      }

      deleteAlias.run(type, alias);
      insertAlias.run(type, alias, newNormalized, newQualifier);
    }
  });

  tx();
}

export function getBlacklistedEntities(): DiaryEntities {
  const rows = db
    .prepare('SELECT type, name FROM entity_blacklist ORDER BY name COLLATE NOCASE')
    .all() as { type: string; name: string }[];

  const result: DiaryEntities = {
    persons: [],
    organizations: [],
    locations: [],
    items: [],
  };

  for (const { type, name } of rows) {
    if (type in result) {
      result[type as keyof DiaryEntities].push(name);
    }
  }

  return result;
}

export function unblacklistEntity(name: string, type: keyof DiaryEntities): void {
  const normalized = name.trim();
  if (normalized.length === 0) return;
  db.prepare('DELETE FROM entity_blacklist WHERE type = ? AND name = ? COLLATE NOCASE').run(
    type,
    normalized
  );
}

export function deleteDiaryEntry(id: number): void {
  db.prepare('DELETE FROM diary_entries WHERE id = ?').run(id);
}

export function markDiaryEntryDirty(id: number): void {
  db.prepare('UPDATE diary_entries SET ai_dirty = 1 WHERE id = ?').run(id);
}

export function clearDiaryEntryDirty(id: number, processedAt?: string): void {
  const ts = processedAt ?? new Date().toISOString();
  db.prepare('UPDATE diary_entries SET ai_dirty = 0, ai_processed_at = ? WHERE id = ?').run(ts, id);
}

export function listDirtyDiaryEntries(limit?: number): DiaryEntry[] {
  const hasLimit = limit !== undefined && limit > 0;
  const sql = hasLimit
    ? 'SELECT * FROM diary_entries WHERE ai_dirty = 1 ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM diary_entries WHERE ai_dirty = 1 ORDER BY created_at DESC';
  const params = hasLimit ? [limit] : [];
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  const entryIds = rows.map((row) => row.id as number);
  const entitiesMap = buildEntryEntitiesMap(entryIds);
  return rows.map((row) =>
    rowToDiaryEntry(row, entitiesMap.get(row.id as number) ?? emptyEntities(), false)
  );
}

export function listActiveRewriteSessionIds(): string[] {
  const rows = db
    .prepare(
      'SELECT DISTINCT rewrite_session_id AS id FROM diary_entries WHERE rewrite_session_id IS NOT NULL'
    )
    .all() as { id: string }[];
  return rows.map((r) => r.id).filter((id): id is string => !!id);
}

/** Whether a person with this (case-insensitive) name exists in the world. */
export function personExists(name: string): boolean {
  const row = db.prepare('SELECT 1 FROM persons WHERE name = ? COLLATE NOCASE').get(name) as
    { '1': number } | undefined;
  return row !== undefined;
}
