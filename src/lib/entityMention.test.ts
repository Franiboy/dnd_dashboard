import { describe, expect, it } from 'vitest';
import { detectMention, filterEntityMentions } from './entityMention';
import type { EntityMapping } from '../../shared/types';

function mapping(canonical: string, overrides: Partial<EntityMapping> = {}): EntityMapping {
  return {
    type: 'persons',
    canonical,
    qualifier: '',
    label: canonical,
    aliases: [],
    miniSummary: null,
    ...overrides,
  };
}

describe('detectMention', () => {
  it('returns null without @', () => {
    expect(detectMention('Hallo Welt')).toBeNull();
  });

  it('detects a lone @ for discovery', () => {
    expect(detectMention('Hallo @')).toEqual({ atIndex: 6, query: '' });
  });

  it('detects a query after @', () => {
    expect(detectMention('Hallo @Keri')).toEqual({ atIndex: 6, query: 'Keri' });
  });

  it('supports multi-word queries', () => {
    expect(detectMention('@Kerigan von')).toEqual({ atIndex: 0, query: 'Kerigan von' });
  });

  it('rejects emails (alphanumeric directly before @)', () => {
    expect(detectMention('mail@example')).toBeNull();
  });

  it('allows @ after opening brackets and quotes', () => {
    expect(detectMention('(@Keri')).toEqual({ atIndex: 1, query: 'Keri' });
    expect(detectMention('"@Keri')).toEqual({ atIndex: 1, query: 'Keri' });
  });

  it('returns null after terminating punctuation', () => {
    expect(detectMention('Hallo @Keri,')).toBeNull();
  });

  it('uses the last @ only', () => {
    expect(detectMention('@a @b')).toEqual({ atIndex: 3, query: 'b' });
  });
});

describe('filterEntityMentions', () => {
  const mappings: EntityMapping[] = [
    mapping('Kerigan', { qualifier: 'Norden', label: 'Kerigan (Norden)', aliases: ['Keri'] }),
    mapping('Kerigan', { qualifier: 'Sueden', label: 'Kerigan (Sueden)' }),
    mapping('Calzone', { type: 'locations', aliases: ['Cal'] }),
  ];

  it('ranks prefix hits before substring hits', () => {
    const result = filterEntityMentions(mappings, 'Keri');
    expect(result[0].canonical).toBe('Kerigan');
    expect(result.length).toBe(2);
  });

  it('matches aliases', () => {
    const result = filterEntityMentions(mappings, 'Cal');
    expect(result.map((r) => r.canonical)).toContain('Calzone');
  });

  it('keeps homonyms as separate suggestions', () => {
    const result = filterEntityMentions(mappings, 'Kerigan');
    expect(result.filter((r) => r.canonical === 'Kerigan').length).toBe(2);
  });

  it('returns everything capped by limit on empty query', () => {
    expect(filterEntityMentions(mappings, '').length).toBe(3);
    expect(filterEntityMentions(mappings, '', 2).length).toBe(2);
  });

  it('is case-insensitive', () => {
    expect(filterEntityMentions(mappings, 'kerigan').length).toBe(2);
  });
});
