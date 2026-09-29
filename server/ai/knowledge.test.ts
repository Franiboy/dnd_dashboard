import { describe, expect, it } from 'vitest';
import { collectAffectedEntities } from './knowledge.js';
import type { EntityKnowledgeEntry, EntityType } from '../../shared/types.js';

function entry(
  id: number,
  entityType: EntityType,
  entityName: string,
  entityQualifier = ''
): EntityKnowledgeEntry {
  return {
    id,
    entityType,
    entityName,
    entityQualifier,
    title: null,
    content: 'Fakt',
    source: 'ai_extracted',
    status: 'active',
    statusReason: null,
    originType: null,
    originId: null,
    originTitle: null,
    validFrom: null,
    validUntil: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('collectAffectedEntities', () => {
  it('puts the focus entity first and dedupes entities case-insensitively', () => {
    const result = {
      created: [entry(1, 'persons', 'Ruvan')],
      deleted: [
        { id: 2, reason: 'Widerspruch', entry: entry(2, 'persons', 'ruvan') },
        { id: 3, reason: 'Widerspruch', entry: entry(3, 'organizations', 'Grenzwacht') },
      ],
      ended: [],
    };
    const targets = collectAffectedEntities(
      { entityType: 'organizations', entityName: 'Grenzwacht', entityQualifier: '' },
      result
    );
    expect(targets).toEqual([
      { entityType: 'organizations', entityName: 'Grenzwacht', entityQualifier: '' },
      { entityType: 'persons', entityName: 'Ruvan', entityQualifier: '' },
    ]);
  });

  it('keeps homonyms with different qualifiers separate', () => {
    const result = {
      created: [entry(1, 'persons', 'Halvard', 'Begleiter von Ilvane')],
      deleted: [{ id: 2, reason: 'Widerspruch', entry: entry(2, 'persons', 'Halvard') }],
      ended: [],
    };
    const targets = collectAffectedEntities(null, result);
    expect(targets).toEqual([
      {
        entityType: 'persons',
        entityName: 'Halvard',
        entityQualifier: 'Begleiter von Ilvane',
      },
      { entityType: 'persons', entityName: 'Halvard', entityQualifier: '' },
    ]);
  });

  it('includes the entity of a timeline-end (ended) as affected', () => {
    const result = {
      created: [],
      deleted: [],
      ended: [{ id: 2, reason: 'Gilt nicht mehr', entry: entry(2, 'organizations', 'Grenzwacht') }],
    };
    const targets = collectAffectedEntities(null, result);
    expect(targets).toEqual([
      { entityType: 'organizations', entityName: 'Grenzwacht', entityQualifier: '' },
    ]);
  });

  it('returns only the focus entity when nothing changed', () => {
    const targets = collectAffectedEntities(
      { entityType: 'locations', entityName: 'Baldur', entityQualifier: '' },
      {
        created: [],
        deleted: [],
        ended: [],
      }
    );
    expect(targets).toEqual([
      { entityType: 'locations', entityName: 'Baldur', entityQualifier: '' },
    ]);
  });

  it('returns an empty list without focus and without changes', () => {
    expect(collectAffectedEntities(null, { created: [], deleted: [], ended: [] })).toEqual([]);
  });
});
