import type { EntityMapping, EntityType } from '../../shared/types';
import { formatEntityLabel } from './entityLabels';

export interface MentionQuery {
  /** Absolute index of the '@' inside the full editor text. */
  atIndex: number;
  /** Raw text after '@' up to the cursor (may contain spaces). */
  query: string;
  /** Absolute cursor index the query was detected for. */
  cursorIndex: number;
}

export interface MentionSuggestion {
  type: EntityType;
  canonical: string;
  qualifier: string;
  label: string;
  miniSummary: string | null;
  /** Canonical name or alias that matched the query (for ranking/debug). */
  matchedVia: string;
}

export const MENTION_MAX_QUERY_LENGTH = 40;

const QUERY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _\-'().]{0,39}$/u;

/**
 * Detects an active "@mention" directly before the cursor.
 *
 * @param textBeforeCursor Plain editor text from index 0 up to the cursor.
 * @returns The mention range, or null when no "@query" is active. A lone "@"
 *   returns an empty query so the UI can offer discovery. When nothing is
 *   accepted the "@" simply stays as typed plain text.
 */
export function detectMention(textBeforeCursor: string): Omit<MentionQuery, 'cursorIndex'> | null {
  const atPos = textBeforeCursor.lastIndexOf('@');
  if (atPos === -1) return null;

  const prev = atPos === 0 ? '' : textBeforeCursor[atPos - 1];
  if (prev !== '' && !/[\s([>"'‘“]/.test(prev)) return null;

  const query = textBeforeCursor.slice(atPos + 1);
  if (query === '') return { atIndex: atPos, query: '' };
  if (query.length > MENTION_MAX_QUERY_LENGTH) return null;
  if (query.includes('\n') || query.includes('@')) return null;
  if (!QUERY_PATTERN.test(query)) return null;
  return { atIndex: atPos, query };
}

/**
 * Client-side filter over the known entity mappings. Matches against the
 * canonical name and all aliases, case-insensitive. Prefix hits rank before
 * substring hits so typing "@Keri" surfaces "Kerigan" first.
 */
export function filterEntityMentions(
  mappings: EntityMapping[],
  query: string,
  limit = 8
): MentionSuggestion[] {
  const normalized = query.trim().toLowerCase();
  const ranked: Array<{ suggestion: MentionSuggestion; rank: number }> = [];

  for (const mapping of mappings) {
    if (!mapping.canonical) continue;
    const canonicalLower = mapping.canonical.toLowerCase();
    let rank = -1;
    let matchedVia = mapping.canonical;

    if (normalized === '') {
      rank = 4;
    } else if (canonicalLower.startsWith(normalized)) {
      rank = 0;
    } else if (canonicalLower.includes(normalized)) {
      rank = 2;
    } else {
      for (const alias of mapping.aliases ?? []) {
        const aliasLower = alias.toLowerCase();
        if (aliasLower.startsWith(normalized)) {
          rank = 1;
          matchedVia = alias;
          break;
        }
        if (aliasLower.includes(normalized)) {
          rank = 3;
          matchedVia = alias;
          break;
        }
      }
      if (rank === -1) continue;
    }

    ranked.push({
      rank,
      suggestion: {
        type: mapping.type,
        canonical: mapping.canonical,
        qualifier: mapping.qualifier ?? '',
        label: formatEntityLabel(mapping.canonical, mapping.qualifier),
        miniSummary: mapping.miniSummary ?? null,
        matchedVia,
      },
    });
  }

  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.suggestion.canonical.length - b.suggestion.canonical.length ||
      a.suggestion.canonical.localeCompare(b.suggestion.canonical, 'de')
  );

  const seen = new Set<string>();
  const result: MentionSuggestion[] = [];
  for (const { suggestion } of ranked) {
    const key = `${suggestion.type}|${suggestion.canonical}|${suggestion.qualifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(suggestion);
    if (result.length >= limit) break;
  }
  return result;
}
