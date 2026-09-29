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
    const paladin = ensureEntityExists('persons', 'Halvard', 'Paladin');
    const gnome = ensureEntityExists('persons', 'Halvard', 'Begleiter von Ilvane');

    expect(paladin.qualifier).toBe('Paladin');
    expect(gnome.qualifier).toBe('Begleiter von Ilvane');
    expect(listAllEntityRefs().persons).toHaveLength(2);
  });

  it('rejects a duplicate (name, qualifier) pair', () => {
    ensureEntityExists('persons', 'Halvard', 'Begleiter von Ilvane');
    // Same identity resolves to the existing row instead of failing.
    const again = ensureEntityExists('persons', 'Halvard', 'Begleiter von Ilvane');
    expect(again.qualifier).toBe('Begleiter von Ilvane');
    expect(listAllEntityRefs().persons).toHaveLength(1);
  });

  it('resolves aliases to the exact qualified target', () => {
    ensureEntityExists('persons', 'Halvard', 'Paladin');
    ensureEntityExists('persons', 'Halvard', 'Begleiter von Ilvane');
    addEntityAlias('persons', 'Halgon', 'Halvard', 'Paladin');

    expect(resolveEntityRef({ name: 'Halgon', qualifier: '' }, 'persons')).toEqual({
      name: 'Halvard',
      qualifier: 'Paladin',
    });
    expect(findEntityCanonical('persons', 'halgon')).toEqual({
      name: 'Halvard',
      qualifier: 'Paladin',
    });
    // The plain name stays ambiguous - no alias redirects it.
    expect(resolveEntityRef({ name: 'Halvard', qualifier: '' }, 'persons').qualifier).toBe('');
  });

  it('keeps knowledge and summaries per homonym', () => {
    ensureEntityExists('persons', 'Halvard', '');
    ensureEntityExists('persons', 'Halvard', 'Begleiter von Ilvane');

    const entryId = Number(
      db
        .prepare(
          "INSERT INTO diary_entries (user_id, title, content, created_at, updated_at) VALUES ('u1', 'T', '<p>x</p>', '2026-01-01', '2026-01-01')"
        )
        .run().lastInsertRowid
    );
    setDiaryEntryPersons(entryId, ['Halvard', 'Halvard (Begleiter von Ilvane)']);

    const entities = getEntryEntities(entryId);
    expect(entities.persons.sort()).toEqual(['Halvard', 'Halvard (Begleiter von Ilvane)']);
  });

  it('returns detail with qualifier and only its own aliases', () => {
    ensureEntityExists('persons', 'Halvard', 'Paladin');
    ensureEntityExists('persons', 'Halvard', 'Begleiter von Ilvane');
    addEntityAlias('persons', 'Halken', 'Halvard', 'Paladin');

    const detail = getEntityDetail('persons', 'Halvard', 'Paladin');
    expect(detail?.qualifier).toBe('Paladin');
    expect(detail?.aliases).toEqual(['Halken']);

    const other = getEntityDetail('persons', 'Halvard', 'Begleiter von Ilvane');
    expect(other?.aliases).toEqual([]);
  });

  it('mappings expose labels for homonyms', () => {
    ensureEntityExists('persons', 'Halvard', 'Begleiter von Ilvane');
    const mappings = getEntityMappings().filter((m) => m.canonical === 'Halvard');
    expect(mappings).toHaveLength(1);
    expect(mappings[0].label).toBe('Halvard (Begleiter von Ilvane)');
  });

  it('label helpers round-trip', () => {
    expect(entityLabel({ name: 'Halvard', qualifier: '' })).toBe('Halvard');
    expect(entityLabel({ name: 'Halvard', qualifier: 'Gnom' })).toBe('Halvard (Gnom)');
    expect(splitEntityLabel('Halvard (Gnom)')).toEqual({ name: 'Halvard', qualifier: 'Gnom' });
    // Real names containing parentheses stay intact when parsed tolerantly.
    expect(splitEntityLabel('Weird (Name)')).toEqual({ name: 'Weird', qualifier: 'Name' });
  });
});
