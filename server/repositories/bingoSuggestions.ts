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
       LIMIT ?`
    )
    .all(limit) as BingoSuggestion[];
  return rows;
}

export function countPendingSuggestions(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM bingo_suggestions
       WHERE accepted_at IS NULL AND rejected_at IS NULL`
    )
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getAllPendingSuggestionTexts(): string[] {
  const rows = db
    .prepare(
      `SELECT text
       FROM bingo_suggestions
       WHERE accepted_at IS NULL AND rejected_at IS NULL`
    )
    .all() as { text: string }[];
  return rows.map((row) => row.text);
}

export function getRejectedSuggestionTexts(): string[] {
  const rows = db
    .prepare(
      `SELECT text
       FROM bingo_suggestions
       WHERE rejected_at IS NOT NULL`
    )
    .all() as { text: string }[];
  return rows.map((row) => row.text);
}

export function getSuggestionById(id: number): BingoSuggestion | null {
  const row = db
    .prepare(
      `SELECT id, text, source, created_at AS createdAt
       FROM bingo_suggestions
       WHERE id = ? AND accepted_at IS NULL AND rejected_at IS NULL`
    )
    .get(id) as BingoSuggestion | undefined;
  return row ?? null;
}

export function createBingoSuggestions(suggestions: CreateBingoSuggestionInput[]): number[] {
  if (suggestions.length === 0) return [];

  const insert = db.prepare(
    `INSERT INTO bingo_suggestions (text, source, created_at)
     VALUES (?, ?, ?)`
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
     WHERE id = ? AND accepted_at IS NULL AND rejected_at IS NULL`
  ).run(new Date().toISOString(), id);
}

export function markSuggestionRejected(id: number): void {
  db.prepare(
    `UPDATE bingo_suggestions
     SET rejected_at = ?
     WHERE id = ? AND accepted_at IS NULL AND rejected_at IS NULL`
  ).run(new Date().toISOString(), id);
}

export function rejectAllPendingSuggestions(): void {
  db.prepare(
    `UPDATE bingo_suggestions
     SET rejected_at = ?
     WHERE accepted_at IS NULL AND rejected_at IS NULL`
  ).run(new Date().toISOString());
}

export interface BingoSuggestionBatch {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
}

export function createBingoSuggestionBatch(batchId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO bingo_suggestion_batches (id, status, created_at) VALUES (?, ?, ?)`
  ).run(batchId, 'pending', new Date().toISOString());
}

export function getBingoSuggestionBatch(batchId: string): BingoSuggestionBatch | null {
  const row = db
    .prepare(
      `SELECT id, status, created_at AS createdAt FROM bingo_suggestion_batches WHERE id = ?`
    )
    .get(batchId) as BingoSuggestionBatch | undefined;
  return row ?? null;
}

export function submitBingoSuggestionBatch(
  batchId: string,
  suggestions: CreateBingoSuggestionInput[]
): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE bingo_suggestion_batches SET status = 'completed' WHERE id = ?`).run(
      batchId
    );
    const insert = db.prepare(
      `INSERT INTO bingo_suggestion_batch_results (batch_id, text, source, created_at) VALUES (?, ?, ?, ?)`
    );
    for (const suggestion of suggestions) {
      insert.run(batchId, suggestion.text.trim(), suggestion.source, now);
    }
  })();
}

export function failBingoSuggestionBatch(batchId: string): void {
  db.prepare(`UPDATE bingo_suggestion_batches SET status = 'failed' WHERE id = ?`).run(batchId);
}

export function getBingoSuggestionBatchResults(batchId: string): CreateBingoSuggestionInput[] {
  const rows = db
    .prepare(
      `SELECT text, source FROM bingo_suggestion_batch_results WHERE batch_id = ? ORDER BY id ASC`
    )
    .all(batchId) as { text: string; source: string }[];
  return rows;
}
