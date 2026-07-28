import type { DiaryEntry } from '../../shared/types.js';
import type { DiaryEntities } from '../ai/rewrite.js';
import { stripHtml } from '../ai/rewrite.js';
import { db } from '../database.js';
import { readRewrittenFile } from '../diaryFiles.js';
import { renameEntityKnowledge } from './entityKnowledge.js';

interface EntityConfig {
  table: string;
  linkTable: string;
  column: string;
}

const entityConfig: Record<keyof DiaryEntities, EntityConfig> = {
  persons: { table: 'persons', linkTable: 'diary_entry_persons', column: 'person_id' },
  organizations: { table: 'organizations', linkTable: 'diary_entry_organizations', column: 'organization_id' },
  locations: { table: 'locations', linkTable: 'diary_entry_locations', column: 'location_id' },
};

function rowToDiaryEntry(
  row: Record<string, unknown>,
  entities: DiaryEntities,
  includeRewritten = true,
): DiaryEntry {
  const rewrittenFilePath = (row.rewritten_file_path as string | null | undefined) ?? null;
  const legacyRewrittenContent = (row.rewritten_content as string | null | undefined) ?? null;
  const rewrittenContent = includeRewritten
    ? rewrittenFilePath
      ? readRewrittenFile(row.id as number) ?? legacyRewrittenContent
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
    persons: entities.persons,
    organizations: entities.organizations,
    locations: entities.locations,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function emptyEntities(): DiaryEntities {
  return { persons: [], organizations: [], locations: [] };
}

function buildEntryEntitiesMap(entryIds: number[]): Map<number, DiaryEntities> {
  const map = new Map<number, DiaryEntities>();
  if (entryIds.length === 0) return map;

  for (const id of entryIds) {
    map.set(id, emptyEntities());
  }

  const load = (
    entityTable: string,
    linkTable: string,
    column: string,
    key: keyof DiaryEntities,
  ) => {
    const rows = db
      .prepare(
        `SELECT l.diary_entry_id AS entry_id, e.name
         FROM ${entityTable} e
         JOIN ${linkTable} l ON l.${column} = e.id
         WHERE l.diary_entry_id IN (${entryIds.map(() => '?').join(',')})
         ORDER BY e.name`,
      )
      .all(...entryIds) as { entry_id: number; name: string }[];

    for (const { entry_id, name } of rows) {
      const entities = map.get(entry_id);
      if (entities) {
        entities[key].push(name);
      }
    }
  };

  load('persons', 'diary_entry_persons', 'person_id', 'persons');
  load('organizations', 'diary_entry_organizations', 'organization_id', 'organizations');
  load('locations', 'diary_entry_locations', 'location_id', 'locations');

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

function getEntityNames(table: string): string[] {
  const rows = db.prepare(`SELECT name FROM ${table}`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

export function listAllEntityNames(): DiaryEntities {
  return {
    persons: getEntityNames('persons'),
    organizations: getEntityNames('organizations'),
    locations: getEntityNames('locations'),
  };
}

export function findEntityCanonicalName(type: keyof DiaryEntities, name: string): string | null {
  const { table } = entityConfig[type];
  const canonical = resolveEntityName(name.trim(), type);
  const existing = db.prepare(`SELECT name FROM ${table} WHERE name = ? COLLATE NOCASE`).get(canonical) as { name: string } | undefined;
  return existing ? existing.name : null;
}

export function ensureEntityExists(type: keyof DiaryEntities, name: string): string {
  const canonical = findEntityCanonicalName(type, name);
  if (canonical) return canonical;
  const { table } = entityConfig[type];
  const resolved = resolveEntityName(name.trim(), type);
  db.prepare(`INSERT OR IGNORE INTO ${table} (name) VALUES (?)`).run(resolved);
  return resolved;
}

function getAliasEntries(
  type: keyof DiaryEntities,
): Map<string, { alias: string; canonical: string }> {
  const rows = db
    .prepare('SELECT alias, canonical FROM entity_aliases WHERE type = ?')
    .all(type) as { alias: string; canonical: string }[];

  const map = new Map<string, { alias: string; canonical: string }>();
  for (const { alias, canonical } of rows) {
    map.set(alias.toLowerCase(), { alias, canonical });
  }
  return map;
}

export function resolveEntityName(name: string, type: keyof DiaryEntities): string {
  const aliases = getAliasEntries(type);
  let current = name.trim();
  const seen = new Set<string>();

  while (aliases.has(current.toLowerCase()) && !seen.has(current.toLowerCase())) {
    seen.add(current.toLowerCase());
    current = aliases.get(current.toLowerCase())!.canonical;
  }

  return current;
}

export function findExistingEntitiesInText(text: string): DiaryEntities {
  const plainText = stripHtml(text);
  const result: DiaryEntities = emptyEntities();
  const blacklists = getBlacklists();

  const detect = (type: keyof DiaryEntities) => {
    const { table } = entityConfig[type];
    const aliases = getAliasEntries(type);
    const entityNames = new Set<string>(getEntityNames(table).map((name) => name.toLowerCase()));
    const triggers = new Map<string, { name: string; canonical: string }>();

    for (const name of getEntityNames(table)) {
      const lower = name.toLowerCase();
      if (!triggers.has(lower)) {
        triggers.set(lower, { name, canonical: name });
      }
    }

    for (const { alias, canonical } of aliases.values()) {
      const lower = alias.toLowerCase();
      if (!triggers.has(lower)) {
        triggers.set(lower, { name: alias, canonical });
      }
    }

    const seen = new Set<string>();
    for (const { name, canonical } of triggers.values()) {
      const canonicalResolved = resolveEntityName(canonical, type);
      const canonicalLower = canonicalResolved.toLowerCase();
      if (!entityNames.has(canonicalLower)) continue;
      if (seen.has(canonicalLower)) continue;

      const triggerLower = name.toLowerCase();
      if (blacklists[type].has(triggerLower) || blacklists[type].has(canonicalLower)) continue;

      if (entityNameRegex(name).test(plainText)) {
        result[type].push(canonicalResolved);
        seen.add(canonicalLower);
      }
    }
  };

  detect('persons');
  detect('organizations');
  detect('locations');

  return result;
}

export function mergeEntities(
  aiEntities: DiaryEntities,
  existingEntities: DiaryEntities,
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
  };
}

type EntityBlacklists = Record<keyof DiaryEntities, Set<string>>;

function getBlacklists(): EntityBlacklists {
  const rows = db
    .prepare('SELECT type, name FROM entity_blacklist')
    .all() as { type: string; name: string }[];

  const lists: EntityBlacklists = {
    persons: new Set<string>(),
    organizations: new Set<string>(),
    locations: new Set<string>(),
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
    organizations: entities.organizations.filter((name) => !blacklists.organizations.has(name.toLowerCase())),
    locations: entities.locations.filter((name) => !blacklists.locations.has(name.toLowerCase())),
  };
}

export function blacklistEntity(name: string, type: keyof DiaryEntities): void {
  const normalized = name.trim();
  if (normalized.length === 0) return;

  const { table } = entityConfig[type];

  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO entity_blacklist (type, name) VALUES (?, ?)').run(
      type,
      normalized,
    );
    db.prepare(`DELETE FROM ${table} WHERE name = ? COLLATE NOCASE`).run(normalized);
    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND (alias = ? OR canonical = ?)').run(
      type,
      normalized,
      normalized,
    );
  });

  tx();
}

function entityExistsInAnyType(
  name: string,
  excludeType?: keyof DiaryEntities,
): { type: keyof DiaryEntities; name: string } | null {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) return null;

  for (const type of ['persons', 'organizations', 'locations'] as const) {
    if (type === excludeType) continue;
    const { table } = entityConfig[type];
    const row = db
      .prepare(`SELECT name FROM ${table} WHERE name = ? COLLATE NOCASE`)
      .get(name) as { name: string } | undefined;
    if (row) return { type, name: row.name };
  }

  return null;
}

function setLinkedEntities(
  entryId: number,
  names: string[],
  entityTable: string,
  linkTable: string,
  column: string,
): void {
  const normalized = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];

  db.prepare(`DELETE FROM ${linkTable} WHERE diary_entry_id = ?`).run(entryId);
  if (normalized.length === 0) return;

  const blacklists = getBlacklists();
  const blacklistKey = entityTable as keyof DiaryEntities;
  const blacklist = blacklists[blacklistKey];

  const insertEntity = db.prepare(`INSERT OR IGNORE INTO ${entityTable} (name) VALUES (?)`);
  const getEntity = db.prepare(`SELECT id FROM ${entityTable} WHERE name = ?`);
  const linkEntity = db.prepare(`INSERT INTO ${linkTable} (diary_entry_id, ${column}) VALUES (?, ?)`);

  const tx = db.transaction((targetId: number, namesToLink: string[]) => {
    for (const name of namesToLink) {
      const originalLower = name.toLowerCase();
      const aliasResolved = resolveEntityName(name, blacklistKey);
      const existing = db
        .prepare(`SELECT name FROM ${entityTable} WHERE name = ? COLLATE NOCASE`)
        .get(aliasResolved) as { name: string } | undefined;

      if (!existing && originalLower !== aliasResolved.toLowerCase()) continue;

      const canonical = existing?.name ?? aliasResolved;
      const canonicalLower = canonical.toLowerCase();

      if (blacklist.has(originalLower) || blacklist.has(canonicalLower)) continue;
      if (entityExistsInAnyType(canonical, blacklistKey)) continue;

      insertEntity.run(canonical);
      const entity = getEntity.get(canonical) as { id: number } | undefined;
      if (!entity) continue;
      linkEntity.run(targetId, entity.id);
    }
  });

  tx(entryId, normalized);
}

export function setDiaryEntryPersons(entryId: number, persons: string[]): void {
  setLinkedEntities(entryId, persons, 'persons', 'diary_entry_persons', 'person_id');
}

export function setDiaryEntryOrganizations(entryId: number, organizations: string[]): void {
  setLinkedEntities(entryId, organizations, 'organizations', 'diary_entry_organizations', 'organization_id');
}

export function setDiaryEntryLocations(entryId: number, locations: string[]): void {
  setLinkedEntities(entryId, locations, 'locations', 'diary_entry_locations', 'location_id');
}

export function createDiaryEntry(
  userId: string,
  title: string,
  content: string,
  summary?: string | null,
): DiaryEntry {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      'INSERT INTO diary_entries (user_id, title, content, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(userId, title.trim(), content.trim(), summary ? summary.trim() : null, now, now);
  return getDiaryEntryById(Number(result.lastInsertRowid))!;
}

export function getDiaryEntryById(id: number): DiaryEntry | null {
  const row = db.prepare('SELECT * FROM diary_entries WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return rowToDiaryEntry(row, getEntryEntities(id));
}

export function listDiaryEntriesByUser(userId: string): DiaryEntry[] {
  const rows = db
    .prepare('SELECT * FROM diary_entries WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Record<string, unknown>[];
  const entryIds = rows.map((row) => row.id as number);
  const entitiesMap = buildEntryEntitiesMap(entryIds);
  return rows.map((row) =>
    rowToDiaryEntry(
      row,
      entitiesMap.get(row.id as number) ?? emptyEntities(),
      false,
    ),
  );
}

export function listPreviousDiaryEntriesByUser(
  userId: string,
  beforeCreatedAt: string,
  limit = 3,
): { id: number; title: string; content: string; createdAt: string }[] {
  const rows = db
    .prepare(
      `SELECT id, title, content, created_at AS createdAt
       FROM diary_entries
       WHERE user_id = ? AND created_at < ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(userId, beforeCreatedAt, limit) as {
      id: number;
      title: string;
      content: string;
      createdAt: string;
    }[];
  return rows;
}

export function searchDiaryEntries(
  query: string,
  limit = 5,
): { id: number; title: string; content: string; createdAt: string }[] {
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const like = `%${escaped}%`;
  const rows = db
    .prepare(
      `SELECT id, title, content, created_at AS createdAt
       FROM diary_entries
       WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(like, like, limit) as { id: number; title: string; content: string; createdAt: string }[];
  return rows;
}

export function listDiaryEntryContentsByEntity(
  type: keyof DiaryEntities,
  name: string,
): { id: number; title: string; content: string; createdAt: string }[] {
  const { table, linkTable, column } = entityConfig[type];
  const rows = db
    .prepare(
      `SELECT de.id, de.title, de.content, de.created_at AS createdAt
       FROM diary_entries de
       JOIN ${linkTable} l ON l.diary_entry_id = de.id
       JOIN ${table} e ON e.id = l.${column}
       WHERE e.name = ? COLLATE NOCASE
       ORDER BY de.created_at DESC`,
    )
    .all(name) as { id: number; title: string; content: string; createdAt: string }[];
  return rows;
}

export function updateDiaryEntry(
  id: number,
  updates: Partial<
    Pick<DiaryEntry, 'title' | 'content' | 'summary' | 'rewrittenContent' | 'persons' | 'organizations' | 'locations'> & {
      rewrittenFilePath?: string | null;
      rewriteSessionId?: string | null;
    }
  >,
): DiaryEntry | null {
  const existing = getDiaryEntryById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title.trim());
  }
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content.trim());
  }
  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    values.push(updates.summary ? updates.summary.trim() : null);
  }
  if (updates.rewrittenContent !== undefined) {
    fields.push('rewritten_content = ?');
    values.push(updates.rewrittenContent ? updates.rewrittenContent.trim() : null);
  }
  if (updates.rewrittenFilePath !== undefined) {
    fields.push('rewritten_file_path = ?');
    values.push(updates.rewrittenFilePath ? updates.rewrittenFilePath.trim() : null);
  }
  if (updates.rewriteSessionId !== undefined) {
    fields.push('rewrite_session_id = ?');
    values.push(updates.rewriteSessionId ? updates.rewriteSessionId.trim() : null);
  }

  const hasPersonsUpdate = updates.persons !== undefined;
  const hasOrganizationsUpdate = updates.organizations !== undefined;
  const hasLocationsUpdate = updates.locations !== undefined;

  if (
    fields.length === 0 &&
    !hasPersonsUpdate &&
    !hasOrganizationsUpdate &&
    !hasLocationsUpdate
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

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE diary_entries SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getDiaryEntryById(id);
}

export function finalizeEntities(entities: DiaryEntities): DiaryEntities {
  const resolve = (items: string[], type: keyof DiaryEntities): string[] =>
    items.map((name) => resolveEntityName(name, type));

  const resolved: DiaryEntities = {
    persons: resolve(entities.persons, 'persons'),
    organizations: resolve(entities.organizations, 'organizations'),
    locations: resolve(entities.locations, 'locations'),
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
): void {
  const normalized = name.trim();
  if (normalized.length === 0 || fromType === toType) return;

  if (isEntityBlacklisted(normalized, toType)) return;

  const from = entityConfig[fromType];
  const to = entityConfig[toType];

  const tx = db.transaction(() => {
    const source = db
      .prepare(`SELECT id FROM ${from.table} WHERE name = ? COLLATE NOCASE`)
      .get(normalized) as { id: number } | undefined;
    if (!source) return;

    let targetId: number;
    const existingTarget = db
      .prepare(`SELECT id FROM ${to.table} WHERE name = ? COLLATE NOCASE`)
      .get(normalized) as { id: number } | undefined;

    if (existingTarget) {
      targetId = existingTarget.id;
    } else {
      if (entityExistsInAnyType(normalized, fromType)) return;
      targetId = Number(
        db.prepare(`INSERT INTO ${to.table} (name) VALUES (?)`).run(normalized).lastInsertRowid,
      );
    }

    const links = db
      .prepare(`SELECT diary_entry_id FROM ${from.linkTable} WHERE ${from.column} = ?`)
      .all(source.id) as { diary_entry_id: number }[];
    const insertLink = db.prepare(
      `INSERT OR IGNORE INTO ${to.linkTable} (diary_entry_id, ${to.column}) VALUES (?, ?)`,
    );
    for (const { diary_entry_id } of links) {
      insertLink.run(diary_entry_id, targetId);
    }

    db.prepare(`DELETE FROM ${from.table} WHERE id = ?`).run(source.id);
    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND alias = ?').run(fromType, normalized);

    const aliases = db
      .prepare('SELECT alias FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE')
      .all(fromType, normalized) as { alias: string }[];
    const insertAlias = db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (type, alias, canonical) VALUES (?, ?, ?)',
    );
    for (const { alias } of aliases) {
      insertAlias.run(toType, alias, normalized);
    }
    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE').run(
      fromType,
      normalized,
    );
  });

  tx();
}

export function addEntityAlias(
  type: keyof DiaryEntities,
  alias: string,
  canonical: string,
): void {
  const aliasNormalized = alias.trim();
  const canonicalNormalized = canonical.trim();
  if (
    !aliasNormalized ||
    !canonicalNormalized ||
    aliasNormalized.toLowerCase() === canonicalNormalized.toLowerCase()
  ) {
    return;
  }

  if (isEntityBlacklisted(aliasNormalized, type) || isEntityBlacklisted(canonicalNormalized, type)) {
    return;
  }
  if (entityExistsInAnyType(aliasNormalized, type)) return;
  if (entityExistsInAnyType(canonicalNormalized, type)) return;

  const { table, linkTable, column } = entityConfig[type];

  const tx = db.transaction(() => {
    const canonicalRow = db
      .prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`)
      .get(canonicalNormalized) as { id: number } | undefined;
    if (!canonicalRow) return;

    const aliasRow = db
      .prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`)
      .get(aliasNormalized) as { id: number } | undefined;
    if (aliasRow) {
      const links = db
        .prepare(`SELECT diary_entry_id FROM ${linkTable} WHERE ${column} = ?`)
        .all(aliasRow.id) as { diary_entry_id: number }[];
      const insertLink = db.prepare(
        `INSERT OR IGNORE INTO ${linkTable} (diary_entry_id, ${column}) VALUES (?, ?)`,
      );
      for (const { diary_entry_id } of links) {
        insertLink.run(diary_entry_id, canonicalRow.id);
      }
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(aliasRow.id);
    }

    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND alias = ?').run(
      type,
      aliasNormalized,
    );

    db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (type, alias, canonical) VALUES (?, ?, ?)',
    ).run(type, aliasNormalized, canonicalNormalized);
  });

  tx();
}

export function getEntityDetail(
  type: keyof DiaryEntities,
  name: string,
): { type: keyof DiaryEntities; canonical: string; aliases: string[] } | null {
  const { table } = entityConfig[type];
  const canonical = resolveEntityName(name.trim(), type);

  const row = db
    .prepare(`SELECT name FROM ${table} WHERE name = ? COLLATE NOCASE`)
    .get(canonical) as { name: string } | undefined;
  if (!row) return null;

  const aliasRows = db
    .prepare(
      'SELECT alias FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE ORDER BY alias COLLATE NOCASE',
    )
    .all(type, row.name) as { alias: string }[];

  return {
    type,
    canonical: row.name,
    aliases: aliasRows.map((a) => a.alias),
  };
}

export function updateEntity(
  type: keyof DiaryEntities,
  oldName: string,
  newName: string,
  aliases: string[],
): void {
  const oldNormalized = oldName.trim();
  const newNormalized = newName.trim();

  if (!oldNormalized || !newNormalized) {
    throw new Error('Name ist erforderlich');
  }

  const { table } = entityConfig[type];

  const wantedAliases = [
    ...new Set(
      aliases
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.toLowerCase() !== newNormalized.toLowerCase()),
    ),
  ];

  const tx = db.transaction(() => {
    const oldRow = db
      .prepare(`SELECT id, name FROM ${table} WHERE name = ? COLLATE NOCASE`)
      .get(oldNormalized) as { id: number; name: string } | undefined;
    if (!oldRow) {
      throw new Error('Entität nicht gefunden');
    }

    if (newNormalized !== oldRow.name) {
      const existing = db
        .prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND id != ?`)
        .get(newNormalized, oldRow.id) as { id: number } | undefined;
      if (existing) {
        throw new Error('Name existiert bereits');
      }
      db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(newNormalized, oldRow.id);
      db.prepare(
        'UPDATE entity_aliases SET canonical = ? WHERE type = ? AND canonical = ? COLLATE NOCASE',
      ).run(newNormalized, type, oldRow.name);
      renameEntityKnowledge(type, oldRow.name, newNormalized);
    }

    db.prepare('DELETE FROM entity_aliases WHERE type = ? AND canonical = ? COLLATE NOCASE').run(
      type,
      newNormalized,
    );

    const insertAlias = db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (type, alias, canonical) VALUES (?, ?, ?)',
    );
    const deleteAlias = db.prepare('DELETE FROM entity_aliases WHERE type = ? AND alias = ?');

    for (const alias of wantedAliases) {
      if (entityExistsInAnyType(alias)) {
        throw new Error(`„${alias}“ ist bereits ein Hauptname`);
      }

      deleteAlias.run(type, alias);
      insertAlias.run(type, alias, newNormalized);
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
    normalized,
  );
}

export function deleteDiaryEntry(id: number): void {
  db.prepare('DELETE FROM diary_entries WHERE id = ?').run(id);
}

export function listActiveRewriteSessionIds(): string[] {
  const rows = db
    .prepare('SELECT DISTINCT rewrite_session_id AS id FROM diary_entries WHERE rewrite_session_id IS NOT NULL')
    .all() as { id: string }[];
  return rows.map((r) => r.id).filter((id): id is string => !!id);
}
