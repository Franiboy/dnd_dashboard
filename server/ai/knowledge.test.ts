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
    createdAt: '',
    updatedAt: '',
  };
}

describe('collectAffectedEntities', () => {
  it('puts the focus entity first and dedupes entities case-insensitively', () => {
    const result = {
      created: [entry(1, 'persons', 'Vimak')],
      deleted: [
        { id: 2, reason: 'Widerspruch', entry: entry(2, 'persons', 'vimak') },
        { id: 3, reason: 'Widerspruch', entry: entry(3, 'organizations', 'Wagenwacht') },
      ],
    };
    const targets = collectAffectedEntities(
      { entityType: 'organizations', entityName: 'Wagenwacht', entityQualifier: '' },
      result
    );
    expect(targets).toEqual([
      { entityType: 'organizations', entityName: 'Wagenwacht', entityQualifier: '' },
      { entityType: 'persons', entityName: 'Vimak', entityQualifier: '' },
    ]);
  });

  it('keeps homonyms with different qualifiers separate', () => {
    const result = {
      created: [entry(1, 'persons', 'Kerigan', 'Begleiter von Calzone')],
      deleted: [{ id: 2, reason: 'Widerspruch', entry: entry(2, 'persons', 'Kerigan') }],
    };
    const targets = collectAffectedEntities(null, result);
    expect(targets).toEqual([
      {
        entityType: 'persons',
        entityName: 'Kerigan',
        entityQualifier: 'Begleiter von Calzone',
      },
      { entityType: 'persons', entityName: 'Kerigan', entityQualifier: '' },
    ]);
  });

  it('returns only the focus entity when nothing changed', () => {
    const targets = collectAffectedEntities(
      { entityType: 'locations', entityName: 'Baldur', entityQualifier: '' },
      {
        created: [],
        deleted: [],
      }
    );
    expect(targets).toEqual([
      { entityType: 'locations', entityName: 'Baldur', entityQualifier: '' },
    ]);
  });

  it('returns an empty list without focus and without changes', () => {
    expect(collectAffectedEntities(null, { created: [], deleted: [] })).toEqual([]);
  });
});
