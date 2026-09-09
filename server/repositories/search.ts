import { db } from '../database.js';
import type {
  DiarySearchHit,
  KnowledgeSearchHit,
  SearchResult,
  SessionSearchHit,
} from '../../shared/types.js';

/**
 * Translates a raw user query into a safe FTS5 MATCH expression.
 *
 * Every whitespace-separated token becomes a quoted prefix term ("tok"*), so
 * user input can never inject FTS5 query structure (AND/OR/NOT, column
 * filters, nested queries). Double quotes are dropped because they would
 * terminate the quoted term; diacritics are handled by the tokenizer.
 */
export function buildFtsQuery(query: string, maxTokens = 12): string {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => t.length > 0)
    .slice(0, maxTokens);
  return tokens.map((t) => `"${t}"*`).join(' ');
}

interface IndexRow {
  source_id: number;
  snippet: string;
}

/** Runs one ranked index query; match ranges are wrapped in \u0001 … \u0002. */
function searchIndex(match: string, where: string, params: (string | number)[], limit: number) {
  return db
    .prepare(
      `SELECT source_id,
              snippet(search_index, 1, char(1), char(2), '…', 24) AS snippet
       FROM search_index
       WHERE search_index MATCH ?${where}
       ORDER BY bm25(search_index)
       LIMIT ?`
    )
    .all(match, ...params, limit) as IndexRow[];
}

function hydrateDiary(rows: IndexRow[]): DiarySearchHit[] {
  const get = db.prepare(
    'SELECT title, created_at, game_day, arc_id FROM diary_entries WHERE id = ?'
  );
  const hits: DiarySearchHit[] = [];
  for (const row of rows) {
    const entry = get.get(row.source_id) as
      | { title: string; created_at: string; game_day: number | null; arc_id: number | null }
      | undefined;
    if (!entry) continue;
    hits.push({
      source: 'diary',
      id: row.source_id,
      title: entry.title,
      snippet: row.snippet,
      createdAt: entry.created_at,
      gameDay: entry.game_day,
      arcId: entry.arc_id,
    });
  }
  return hits;
}

/**
 * [MM:SS] or [HH:MM:SS] position of the first match inside a transcript, so
 * the client can scroll the transcript to the right spot.
 */
export function findTranscriptTime(transcript: string | null, query: string): string | null {
  if (!transcript) return null;
  const lower = transcript.toLowerCase();
  const tokens = query.split(/\s+/).filter((t) => t.length >= 3);
  let first = -1;
  for (const token of tokens) {
    const at = lower.indexOf(token.toLowerCase());
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  if (first === -1) return null;
  const before = transcript.slice(0, first);
  let last: string | null = null;
  for (const m of before.matchAll(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g)) {
    last = m[1];
  }
  return last;
}

function hydrateSessions(rows: IndexRow[], query: string): SessionSearchHit[] {
  const get = db.prepare(
    'SELECT name, started_at, game_day, arc_id, transcript FROM recording_sessions WHERE id = ?'
  );
  const hits: SessionSearchHit[] = [];
  for (const row of rows) {
    const session = get.get(row.source_id) as
      | {
          name: string;
          started_at: string;
          game_day: number | null;
          arc_id: number | null;
          transcript: string | null;
        }
      | undefined;
    if (!session) continue;
    hits.push({
      source: 'session',
      id: row.source_id,
      title: session.name,
      snippet: row.snippet,
      startedAt: session.started_at,
      gameDay: session.game_day,
      arcId: session.arc_id,
      transcriptTime: findTranscriptTime(session.transcript, query),
    });
  }
  return hits;
}

function hydrateKnowledge(rows: IndexRow[]): KnowledgeSearchHit[] {
  const get = db.prepare(
    `SELECT COALESCE(NULLIF(title, ''), entity_name) AS title, entity_type, entity_name,
            entity_qualifier, valid_from, valid_until
     FROM entity_knowledge_entries WHERE id = ?`
  );
  const hits: KnowledgeSearchHit[] = [];
  for (const row of rows) {
    const entry = get.get(row.source_id) as
      | {
          title: string;
          entity_type: KnowledgeSearchHit['entityType'];
          entity_name: string;
          entity_qualifier: string;
          valid_from: number | null;
          valid_until: number | null;
        }
      | undefined;
    if (!entry) continue;
    hits.push({
      source: 'knowledge',
      id: row.source_id,
      title: entry.title,
      snippet: row.snippet,
      entityType: entry.entity_type,
      entityName: entry.entity_name,
      entityQualifier: entry.entity_qualifier,
      validFrom: entry.valid_from,
      validUntil: entry.valid_until,
    });
  }
  return hits;
}

export interface GlobalSearchOptions {
  /** Acting user; diary hits are restricted to their own entries. */
  userId: string;
  /** Maximum hits per source (already capped by the route schema). */
  limitPerSource?: number;
}

/**
 * Ranked full-text search across diary entries, recording sessions and world
 * knowledge facts. Result groups keep a stable source order; within a group
 * hits are ordered by FTS5 bm25 relevance.
 */
export function globalSearch(query: string, options: GlobalSearchOptions): SearchResult[] {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const limit = Math.min(Math.max(options.limitPerSource ?? 8, 1), 20);

  // Diary is strictly private: the index row carries the author's user id.
  const diary = hydrateDiary(
    searchIndex(match, " AND source_type = 'diary' AND owner_user_id = ?", [options.userId], limit)
  );
  const sessions = hydrateSessions(
    searchIndex(match, " AND source_type = 'session'", [], limit),
    query
  );
  const knowledge = hydrateKnowledge(
    searchIndex(match, " AND source_type = 'knowledge'", [], limit)
  );

  return [...diary, ...sessions, ...knowledge];
}
