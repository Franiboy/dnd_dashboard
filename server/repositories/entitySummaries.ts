import type { EntityType } from '../../shared/types.js';
import { db } from '../database.js';

export interface EntitySummary {
  entityType: EntityType;
  entityName: string;
  summary: string | null;
  miniSummary: string | null;
  isDirty: boolean;
  updatedAt: string | null;
}

function rowToSummary(row: Record<string, unknown> | undefined): EntitySummary | null {
  if (!row) return null;
  return {
    entityType: row.entity_type as EntityType,
    entityName: row.entity_name as string,
    summary: (row.summary as string | null | undefined) ?? null,
    miniSummary: (row.mini_summary as string | null | undefined) ?? null,
    isDirty: Boolean(row.is_dirty),
    updatedAt: (row.updated_at as string | null | undefined) ?? null,
  };
}

export function getEntitySummary(
  entityType: EntityType,
  entityName: string,
): EntitySummary | null {
  const row = db
    .prepare(
      'SELECT entity_type, entity_name, summary, mini_summary, is_dirty, updated_at FROM entity_summaries WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE',
    )
    .get(entityType, entityName) as Record<string, unknown> | undefined;
  return rowToSummary(row);
}

export function setEntitySummary(
  entityType: EntityType,
  entityName: string,
  summary: string | null,
  isDirty = false,
  miniSummary?: string | null,
): EntitySummary {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entity_summaries (entity_type, entity_name, summary, mini_summary, is_dirty, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_name) DO UPDATE SET
       summary = excluded.summary,
       mini_summary = COALESCE(excluded.mini_summary, mini_summary),
       is_dirty = excluded.is_dirty,
       updated_at = excluded.updated_at`,
  ).run(
    entityType,
    entityName,
    summary ? summary.trim() : null,
    miniSummary !== undefined ? (miniSummary ? miniSummary.trim() : null) : null,
    isDirty ? 1 : 0,
    now,
  );
  return getEntitySummary(entityType, entityName)!;
}

export function setEntityMiniSummary(
  entityType: EntityType,
  entityName: string,
  miniSummary: string | null,
): EntitySummary {
  const existing = getEntitySummary(entityType, entityName);
  return setEntitySummary(
    entityType,
    entityName,
    existing?.summary ?? null,
    existing?.isDirty ?? false,
    miniSummary,
  );
}

export function markEntitySummaryDirty(entityType: EntityType, entityName: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entity_summaries (entity_type, entity_name, summary, mini_summary, is_dirty, updated_at)
     VALUES (?, ?, NULL, NULL, 1, ?)
     ON CONFLICT(entity_type, entity_name) DO UPDATE SET
       is_dirty = 1,
       updated_at = excluded.updated_at`,
  ).run(entityType, entityName, now);
}

export function clearEntitySummaryDirty(entityType: EntityType, entityName: string): void {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE entity_summaries SET is_dirty = 0, updated_at = ? WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE',
  ).run(now, entityType, entityName);
}

export function renameEntitySummary(
  entityType: EntityType,
  oldName: string,
  newName: string,
): void {
  const existing = getEntitySummary(entityType, oldName);
  if (!existing) return;

  db.transaction(() => {
    db.prepare('DELETE FROM entity_summaries WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE').run(
      entityType,
      newName,
    );
    db.prepare(
      'UPDATE entity_summaries SET entity_name = ?, is_dirty = 1 WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE',
    ).run(newName, entityType, oldName);
  })();
}

export function listDirtyEntitySummaries(): EntitySummary[] {
  const rows = db
    .prepare(
      'SELECT entity_type, entity_name, summary, mini_summary, is_dirty, updated_at FROM entity_summaries WHERE is_dirty = 1',
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToSummary).filter((s): s is EntitySummary => s !== null);
}
