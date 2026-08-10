import type { BingoGame } from '../../shared/types.js';
import { db } from '../database.js';

export function loadGame(): BingoGame | null {
  const row = db.prepare('SELECT data FROM games WHERE id = 1').get() as { data: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.data) as BingoGame;
  for (const player of parsed.players) {
    if (player.wins === undefined) player.wins = 0;
  }
  return parsed;
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
