import type { EntityType } from '../../shared/types.js';
import { db } from '../database.js';
import { sanitizePlainText } from '../utils/sanitizeHtml.js';

export interface EntitySummary {
  entityType: EntityType;
  entityName: string;
  /** Disambiguator of the entity; '' targets the plain name. */
  entityQualifier: string;
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
    entityQualifier: (row.entity_qualifier as string | undefined) ?? '',
    summary: (row.summary as string | null | undefined) ?? null,
    miniSummary: (row.mini_summary as string | null | undefined) ?? null,
    isDirty: Boolean(row.is_dirty),
    updatedAt: (row.updated_at as string | null | undefined) ?? null,
  };
}

export function getEntitySummary(
  entityType: EntityType,
  entityName: string,
  entityQualifier = ''
): EntitySummary | null {
  const row = db
    .prepare(
      `SELECT entity_type, entity_name, entity_qualifier, summary, mini_summary, is_dirty, updated_at
       FROM entity_summaries
       WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?`
    )
    .get(entityType, entityName, entityQualifier) as Record<string, unknown> | undefined;
  return rowToSummary(row);
}

export function setEntitySummary(
  entityType: EntityType,
  entityName: string,
  summary: string | null,
  isDirty = false,
  miniSummary?: string | null,
  entityQualifier = ''
): EntitySummary {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entity_summaries (entity_type, entity_name, entity_qualifier, summary, mini_summary, is_dirty, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_name, entity_qualifier) DO UPDATE SET
       summary = excluded.summary,
       mini_summary = COALESCE(excluded.mini_summary, mini_summary),
       is_dirty = excluded.is_dirty,
       updated_at = excluded.updated_at`
  ).run(
    entityType,
    entityName,
    entityQualifier,
    summary ? sanitizePlainText(summary) : null,
    miniSummary !== undefined ? (miniSummary ? sanitizePlainText(miniSummary) : null) : null,
    isDirty ? 1 : 0,
    now
  );
  return getEntitySummary(entityType, entityName, entityQualifier)!;
}

export function setEntityMiniSummary(
  entityType: EntityType,
  entityName: string,
  miniSummary: string | null,
  entityQualifier = ''
): EntitySummary {
  const existing = getEntitySummary(entityType, entityName, entityQualifier);
  return setEntitySummary(
    entityType,
    entityName,
    existing?.summary ?? null,
    existing?.isDirty ?? false,
    miniSummary,
    entityQualifier
  );
}

export function markEntitySummaryDirty(
  entityType: EntityType,
  entityName: string,
  entityQualifier = ''
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO entity_summaries (entity_type, entity_name, entity_qualifier, summary, mini_summary, is_dirty, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 1, ?)
     ON CONFLICT(entity_type, entity_name, entity_qualifier) DO UPDATE SET
       is_dirty = 1,
       updated_at = excluded.updated_at`
  ).run(entityType, entityName, entityQualifier, now);
}

export function clearEntitySummaryDirty(
  entityType: EntityType,
  entityName: string,
  entityQualifier = ''
): void {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE entity_summaries SET is_dirty = 0, updated_at = ? WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
  ).run(now, entityType, entityName, entityQualifier);
}

export function renameEntitySummary(
  entityType: EntityType,
  oldName: string,
  newName: string,
  oldQualifier = '',
  newQualifier = ''
): void {
  const existing = getEntitySummary(entityType, oldName, oldQualifier);
  if (!existing) return;

  db.transaction(() => {
    db.prepare(
      'DELETE FROM entity_summaries WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    ).run(entityType, newName, newQualifier);
    db.prepare(
      'UPDATE entity_summaries SET entity_name = ?, entity_qualifier = ?, is_dirty = 1 WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    ).run(newName, newQualifier, entityType, oldName, oldQualifier);
  })();
}

export function mergeEntitySummary(
  sourceType: EntityType,
  sourceName: string,
  targetType: EntityType,
  targetName: string,
  sourceQualifier = '',
  targetQualifier = ''
): void {
  const source = getEntitySummary(sourceType, sourceName, sourceQualifier);
  if (!source) {
    markEntitySummaryDirty(targetType, targetName, targetQualifier);
    return;
  }

  const target = getEntitySummary(targetType, targetName, targetQualifier);
  if (!target) {
    db.prepare(
      'UPDATE entity_summaries SET entity_type = ?, entity_name = ?, entity_qualifier = ?, is_dirty = 1 WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    ).run(targetType, targetName, targetQualifier, sourceType, sourceName, sourceQualifier);
    return;
  }

  const mergedMini = target.miniSummary ?? source.miniSummary ?? null;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      'UPDATE entity_summaries SET mini_summary = ?, is_dirty = 1, updated_at = ? WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    ).run(mergedMini, now, targetType, targetName, targetQualifier);
    db.prepare(
      'DELETE FROM entity_summaries WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    ).run(sourceType, sourceName, sourceQualifier);
  })();
}

export function listDirtyEntitySummaries(): EntitySummary[] {
  const rows = db
    .prepare(
      `SELECT entity_type, entity_name, entity_qualifier, summary, mini_summary, is_dirty, updated_at
       FROM entity_summaries WHERE is_dirty = 1`
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToSummary).filter((s): s is EntitySummary => s !== null);
}
