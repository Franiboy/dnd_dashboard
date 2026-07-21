import type { DiaryEntry } from '../../shared/types.js';
import { db } from '../database.js';

interface EntryEntities {
  persons: string[];
  organizations: string[];
  locations: string[];
}

function rowToDiaryEntry(row: Record<string, unknown>, entities: EntryEntities): DiaryEntry {
  return {
    id: row.id as number,
    userId: row.user_id as string,
    title: row.title as string,
    content: row.content as string,
    summary: (row.summary as string | null | undefined) ?? null,
    rewrittenContent: (row.rewritten_content as string | null | undefined) ?? null,
    persons: entities.persons,
    organizations: entities.organizations,
    locations: entities.locations,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function emptyEntities(): EntryEntities {
  return { persons: [], organizations: [], locations: [] };
}

function buildEntryEntitiesMap(entryIds: number[]): Map<number, EntryEntities> {
  const map = new Map<number, EntryEntities>();
  if (entryIds.length === 0) return map;

  for (const id of entryIds) {
    map.set(id, emptyEntities());
  }

  const load = (
    entityTable: string,
    linkTable: string,
    column: string,
    key: keyof EntryEntities,
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

function getEntryEntities(entryId: number): EntryEntities {
  const map = buildEntryEntitiesMap([entryId]);
  return map.get(entryId) ?? emptyEntities();
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

  const insertEntity = db.prepare(`INSERT OR IGNORE INTO ${entityTable} (name) VALUES (?)`);
  const getEntity = db.prepare(`SELECT id FROM ${entityTable} WHERE name = ?`);
  const linkEntity = db.prepare(`INSERT INTO ${linkTable} (diary_entry_id, ${column}) VALUES (?, ?)`);

  const tx = db.transaction((targetId: number, namesToLink: string[]) => {
    for (const name of namesToLink) {
      insertEntity.run(name);
      const entity = getEntity.get(name) as { id: number } | undefined;
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
    rowToDiaryEntry(row, entitiesMap.get(row.id as number) ?? emptyEntities()),
  );
}

export function updateDiaryEntry(
  id: number,
  updates: Partial<
    Pick<DiaryEntry, 'title' | 'content' | 'summary' | 'rewrittenContent' | 'persons' | 'organizations' | 'locations'>
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

export function deleteDiaryEntry(id: number): void {
  db.prepare('DELETE FROM diary_entries WHERE id = ?').run(id);
}
