import type { BingoSuggestion } from '../../shared/types.js';
import { db } from '../database.js';

export interface CreateBingoSuggestionInput {
  text: string;
  source: string;
}

export function getPendingSuggestions(limit = 20): BingoSuggestion[] {
  const rows = db
    .prepare(
      `SELECT id, text, source, created_at AS createdAt
       FROM bingo_suggestions
       WHERE accepted_at IS NULL AND rejected_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as BingoSuggestion[];
  return rows;
}

export function countPendingSuggestions(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM bingo_suggestions
       WHERE accepted_at IS NULL AND rejected_at IS NULL`,
    )
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getAllPendingSuggestionTexts(): string[] {
  const rows = db
    .prepare(
      `SELECT text
       FROM bingo_suggestions
       WHERE accepted_at IS NULL AND rejected_at IS NULL`,
    )
    .all() as { text: string }[];
  return rows.map((row) => row.text);
}

export function getRejectedSuggestionTexts(): string[] {
  const rows = db
    .prepare(
      `SELECT text
       FROM bingo_suggestions
       WHERE rejected_at IS NOT NULL`,
    )
    .all() as { text: string }[];
  return rows.map((row) => row.text);
}

export function getSuggestionById(id: number): BingoSuggestion | null {
  const row = db
    .prepare(
      `SELECT id, text, source, created_at AS createdAt
       FROM bingo_suggestions
       WHERE id = ? AND accepted_at IS NULL AND rejected_at IS NULL`,
    )
    .get(id) as BingoSuggestion | undefined;
  return row ?? null;
}

export function createBingoSuggestions(suggestions: CreateBingoSuggestionInput[]): number[] {
  if (suggestions.length === 0) return [];

  const insert = db.prepare(
    `INSERT INTO bingo_suggestions (text, source, created_at)
     VALUES (?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const ids: number[] = [];

  const tx = db.transaction((items: CreateBingoSuggestionInput[]) => {
    for (const item of items) {
      const result = insert.run(item.text.trim(), item.source, now);
      ids.push(Number(result.lastInsertRowid));
    }
  });

  tx(suggestions);
  return ids;
}

export function markSuggestionAccepted(id: number): void {
  db.prepare(
    `UPDATE bingo_suggestions
     SET accepted_at = ?
     WHERE id = ? AND accepted_at IS NULL AND rejected_at IS NULL`,
  ).run(new Date().toISOString(), id);
}

export function markSuggestionRejected(id: number): void {
  db.prepare(
    `UPDATE bingo_suggestions
     SET rejected_at = ?
     WHERE id = ? AND accepted_at IS NULL AND rejected_at IS NULL`,
  ).run(new Date().toISOString(), id);
}

export function rejectAllPendingSuggestions(): void {
  db.prepare(
    `UPDATE bingo_suggestions
     SET rejected_at = ?
     WHERE accepted_at IS NULL AND rejected_at IS NULL`,
  ).run(new Date().toISOString());
}
