import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../database.js';
import {
  addEntityAlias,
  ensureEntityExists,
  findEntityCanonical,
  getEntityDetail,
  getEntityMappings,
  listAllEntityRefs,
  resolveEntityRef,
  setDiaryEntryPersons,
  getEntryEntities,
} from './diary.js';
import { entityLabel, splitEntityLabel } from './entityRefs.js';

function resetEntities() {
  db.exec(`
    DELETE FROM diary_entry_persons;
    DELETE FROM persons;
    DELETE FROM entity_aliases;
    DELETE FROM entity_summaries;
    DELETE FROM entity_knowledge_entries;
  `);
}

describe('homonym entities', () => {
  beforeEach(() => {
    resetEntities();
  });

  it('allows two entities with the same name and different qualifiers', () => {
    const paladin = ensureEntityExists('persons', 'Kerigan', 'Paladin des Klosters');
    const gnome = ensureEntityExists('persons', 'Kerigan', 'Begleiter von Calzone');

    expect(paladin.qualifier).toBe('Paladin des Klosters');
    expect(gnome.qualifier).toBe('Begleiter von Calzone');
    expect(listAllEntityRefs().persons).toHaveLength(2);
  });

  it('rejects a duplicate (name, qualifier) pair', () => {
    ensureEntityExists('persons', 'Kerigan', 'Begleiter von Calzone');
    // Same identity resolves to the existing row instead of failing.
    const again = ensureEntityExists('persons', 'Kerigan', 'Begleiter von Calzone');
    expect(again.qualifier).toBe('Begleiter von Calzone');
    expect(listAllEntityRefs().persons).toHaveLength(1);
  });

  it('resolves aliases to the exact qualified target', () => {
    ensureEntityExists('persons', 'Kerigan', 'Paladin des Klosters');
    ensureEntityExists('persons', 'Kerigan', 'Begleiter von Calzone');
    addEntityAlias('persons', 'Carrigon', 'Kerigan', 'Paladin des Klosters');

    expect(resolveEntityRef({ name: 'Carrigon', qualifier: '' }, 'persons')).toEqual({
      name: 'Kerigan',
      qualifier: 'Paladin des Klosters',
    });
    expect(findEntityCanonical('persons', 'carrigon')).toEqual({
      name: 'Kerigan',
      qualifier: 'Paladin des Klosters',
    });
    // The plain name stays ambiguous - no alias redirects it.
    expect(resolveEntityRef({ name: 'Kerigan', qualifier: '' }, 'persons').qualifier).toBe('');
  });

  it('keeps knowledge and summaries per homonym', () => {
    ensureEntityExists('persons', 'Kerigan', '');
    ensureEntityExists('persons', 'Kerigan', 'Begleiter von Calzone');

    const entryId = Number(
      db
        .prepare(
          "INSERT INTO diary_entries (user_id, title, content, created_at, updated_at) VALUES ('u1', 'T', '<p>x</p>', '2026-01-01', '2026-01-01')"
        )
        .run().lastInsertRowid
    );
    setDiaryEntryPersons(entryId, ['Kerigan', 'Kerigan (Begleiter von Calzone)']);

    const entities = getEntryEntities(entryId);
    expect(entities.persons.sort()).toEqual(['Kerigan', 'Kerigan (Begleiter von Calzone)']);
  });

  it('returns detail with qualifier and only its own aliases', () => {
    ensureEntityExists('persons', 'Kerigan', 'Paladin des Klosters');
    ensureEntityExists('persons', 'Kerigan', 'Begleiter von Calzone');
    addEntityAlias('persons', 'Karigen', 'Kerigan', 'Paladin des Klosters');

    const detail = getEntityDetail('persons', 'Kerigan', 'Paladin des Klosters');
    expect(detail?.qualifier).toBe('Paladin des Klosters');
    expect(detail?.aliases).toEqual(['Karigen']);

    const other = getEntityDetail('persons', 'Kerigan', 'Begleiter von Calzone');
    expect(other?.aliases).toEqual([]);
  });

  it('mappings expose labels for homonyms', () => {
    ensureEntityExists('persons', 'Kerigan', 'Begleiter von Calzone');
    const mappings = getEntityMappings().filter((m) => m.canonical === 'Kerigan');
    expect(mappings).toHaveLength(1);
    expect(mappings[0].label).toBe('Kerigan (Begleiter von Calzone)');
  });

  it('label helpers round-trip', () => {
    expect(entityLabel({ name: 'Kerigan', qualifier: '' })).toBe('Kerigan');
    expect(entityLabel({ name: 'Kerigan', qualifier: 'Gnom' })).toBe('Kerigan (Gnom)');
    expect(splitEntityLabel('Kerigan (Gnom)')).toEqual({ name: 'Kerigan', qualifier: 'Gnom' });
    // Real names containing parentheses stay intact when parsed tolerantly.
    expect(splitEntityLabel('Weird (Name)')).toEqual({ name: 'Weird', qualifier: 'Name' });
  });
});
