import type { EntityKnowledgeEntry, EntityType, KnowledgeOriginType } from '../../shared/types.js';
import { db } from '../database.js';
import { sanitizePlainText } from '../utils/sanitizeHtml.js';
import { markEntitySummaryDirty, renameEntitySummary } from './entitySummaries.js';
import { getCurrentGameDay } from './gameTimeline.js';

// Origin titles are resolved live so renamed diary entries / sessions stay current.
const selectColumns = `
  k.id,
  k.entity_type AS entityType,
  k.entity_name AS entityName,
  k.entity_qualifier AS entityQualifier,
  k.title,
  k.content,
  k.source,
  k.status,
  k.status_reason AS statusReason,
  k.origin_type AS originType,
  k.origin_id AS originId,
  CASE k.origin_type
    WHEN 'diary' THEN d.title
    WHEN 'session' THEN s.name
  END AS originTitle,
  k.valid_from AS validFrom,
  k.valid_until AS validUntil,
  k.created_at AS createdAt,
  k.updated_at AS updatedAt`;

const selectFrom = `
  FROM entity_knowledge_entries k
  LEFT JOIN diary_entries d ON k.origin_type = 'diary' AND d.id = k.origin_id
  LEFT JOIN recording_sessions s ON k.origin_type = 'session' AND s.id = k.origin_id`;

export function listAllKnowledge(): EntityKnowledgeEntry[] {
  const rows = db
    .prepare(`SELECT ${selectColumns} ${selectFrom} ORDER BY k.id`)
    .all() as EntityKnowledgeEntry[];
  return rows;
}

export function listEntityKnowledge(
  entityType: EntityType,
  entityName: string,
  entityQualifier = ''
): EntityKnowledgeEntry[] {
  const rows = db
    .prepare(
      `SELECT ${selectColumns}
       ${selectFrom}
       WHERE k.entity_type = ? AND k.entity_name = ? COLLATE NOCASE AND k.entity_qualifier = ?
       ORDER BY k.created_at DESC`
    )
    .all(entityType, entityName, entityQualifier) as EntityKnowledgeEntry[];
  return rows;
}

export function listActiveEntityKnowledge(
  entityType: EntityType,
  entityName: string,
  entityQualifier = '',
  asOfGameDay?: number | null
): EntityKnowledgeEntry[] {
  // Filter against the known in-game timeline: a fact is "current" when its
  // validity window covers the reference day. valid_from is inclusive (the
  // fact starts being true on that day); valid_until is EXCLUSIVE (the first
  // day the fact no longer holds). This keeps a transition day disjoint: an
  // old fact ending at day X and a replacement starting at day X never overlap.
  // With no game_day known at all every active entry is considered current
  // (legacy behaviour).
  const asOf = asOfGameDay !== undefined ? asOfGameDay : getCurrentGameDay();
  let sql = `SELECT ${selectColumns}
     ${selectFrom}
     WHERE k.entity_type = ? AND k.entity_name = ? COLLATE NOCASE AND k.entity_qualifier = ? AND k.status = 'active'`;
  const params: unknown[] = [entityType, entityName, entityQualifier];
  if (asOf !== null && asOf !== undefined && Number.isFinite(asOf)) {
    sql +=
      ' AND (k.valid_from IS NULL OR k.valid_from <= ?) AND (k.valid_until IS NULL OR k.valid_until > ?)';
    params.push(asOf, asOf);
  }
  sql += ' ORDER BY k.created_at DESC';
  const rows = db.prepare(sql).all(...params) as EntityKnowledgeEntry[];
  return rows;
}

export function getEntityKnowledgeEntry(id: number): EntityKnowledgeEntry | null {
  const row = db
    .prepare(
      `SELECT ${selectColumns}
       ${selectFrom}
       WHERE k.id = ?`
    )
    .get(id) as EntityKnowledgeEntry | undefined;
  return row ?? null;
}

export function createEntityKnowledge(
  entityType: EntityType,
  entityName: string,
  title: string | null,
  content: string,
  source = 'manual',
  entityQualifier = '',
  validFrom: number | null = null,
  validUntil: number | null = null
): EntityKnowledgeEntry {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO entity_knowledge_entries (entity_type, entity_name, entity_qualifier, title, content, source, status, status_reason, valid_from, valid_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entityType,
      entityName,
      entityQualifier,
      title ? sanitizePlainText(title) : null,
      sanitizePlainText(content),
      source,
      'active',
      null,
      validFrom !== null && Number.isFinite(validFrom) ? validFrom : null,
      validUntil !== null && Number.isFinite(validUntil) ? validUntil : null,
      now,
      now
    );
  const entry = getEntityKnowledgeEntry(Number(result.lastInsertRowid))!;
  markEntitySummaryDirty(entityType, entityName, entityQualifier);
  return entry;
}

/**
 * Stamps knowledge entries with the text they were extracted from.
 * Used after AI distribution to record display-only provenance.
 */
export function setEntityKnowledgeOrigin(
  ids: number[],
  originType: KnowledgeOriginType,
  originId: number
): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(
    `UPDATE entity_knowledge_entries
     SET origin_type = ?, origin_id = ?
     WHERE id IN (${placeholders})`
  ).run(originType, originId, ...ids);
}

export function updateEntityKnowledge(
  id: number,
  updates: {
    title?: string | null;
    content?: string;
    validFrom?: number | null;
    validUntil?: number | null;
  }
): EntityKnowledgeEntry | null {
  const existing = getEntityKnowledgeEntry(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title ? sanitizePlainText(updates.title) : null);
  }
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(sanitizePlainText(updates.content));
  }
  if (updates.validFrom !== undefined) {
    fields.push('valid_from = ?');
    values.push(
      updates.validFrom !== null && Number.isFinite(updates.validFrom) ? updates.validFrom : null
    );
  }
  if (updates.validUntil !== undefined) {
    fields.push('valid_until = ?');
    values.push(
      updates.validUntil !== null && Number.isFinite(updates.validUntil) ? updates.validUntil : null
    );
  }
  if (fields.length === 0) return existing;

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE entity_knowledge_entries SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values
  );
  const entry = getEntityKnowledgeEntry(id);
  if (entry) {
    markEntitySummaryDirty(entry.entityType, entry.entityName, entry.entityQualifier ?? '');
  }
  return entry;
}

export function markEntityKnowledgeDeleted(
  id: number,
  reason: string | null = null
): EntityKnowledgeEntry | null {
  const existing = getEntityKnowledgeEntry(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE entity_knowledge_entries SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?'
  ).run('deleted', reason ? reason.trim() : null, now, id);
  const entry = getEntityKnowledgeEntry(id);
  if (entry) {
    markEntitySummaryDirty(entry.entityType, entry.entityName, entry.entityQualifier ?? '');
  }
  return entry;
}

/**
 * Marks an active fact as having changed over time: from the given in-game day
 * it no longer holds (the passed day is EXCLUSIVE - the fact stays valid up to
 * validUntil - 1), but it stays active (historically true) so the timeline
 * keeps it visible. A replacement fact may start at the same day without
 * overlapping. This replaces the "delete old + create new" pattern for
 * sequenced facts.
 */
export function markEntityKnowledgeTimelineEnd(
  id: number,
  validUntil: number,
  reason: string | null = null
): EntityKnowledgeEntry | null {
  const existing = getEntityKnowledgeEntry(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE entity_knowledge_entries SET valid_until = ?, status_reason = ?, updated_at = ? WHERE id = ?'
  ).run(validUntil, reason ? reason.trim() : null, now, id);
  const entry = getEntityKnowledgeEntry(id);
  if (entry) {
    markEntitySummaryDirty(entry.entityType, entry.entityName, entry.entityQualifier ?? '');
  }
  return entry;
}

export function renameEntityKnowledge(
  entityType: EntityType,
  oldName: string,
  newName: string,
  oldQualifier = '',
  newQualifier = ''
): void {
  db.prepare(
    'UPDATE entity_knowledge_entries SET entity_name = ?, entity_qualifier = ? WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
  ).run(newName, newQualifier, entityType, oldName, oldQualifier);
  renameEntitySummary(entityType, oldName, newName, oldQualifier, newQualifier);
}

export function mergeEntityKnowledge(
  sourceType: EntityType,
  sourceName: string,
  targetType: EntityType,
  targetName: string,
  sourceQualifier = '',
  targetQualifier = ''
): void {
  db.prepare(
    'UPDATE entity_knowledge_entries SET entity_type = ?, entity_name = ?, entity_qualifier = ? WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
  ).run(targetType, targetName, targetQualifier, sourceType, sourceName, sourceQualifier);
}
