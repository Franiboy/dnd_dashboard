import type { FeatureRequest } from '../../shared/types.js';
import { db } from '../database.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS feature_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requestedBy TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    branch TEXT,
    worktreePath TEXT,
    previewPort INTEGER,
    previewUrl TEXT,
    previewPid INTEGER,
    sessionTitle TEXT,
    sessionId TEXT,
    logs TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

function rowToFeatureRequest(row: Record<string, unknown>): FeatureRequest {
  return {
    id: row.id as number,
    requestedBy: row.requestedBy as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as FeatureRequest['status'],
    branch: row.branch as string | null,
    worktreePath: row.worktreePath as string | null,
    previewPort: row.previewPort as number | null,
    previewUrl: row.previewUrl as string | null,
    previewPid: row.previewPid as number | null,
    sessionTitle: row.sessionTitle as string | null,
    sessionId: row.sessionId as string | null,
    logs: row.logs as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export function createFeatureRequest(
  requestedBy: string,
  title: string,
  description: string,
): FeatureRequest {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO feature_requests (requestedBy, title, description, status, logs, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(requestedBy, title, description, 'pending', '', now, now);
  return getFeatureRequestById(Number(result.lastInsertRowid))!;
}

export function getFeatureRequestById(id: number): FeatureRequest | null {
  const row = db
    .prepare('SELECT * FROM feature_requests WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToFeatureRequest(row);
}

export function listFeatureRequests(): FeatureRequest[] {
  const rows = db
    .prepare('SELECT * FROM feature_requests ORDER BY createdAt DESC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToFeatureRequest);
}

export function updateFeatureRequest(
  id: number,
  updates: Partial<FeatureRequest>,
): FeatureRequest | null {
  const existing = getFeatureRequestById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'createdAt') continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  fields.push('updatedAt = ?');
  values.push(now);
  values.push(id);
  db.prepare(`UPDATE feature_requests SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getFeatureRequestById(id);
}

export function appendFeatureRequestLogs(id: number, log: string): void {
  const existing = getFeatureRequestById(id);
  if (!existing) return;
  const updated = existing.logs + log;
  db.prepare('UPDATE feature_requests SET logs = ?, updatedAt = ? WHERE id = ?').run(
    updated,
    new Date().toISOString(),
    id,
  );
}
