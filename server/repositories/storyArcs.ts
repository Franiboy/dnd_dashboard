import { db } from '../database.js';
import { AppError } from '../errors.js';
import type { EntityType, StoryArc, StoryArcStatus } from '../../shared/types.js';
import type { EntityRef } from './entityRefs.js';

export const STORY_ARC_ENTITY_TYPES: readonly EntityType[] = [
  'persons',
  'organizations',
  'locations',
  'items',
];

export interface StoryArcEntityRef extends EntityRef {
  entityType: EntityType;
}

interface StoryArcStats {
  sessionCount: number;
  diaryEntryCount: number;
  entityCount: number;
  gameDayStart: number | null;
  gameDayEnd: number | null;
}

interface ArcMemberStatsRow {
  arc_id: number;
  n: number;
  min_day: number | null;
  max_day: number | null;
}

/**
 * Aggregated member stats for the given arcs. The game-day range is derived
 * from the members (sessions span [game_day, game_day_end], entries have a
 * single game_day); it is never stored on the arc itself.
 */
function loadArcStats(): Map<number, StoryArcStats> {
  const stats = new Map<number, StoryArcStats>();
  const ensure = (arcId: number): StoryArcStats => {
    let entry = stats.get(arcId);
    if (!entry) {
      entry = {
        sessionCount: 0,
        diaryEntryCount: 0,
        entityCount: 0,
        gameDayStart: null,
        gameDayEnd: null,
      };
      stats.set(arcId, entry);
    }
    return entry;
  };

  const widen = (arcId: number, minDay: number | null, maxDay: number | null): void => {
    const entry = ensure(arcId);
    if (minDay !== null && (entry.gameDayStart === null || minDay < entry.gameDayStart)) {
      entry.gameDayStart = minDay;
    }
    if (maxDay !== null && (entry.gameDayEnd === null || maxDay > entry.gameDayEnd)) {
      entry.gameDayEnd = maxDay;
    }
  };

  const sessionRows = db
    .prepare(
      `SELECT arc_id, COUNT(*) AS n, MIN(game_day) AS min_day,
              MAX(COALESCE(game_day_end, game_day)) AS max_day
       FROM recording_sessions WHERE arc_id IS NOT NULL GROUP BY arc_id`
    )
    .all() as ArcMemberStatsRow[];
  for (const row of sessionRows) {
    ensure(row.arc_id).sessionCount = row.n;
    widen(row.arc_id, row.min_day, row.max_day);
  }

  const diaryRows = db
    .prepare(
      `SELECT arc_id, COUNT(*) AS n, MIN(game_day) AS min_day, MAX(game_day) AS max_day
       FROM diary_entries WHERE arc_id IS NOT NULL GROUP BY arc_id`
    )
    .all() as ArcMemberStatsRow[];
  for (const row of diaryRows) {
    ensure(row.arc_id).diaryEntryCount = row.n;
    widen(row.arc_id, row.min_day, row.max_day);
  }

  const entityRows = db
    .prepare('SELECT arc_id, COUNT(*) AS n FROM story_arc_entities GROUP BY arc_id')
    .all() as { arc_id: number; n: number }[];
  for (const row of entityRows) {
    ensure(row.arc_id).entityCount = row.n;
  }

  return stats;
}

function rowToStoryArc(row: Record<string, unknown>, stats: StoryArcStats): StoryArc {
  return {
    id: row.id as number,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    status: row.status as StoryArcStatus,
    chapterNumber: (row.chapter_number as number | null) ?? null,
    sessionCount: stats.sessionCount,
    diaryEntryCount: stats.diaryEntryCount,
    entityCount: stats.entityCount,
    gameDayStart: stats.gameDayStart,
    gameDayEnd: stats.gameDayEnd,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listStoryArcs(): StoryArc[] {
  const rows = db
    .prepare(
      `SELECT id, name, description, status, chapter_number, created_at, updated_at FROM story_arcs
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, created_at ASC`
    )
    .all() as Record<string, unknown>[];
  const stats = loadArcStats();
  return rows.map((row) => rowToStoryArc(row, stats.get(row.id as number) ?? loadEmptyStats()));
}

function loadEmptyStats(): StoryArcStats {
  return {
    sessionCount: 0,
    diaryEntryCount: 0,
    entityCount: 0,
    gameDayStart: null,
    gameDayEnd: null,
  };
}

export function getStoryArc(id: number): StoryArc | null {
  const row = db
    .prepare(
      'SELECT id, name, description, status, chapter_number, created_at, updated_at FROM story_arcs WHERE id = ?'
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const stats = loadArcStats().get(id) ?? loadEmptyStats();
  return rowToStoryArc(row, stats);
}

/** Cheap existence check for validation hot paths (no stats aggregation). */
export function storyArcExists(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM story_arcs WHERE id = ?').get(id);
}

export function getActiveArcId(): number | null {
  const row = db
    .prepare("SELECT id FROM story_arcs WHERE status = 'active' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function getArcIdForSession(sessionId: number): number | null {
  const row = db.prepare('SELECT arc_id FROM recording_sessions WHERE id = ?').get(sessionId) as
    { arc_id: number | null } | undefined;
  return row?.arc_id ?? null;
}

export function getArcIdForDiaryEntry(entryId: number): number | null {
  const row = db.prepare('SELECT arc_id FROM diary_entries WHERE id = ?').get(entryId) as
    { arc_id: number | null } | undefined;
  return row?.arc_id ?? null;
}

export interface CreateStoryArcInput {
  name: string;
  description?: string | null;
  chapterNumber?: number | null;
}

/** Validates an incoming chapter number (NULL = unnumbered arc). */
function assertValidChapterNumber(chapterNumber: number | null): void {
  if (chapterNumber !== null && (!Number.isInteger(chapterNumber) || chapterNumber < 1)) {
    throw new AppError(400, 'Kapitelnummer muss eine positive ganze Zahl sein');
  }
}

/** Chapter numbers are unique; NULL is exempt (SQLite treats NULLs as distinct). */
function assertChapterNumberFree(chapterNumber: number, excludeId?: number): void {
  const row = db
    .prepare('SELECT 1 FROM story_arcs WHERE chapter_number = ? AND id != ? LIMIT 1')
    .get(chapterNumber, excludeId ?? -1);
  if (row) {
    throw new AppError(409, `Kapitelnummer ${chapterNumber} ist bereits vergeben`);
  }
}

/**
 * Seeds a freshly created arc with the main characters: every approved user's
 * active_person is linked as a person (duplicates collapse via the composite
 * PK). Names without a world entity row are skipped — link rows must only
 * ever reference real entities (see canonicalEntityRef).
 */
function linkUserActivePersons(arcId: number): void {
  const rows = db
    .prepare(
      "SELECT DISTINCT active_person AS name FROM users WHERE is_approved = 1 AND active_person IS NOT NULL AND TRIM(active_person) <> ''"
    )
    .all() as { name: string }[];
  for (const row of rows) {
    linkStoryArcEntity(arcId, 'persons', { name: row.name, qualifier: '' });
  }
}

export function createStoryArc(input: CreateStoryArcInput): StoryArc {
  const chapterNumber = input.chapterNumber ?? null;
  assertValidChapterNumber(chapterNumber);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (chapterNumber !== null) assertChapterNumberFree(chapterNumber);
    const result = db
      .prepare(
        "INSERT INTO story_arcs (name, description, status, chapter_number, created_at, updated_at) VALUES (?, ?, 'planned', ?, ?, ?)"
      )
      .run(input.name.trim(), input.description?.trim() || null, chapterNumber, now, now);
    const arcId = Number(result.lastInsertRowid);
    linkUserActivePersons(arcId);
    return arcId;
  });
  return getStoryArc(tx())!;
}

export function updateStoryArc(
  id: number,
  updates: { name?: string; description?: string | null; chapterNumber?: number | null }
): StoryArc | null {
  const existing = getStoryArc(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name.trim());
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description?.trim() || null);
  }
  if (updates.chapterNumber !== undefined) {
    assertValidChapterNumber(updates.chapterNumber);
    if (updates.chapterNumber !== null) assertChapterNumberFree(updates.chapterNumber, id);
    fields.push('chapter_number = ?');
    values.push(updates.chapterNumber);
  }
  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE story_arcs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getStoryArc(id);
}

/**
 * Makes the given arc the single active one. The previously active arc is
 * marked completed; new sessions/entries are filed into the active arc.
 */
export function activateStoryArc(id: number): StoryArc | null {
  const existing = getStoryArc(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE story_arcs SET status = 'completed', updated_at = ? WHERE status = 'active'"
    ).run(now);
    db.prepare("UPDATE story_arcs SET status = 'active', updated_at = ? WHERE id = ?").run(now, id);
  });
  tx();
  return getStoryArc(id);
}

export function deleteStoryArc(id: number): boolean {
  const existing = getStoryArc(id);
  if (!existing) return false;
  if (existing.status === 'active') {
    throw new AppError(
      409,
      'Der aktive Story Arc kann nicht gelöscht werden – aktiviere zuerst einen anderen Arc'
    );
  }
  if (existing.status === 'completed') {
    throw new AppError(409, 'Abgeschlossene Story Arcs können nicht gelöscht werden');
  }

  // Members keep no dangling reference (arc_id has no FK, so the columns are
  // nulled explicitly); entity links cascade via their FK.
  const tx = db.transaction(() => {
    db.prepare('UPDATE recording_sessions SET arc_id = NULL WHERE arc_id = ?').run(id);
    db.prepare('UPDATE diary_entries SET arc_id = NULL WHERE arc_id = ?').run(id);
    db.prepare('UPDATE timeline_events SET arc_id = NULL WHERE arc_id = ?').run(id);
    db.prepare('DELETE FROM story_arcs WHERE id = ?').run(id);
  });
  tx();
  return true;
}

export function assignSessionToArc(sessionId: number, arcId: number | null): void {
  if (arcId !== null && !storyArcExists(arcId)) {
    throw new AppError(404, 'Story Arc nicht gefunden');
  }
  db.prepare('UPDATE recording_sessions SET arc_id = ?, updated_at = ? WHERE id = ?').run(
    arcId,
    new Date().toISOString(),
    sessionId
  );
}

export function assignDiaryEntryToArc(entryId: number, arcId: number | null): void {
  if (arcId !== null && !storyArcExists(arcId)) {
    throw new AppError(404, 'Story Arc nicht gefunden');
  }
  db.prepare('UPDATE diary_entries SET arc_id = ?, updated_at = ? WHERE id = ?').run(
    arcId,
    new Date().toISOString(),
    entryId
  );
}

/** Derived inclusive game-day range of an arc (from its members). */
export function getStoryArcDayRange(arcId: number): { start: number | null; end: number | null } {
  const arc = getStoryArc(arcId);
  return { start: arc?.gameDayStart ?? null, end: arc?.gameDayEnd ?? null };
}

/**
 * Whether a knowledge validity window overlaps the arc's derived day range.
 * valid_from is inclusive, valid_until EXCLUSIVE, NULL is open-ended — so a
 * timeless fact (both NULL) holds during the whole range and stays visible.
 */
export function knowledgeOverlapsArcRange(
  entry: { validFrom: number | null; validUntil: number | null },
  range: { start: number | null; end: number | null }
): boolean {
  if (range.start === null && range.end === null) return true;
  if (entry.validFrom !== null && range.end !== null && entry.validFrom > range.end) return false;
  if (entry.validUntil !== null && range.start !== null && entry.validUntil <= range.start) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Entity <-> arc links (many-to-many)
// ---------------------------------------------------------------------------

/**
 * Resolves the exact spelling of an entity row for a (case-insensitively)
 * matching identity. Returns null when no such entity exists — the link table
 * must only ever reference real entity rows, never ghost spellings.
 */
function canonicalEntityRef(entityType: EntityType, ref: EntityRef): EntityRef | null {
  if (!STORY_ARC_ENTITY_TYPES.includes(entityType)) return null;
  const row = db
    .prepare(
      `SELECT name, qualifier FROM ${entityType} WHERE name = ? COLLATE NOCASE AND qualifier = ?`
    )
    .get(ref.name.trim(), ref.qualifier ?? '') as { name: string; qualifier?: string } | undefined;
  return row ? { name: row.name, qualifier: row.qualifier ?? '' } : null;
}

export function linkStoryArcEntity(arcId: number, entityType: EntityType, ref: EntityRef): void {
  const canonical = canonicalEntityRef(entityType, ref);
  if (!canonical) return;
  db.prepare(
    'INSERT OR IGNORE INTO story_arc_entities (arc_id, entity_type, entity_name, entity_qualifier) VALUES (?, ?, ?, ?)'
  ).run(arcId, entityType, canonical.name, canonical.qualifier);
}

export function unlinkStoryArcEntity(
  arcId: number,
  entityType: EntityType,
  name: string,
  qualifier = ''
): void {
  db.prepare(
    'DELETE FROM story_arc_entities WHERE arc_id = ? AND entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
  ).run(arcId, entityType, name.trim(), qualifier);
}

export function listStoryArcEntities(
  arcId?: number
): { arcId: number; entityType: EntityType; name: string; qualifier: string }[] {
  const rows = arcId
    ? db
        .prepare(
          'SELECT arc_id, entity_type, entity_name, entity_qualifier FROM story_arc_entities WHERE arc_id = ?'
        )
        .all(arcId)
    : db
        .prepare(
          'SELECT arc_id, entity_type, entity_name, entity_qualifier FROM story_arc_entities'
        )
        .all();
  return (
    rows as {
      arc_id: number;
      entity_type: EntityType;
      entity_name: string;
      entity_qualifier: string;
    }[]
  ).map((row) => ({
    arcId: row.arc_id,
    entityType: row.entity_type,
    name: row.entity_name,
    qualifier: row.entity_qualifier ?? '',
  }));
}

/** Arc ids an entity is assigned to (for the entity dialog checkboxes). */
export function listArcIdsForEntity(
  entityType: EntityType,
  name: string,
  qualifier = ''
): number[] {
  const rows = db
    .prepare(
      'SELECT arc_id FROM story_arc_entities WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    )
    .all(entityType, name.trim(), qualifier) as { arc_id: number }[];
  return rows.map((row) => row.arc_id);
}

/** All entities linked to the given arc, split per world panel. */
export function listEntitiesForArc(arcId: number): Record<EntityType, EntityRef[]> {
  const result: Record<EntityType, EntityRef[]> = {
    persons: [],
    organizations: [],
    locations: [],
    items: [],
  };
  for (const link of listStoryArcEntities(arcId)) {
    result[link.entityType].push({ name: link.name, qualifier: link.qualifier });
  }
  return sortPerType(result);
}

/** All entities that are assigned to no story arc at all ("Ohne Arc" view). */
export function listEntitiesOutsideArcs(): Record<EntityType, EntityRef[]> {
  const result: Record<EntityType, EntityRef[]> = {
    persons: [],
    organizations: [],
    locations: [],
    items: [],
  };
  for (const type of STORY_ARC_ENTITY_TYPES) {
    const rows = db
      .prepare(
        `SELECT name, qualifier FROM ${type} t
         WHERE NOT EXISTS (
           SELECT 1 FROM story_arc_entities sae
           WHERE sae.entity_type = ?
             AND sae.entity_name = t.name
             AND sae.entity_qualifier = t.qualifier
         )
         ORDER BY name COLLATE NOCASE, qualifier`
      )
      .all(type) as { name: string; qualifier?: string }[];
    for (const row of rows) {
      result[type].push({ name: row.name, qualifier: row.qualifier ?? '' });
    }
  }
  return result;
}

function sortPerType(result: Record<EntityType, EntityRef[]>): Record<EntityType, EntityRef[]> {
  for (const type of STORY_ARC_ENTITY_TYPES) {
    result[type].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }
  return result;
}

/**
 * Additive auto-link: files an entity into the arc of the given diary entry.
 * No-op when the entry is unassigned. Idempotent via the composite PK.
 */
export function linkStoryArcEntityForDiaryEntry(
  entryId: number,
  entityType: EntityType,
  ref: EntityRef
): void {
  const arcId = getArcIdForDiaryEntry(entryId);
  if (arcId === null) return;
  linkStoryArcEntity(arcId, entityType, ref);
}

/**
 * Additive auto-link: files every affected entity of a knowledge run into the
 * arc of the given session (sessions have no diary-link path of their own).
 */
export function linkStoryArcEntitiesForSession(
  sessionId: number,
  entityType: EntityType,
  ref: EntityRef
): void {
  const arcId = getArcIdForSession(sessionId);
  if (arcId === null) return;
  linkStoryArcEntity(arcId, entityType, ref);
}

/**
 * Keeps the identity-based links in sync when an entity row itself changes
 * (rename / requalify / reclassify). Moves the link rows of the old identity
 * onto the new one, ignoring rows that already exist for the new identity.
 */
export function retargetStoryArcEntities(
  entityType: EntityType,
  oldRef: EntityRef,
  newEntityType: EntityType,
  newRef: EntityRef
): void {
  const rows = db
    .prepare(
      'SELECT arc_id FROM story_arc_entities WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    )
    .all(entityType, oldRef.name, oldRef.qualifier ?? '') as { arc_id: number }[];
  if (rows.length === 0) return;

  const tx = db.transaction(() => {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO story_arc_entities (arc_id, entity_type, entity_name, entity_qualifier) VALUES (?, ?, ?, ?)'
    );
    for (const { arc_id } of rows) {
      insert.run(arc_id, newEntityType, newRef.name, newRef.qualifier ?? '');
    }
    db.prepare(
      'DELETE FROM story_arc_entities WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    ).run(entityType, oldRef.name, oldRef.qualifier ?? '');
  });
  tx();
}

/** Removes every link of an entity name within one type (blacklist path). */
export function deleteStoryArcEntitiesByName(entityType: EntityType, name: string): void {
  db.prepare(
    'DELETE FROM story_arc_entities WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE'
  ).run(entityType, name.trim());
}
