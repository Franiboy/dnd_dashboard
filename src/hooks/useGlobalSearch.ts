import { useEffect, useMemo, useState } from 'react';
import { useApi } from './useApi';
import { useEntityMappings } from './useEntityMappings';
import type { EntityMapping, SearchResponse, SearchResult } from '../../shared/types';

/** A world entity found directly in the client-side mapping cache. */
export interface EntitySearchHit {
  source: 'entity';
  type: EntityMapping['type'];
  name: string;
  qualifier: string;
  label: string;
  /** Why this entity matched; shown as a hint in the result list. */
  matchOn: 'name' | 'alias' | 'summary';
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;
const ENTITY_HIT_CAP = 8;

/**
 * Client-side entity pre-search over the mapping cache that is already loaded
 * app-wide (MappingsProvider): name / qualifier label, aliases and mini
 * summaries. Prefix matches rank above substring matches above summary
 * matches, so the best hits come first even before the server responds.
 */
export function filterEntityMappings(
  mappings: EntityMapping[],
  query: string,
  cap = ENTITY_HIT_CAP
): EntitySearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const hits: Array<EntitySearchHit & { score: number }> = [];
  for (const mapping of mappings) {
    const label = mapping.label.toLowerCase();
    let score = -1;
    let matchOn: EntitySearchHit['matchOn'] = 'summary';
    if (label.startsWith(q)) {
      score = 3;
      matchOn = 'name';
    } else if (label.includes(q)) {
      score = 2;
      matchOn = 'name';
    } else {
      const prefixAlias = mapping.aliases.some((a) => a.toLowerCase().startsWith(q));
      const alias = prefixAlias || mapping.aliases.some((a) => a.toLowerCase().includes(q));
      if (alias) {
        score = prefixAlias ? 2 : 1;
        matchOn = 'alias';
      } else if (mapping.miniSummary && mapping.miniSummary.toLowerCase().includes(q)) {
        score = 0;
        matchOn = 'summary';
      }
    }
    if (score >= 0) {
      hits.push({
        source: 'entity',
        type: mapping.type,
        name: mapping.canonical,
        qualifier: mapping.qualifier,
        label: mapping.label,
        matchOn,
        score,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'de'));
  return hits.slice(0, cap).map(({ score: _score, ...hit }) => hit);
}

/**
 * Global search data layer: debounced server full-text search plus instant
 * client-side entity matches. Server requests are aborted when the query
 * changes, so only the latest result lands in state.
 *
 * The stored server state remembers the query it belongs to; results and the
 * loading flag are derived from that pairing during render (no setState in
 * effects): loading is true exactly while the current query has no answer yet.
 */
export function useGlobalSearch(query: string, enabled: boolean) {
  const { request } = useApi();
  const { mappings } = useEntityMappings();
  const [serverState, setServerState] = useState<{ query: string; results: SearchResult[] }>({
    query: '',
    results: [],
  });

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      // Errors are silent here (notify=false): a failed palette search must
      // not toast over the page the user is on; stale requests are aborted.
      const { data } = await request<SearchResponse>(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
        false
      );
      if (controller.signal.aborted) return;
      setServerState({ query: trimmed, results: data?.results ?? [] });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, enabled, request]);

  const trimmed = query.trim();
  const isCurrent = enabled && trimmed.length >= MIN_QUERY_LENGTH && serverState.query === trimmed;
  const results = isCurrent ? serverState.results : [];
  const loading = enabled && trimmed.length >= MIN_QUERY_LENGTH && !isCurrent;

  const entityHits = useMemo(() => filterEntityMappings(mappings, query), [mappings, query]);

  return { entityHits, results, loading };
}
