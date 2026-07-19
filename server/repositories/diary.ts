import type { DiaryEntry } from '../../shared/types.js';
import { db } from '../database.js';

function rowToDiaryEntry(row: Record<string, unknown>): DiaryEntry {
  return {
    id: row.id as number,
    userId: row.user_id as string,
    title: row.title as string,
    content: row.content as string,
    summary: (row.summary as string | null | undefined) ?? null,
    rewrittenContent: (row.rewritten_content as string | null | undefined) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
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
  return rowToDiaryEntry(row);
}

export function listDiaryEntriesByUser(userId: string): DiaryEntry[] {
  const rows = db
    .prepare(
      'SELECT * FROM diary_entries WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToDiaryEntry);
}

export function updateDiaryEntry(
  id: number,
  updates: Partial<Pick<DiaryEntry, 'title' | 'content' | 'summary' | 'rewrittenContent'>>,
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

  if (fields.length === 0) return existing;

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
