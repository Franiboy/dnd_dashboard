import type { EntityKnowledgeEntry, EntityType, KnowledgeOriginType } from '../../shared/types.js';
import { db } from '../database.js';
import { sanitizePlainText } from '../utils/sanitizeHtml.js';
import { markEntitySummaryDirty, renameEntitySummary } from './entitySummaries.js';

// Origin titles are resolved live so renamed diary entries / sessions stay current.
const selectColumns = `
  k.id,
  k.entity_type AS entityType,
  k.entity_name AS entityName,
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
  entityName: string
): EntityKnowledgeEntry[] {
  const rows = db
    .prepare(
      `SELECT ${selectColumns}
       ${selectFrom}
       WHERE k.entity_type = ? AND k.entity_name = ? COLLATE NOCASE
       ORDER BY k.created_at DESC`
    )
    .all(entityType, entityName) as EntityKnowledgeEntry[];
  return rows;
}

export function listActiveEntityKnowledge(
  entityType: EntityType,
  entityName: string
): EntityKnowledgeEntry[] {
  const rows = db
    .prepare(
      `SELECT ${selectColumns}
       ${selectFrom}
       WHERE k.entity_type = ? AND k.entity_name = ? COLLATE NOCASE AND k.status = 'active'
       ORDER BY k.created_at DESC`
    )
    .all(entityType, entityName) as EntityKnowledgeEntry[];
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
  source = 'manual'
): EntityKnowledgeEntry {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      'INSERT INTO entity_knowledge_entries (entity_type, entity_name, title, content, source, status, status_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      entityType,
      entityName,
      title ? sanitizePlainText(title) : null,
      sanitizePlainText(content),
      source,
      'active',
      null,
      now,
      now
    );
  const entry = getEntityKnowledgeEntry(Number(result.lastInsertRowid))!;
  markEntitySummaryDirty(entityType, entityName);
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
  updates: { title?: string | null; content?: string }
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
  if (fields.length === 0) return existing;

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`UPDATE entity_knowledge_entries SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values
  );
  const entry = getEntityKnowledgeEntry(id);
  if (entry) markEntitySummaryDirty(entry.entityType, entry.entityName);
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
  if (entry) markEntitySummaryDirty(entry.entityType, entry.entityName);
  return entry;
}

export function renameEntityKnowledge(
  entityType: EntityType,
  oldName: string,
  newName: string
): void {
  db.prepare(
    'UPDATE entity_knowledge_entries SET entity_name = ? WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE'
  ).run(newName, entityType, oldName);
  renameEntitySummary(entityType, oldName, newName);
}

export function mergeEntityKnowledge(
  sourceType: EntityType,
  sourceName: string,
  targetType: EntityType,
  targetName: string
): void {
  db.prepare(
    'UPDATE entity_knowledge_entries SET entity_type = ?, entity_name = ? WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE'
  ).run(targetType, targetName, sourceType, sourceName);
}
