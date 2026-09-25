import { describe, expect, it } from 'vitest';
import type { EntityMapping } from '../../shared/types';
import { filterEntityMappings } from './useGlobalSearch';

function mapping(partial: Partial<EntityMapping> & Pick<EntityMapping, 'label'>): EntityMapping {
  return {
    type: 'persons',
    canonical: partial.label,
    qualifier: '',
    aliases: [],
    miniSummary: null,
    ...partial,
  };
}

const mappings: EntityMapping[] = [
  mapping({ label: 'Zorak', aliases: ['Zoraks Alias'], miniSummary: 'Ein Ort' }),
  mapping({ label: 'Ärger', aliases: [], miniSummary: null }),
  mapping({ label: 'Affe', aliases: ['Affenname'], miniSummary: null }),
  mapping({ label: 'Ziel', aliases: [], miniSummary: 'Ärger im Text' }),
];

describe('filterEntityMappings', () => {
  it('ranks name prefixes above aliases and summaries', () => {
    const hits = filterEntityMappings(mappings, 'ärg', 10, 'de-DE');

    expect(hits.map((hit) => hit.label)).toEqual(['Ärger', 'Ziel']);
    expect(hits.map((hit) => hit.matchOn)).toEqual(['name', 'summary']);
  });

  it('matches aliases case-insensitively and applies the result cap', () => {
    const hits = filterEntityMappings(mappings, 'AFFEN', 1, 'en-US');

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ label: 'Affe', matchOn: 'alias' });
  });

  it('does not search queries shorter than two characters', () => {
    expect(filterEntityMappings(mappings, 'a')).toEqual([]);
  });
});
