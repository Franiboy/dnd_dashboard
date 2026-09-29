import { describe, expect, it } from 'vitest';
import { buildTriggers, escapeRegex, findMatches } from './entityMatching';

describe('escapeRegex', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
  });
});

describe('buildTriggers', () => {
  it('builds triggers from mappings and sorts by length descending', () => {
    const triggers = buildTriggers([
      {
        type: 'persons',
        canonical: 'Gandalf',
        qualifier: '',
        label: 'Gandalf',
        aliases: ['Mithrandir'],
        miniSummary: null,
      },
      {
        type: 'locations',
        canonical: 'Mordor',
        qualifier: '',
        label: 'Mordor',
        aliases: [],
        miniSummary: 'Volcanic',
      },
    ]);

    expect(triggers).toHaveLength(3);
    expect(triggers[0].text).toBe('Mithrandir');
    expect(triggers[1].text).toBe('Gandalf');
    expect(triggers[2].text).toBe('Mordor');
  });
});

describe('findMatches', () => {
  it('finds whole-word entity matches', () => {
    const triggers = buildTriggers([
      {
        type: 'persons',
        canonical: 'Gandalf',
        qualifier: '',
        label: 'Gandalf',
        aliases: ['Mithrandir'],
        miniSummary: 'Wizard',
      },
    ]);

    const matches = findMatches('Gandalf and Mithrandir walked.', triggers);
    expect(matches).toHaveLength(2);
    expect(matches[0].text).toBe('Gandalf');
    expect(matches[1].text).toBe('Mithrandir');
  });

  it('does not match substrings', () => {
    const triggers = buildTriggers([
      {
        type: 'persons',
        canonical: 'Gandalf',
        qualifier: '',
        label: 'Gandalf',
        aliases: [],
        miniSummary: null,
      },
    ]);

    const matches = findMatches('Gandalforc is not Gandalf.', triggers);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('Gandalf');
  });

  it('picks the longest non-overlapping match', () => {
    const triggers = buildTriggers([
      {
        type: 'persons',
        canonical: 'Mithrandir',
        qualifier: '',
        label: 'Mithrandir',
        aliases: [],
        miniSummary: null,
      },
    ]);

    const matches = findMatches('Mithrandir attacked.', triggers);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('Mithrandir');
  });

  it('collects homonym candidates for ambiguous mentions', () => {
    const triggers = buildTriggers([
      {
        type: 'persons',
        canonical: 'Halvard',
        qualifier: '',
        label: 'Halvard',
        aliases: [],
        miniSummary: null,
      },
      {
        type: 'persons',
        canonical: 'Halvard',
        qualifier: 'Begleiter von Ilvane',
        label: 'Halvard (Begleiter von Ilvane)',
        aliases: [],
        miniSummary: null,
      },
    ]);

    const matches = findMatches('Halvard lacht.', triggers);
    expect(matches).toHaveLength(1);
    expect(matches[0].candidates).toHaveLength(2);
    expect(matches[0].candidates.map((c) => c.qualifier)).toEqual(['', 'Begleiter von Ilvane']);
  });
});
