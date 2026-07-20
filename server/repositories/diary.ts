import type { DiaryEntry } from '../../shared/types.js';
import { db } from '../database.js';

function rowToDiaryEntry(row: Record<string, unknown>, persons: string[]): DiaryEntry {
  return {
    id: row.id as number,
    userId: row.user_id as string,
    title: row.title as string,
    content: row.content as string,
    summary: (row.summary as string | null | undefined) ?? null,
    rewrittenContent: (row.rewritten_content as string | null | undefined) ?? null,
    persons,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function getPersonsByEntryId(entryId: number): string[] {
  const rows = db
    .prepare(
      `SELECT p.name
       FROM persons p
       JOIN diary_entry_persons dep ON dep.person_id = p.id
       WHERE dep.diary_entry_id = ?
       ORDER BY p.name`,
    )
    .all(entryId) as { name: string }[];
  return rows.map((r) => r.name);
}

function buildEntryPersonsMap(entryIds: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (entryIds.length === 0) return map;

  const rows = db
    .prepare(
      `SELECT dep.diary_entry_id AS entry_id, p.name
       FROM persons p
       JOIN diary_entry_persons dep ON dep.person_id = p.id
       WHERE dep.diary_entry_id IN (${entryIds.map(() => '?').join(',')})
       ORDER BY p.name`,
    )
    .all(...entryIds) as { entry_id: number; name: string }[];

  for (const { entry_id, name } of rows) {
    if (!map.has(entry_id)) {
      map.set(entry_id, []);
    }
    map.get(entry_id)!.push(name);
  }

  return map;
}

export function setDiaryEntryPersons(entryId: number, persons: string[]): void {
  const normalized = [...new Set(persons.map((p) => p.trim()).filter((p) => p.length > 0))];

  const deleteExisting = db.prepare('DELETE FROM diary_entry_persons WHERE diary_entry_id = ?');
  deleteExisting.run(entryId);

  if (normalized.length === 0) return;

  const insertPerson = db.prepare('INSERT OR IGNORE INTO persons (name) VALUES (?)');
  const getPerson = db.prepare('SELECT id FROM persons WHERE name = ?');
  const linkPerson = db.prepare(
    'INSERT INTO diary_entry_persons (diary_entry_id, person_id) VALUES (?, ?)',
  );

  const tx = db.transaction((entryId: number, names: string[]) => {
    for (const name of names) {
      insertPerson.run(name);
      const person = getPerson.get(name) as { id: number } | undefined;
      if (!person) continue;
      linkPerson.run(entryId, person.id);
    }
  });

  tx(entryId, normalized);
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
  return rowToDiaryEntry(row, getPersonsByEntryId(id));
}

export function listDiaryEntriesByUser(userId: string): DiaryEntry[] {
  const rows = db
    .prepare('SELECT * FROM diary_entries WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Record<string, unknown>[];
  const entryIds = rows.map((row) => row.id as number);
  const personsMap = buildEntryPersonsMap(entryIds);
  return rows.map((row) => rowToDiaryEntry(row, personsMap.get(row.id as number) || []));
}

export function updateDiaryEntry(
  id: number,
  updates: Partial<
    Pick<DiaryEntry, 'title' | 'content' | 'summary' | 'rewrittenContent' | 'persons'>
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
  if (fields.length === 0 && !hasPersonsUpdate) return existing;

  if (hasPersonsUpdate) {
    setDiaryEntryPersons(id, updates.persons || []);
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
