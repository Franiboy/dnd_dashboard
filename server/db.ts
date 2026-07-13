import Database from 'better-sqlite3';
import type { BingoGame } from '../shared/types.ts';

const db = new Database('dnd.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

export function loadGame(): BingoGame | null {
  const row = db.prepare('SELECT data FROM games WHERE id = 1').get() as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data);
}

export function saveGame(game: BingoGame): void {
  const data = JSON.stringify(game);
  const existing = db.prepare('SELECT 1 FROM games WHERE id = 1').get();
  if (existing) {
    db.prepare('UPDATE games SET data = ? WHERE id = 1').run(data);
  } else {
    db.prepare('INSERT INTO games (id, data) VALUES (1, ?)').run(data);
  }
}
