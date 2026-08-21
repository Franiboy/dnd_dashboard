import { db } from '../database.js';

export interface BingoSuggestionSearchResult {
  id: number;
  text: string;
  source: string;
}

/**
 * Free-text search over the bingo suggestion pool for the admin panel.
 * Performs a case-insensitive substring match on the suggestion text.
 *
 * Note: SQLite LIKE is case-insensitive for ASCII characters by default,
 * which matches the existing behaviour of the suggestion filter UI.
 */
export function searchBingoSuggestions(term: string): BingoSuggestionSearchResult[] {
  const rows = db
    .prepare(
      `SELECT id, text, source
			 FROM bingo_suggestions
			 WHERE text LIKE '%' || ? || '%'
			 ORDER BY text`
    )
    .all(term) as BingoSuggestionSearchResult[];
  return rows;
}
