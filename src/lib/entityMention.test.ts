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
    expect(detectMention('Hallo @Halv')).toEqual({ atIndex: 6, query: 'Halv' });
  });

  it('supports multi-word queries', () => {
    expect(detectMention('@Halvard von')).toEqual({ atIndex: 0, query: 'Halvard von' });
  });

  it('rejects emails (alphanumeric directly before @)', () => {
    expect(detectMention('mail@example')).toBeNull();
  });

  it('allows @ after opening brackets and quotes', () => {
    expect(detectMention('(@Halv')).toEqual({ atIndex: 1, query: 'Halv' });
    expect(detectMention('"@Halv')).toEqual({ atIndex: 1, query: 'Halv' });
  });

  it('returns null after terminating punctuation', () => {
    expect(detectMention('Hallo @Halv,')).toBeNull();
  });

  it('uses the last @ only', () => {
    expect(detectMention('@a @b')).toEqual({ atIndex: 3, query: 'b' });
  });
});

describe('filterEntityMentions', () => {
  const mappings: EntityMapping[] = [
    mapping('Halvard', { qualifier: 'Norden', label: 'Halvard (Norden)', aliases: ['Halv'] }),
    mapping('Halvard', { qualifier: 'Sueden', label: 'Halvard (Sueden)' }),
    mapping('Ilvane', { type: 'locations', aliases: ['Ilv'] }),
  ];

  it('ranks prefix hits before substring hits', () => {
    const result = filterEntityMentions(mappings, 'Halv');
    expect(result[0].canonical).toBe('Halvard');
    expect(result.length).toBe(2);
  });

  it('matches aliases', () => {
    const result = filterEntityMentions(mappings, 'Ilv');
    expect(result.map((r) => r.canonical)).toContain('Ilvane');
  });

  it('keeps homonyms as separate suggestions', () => {
    const result = filterEntityMentions(mappings, 'Halvard');
    expect(result.filter((r) => r.canonical === 'Halvard').length).toBe(2);
  });

  it('returns everything capped by limit on empty query', () => {
    expect(filterEntityMentions(mappings, '').length).toBe(3);
    expect(filterEntityMentions(mappings, '', 2).length).toBe(2);
  });

  it('is case-insensitive', () => {
    expect(filterEntityMentions(mappings, 'halvard').length).toBe(2);
  });
});
