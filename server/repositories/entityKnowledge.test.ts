import { describe, expect, it } from 'vitest';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  listActiveEntityKnowledge,
  listEntityKnowledge,
  markEntityKnowledgeDeleted,
  updateEntityKnowledge,
} from './entityKnowledge.js';

describe('entityKnowledge repository', () => {
  it('creates and retrieves a knowledge entry', () => {
    const entry = createEntityKnowledge('persons', 'Gandalf', 'About', 'A wise wizard', 'manual');

    expect(entry.entityType).toBe('persons');
    expect(entry.entityName).toBe('Gandalf');
    expect(entry.title).toBe('About');
    expect(entry.content).toBe('A wise wizard');
    expect(entry.status).toBe('active');

    const retrieved = getEntityKnowledgeEntry(entry.id);
    expect(retrieved).toEqual(entry);
  });

  it('lists entries for an entity case-insensitively', () => {
    createEntityKnowledge('locations', 'Mordor', null, 'Volcanic region', 'manual');
    const list = listEntityKnowledge('locations', 'mordor');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].entityName).toBe('Mordor');
  });

  it('updates an existing entry', () => {
    const entry = createEntityKnowledge(
      'organizations',
      'The Fellowship',
      null,
      'Original group',
      'manual'
    );

    const updated = updateEntityKnowledge(entry.id, {
      title: 'Updated',
      content: 'Updated content',
    });

    expect(updated).toBeTruthy();
    expect(updated!.title).toBe('Updated');
    expect(updated!.content).toBe('Updated content');
  });

  it('marks an entry as deleted and hides it from active lists', () => {
    const entry = createEntityKnowledge('persons', 'Saruman', null, 'Fallen wizard', 'manual');

    const deleted = markEntityKnowledgeDeleted(entry.id, 'test deletion');
    expect(deleted).toBeTruthy();
    expect(deleted!.status).toBe('deleted');
    expect(listActiveEntityKnowledge('persons', 'Saruman')).toHaveLength(0);
  });
});
