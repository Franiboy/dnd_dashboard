import { describe, expect, it } from 'vitest';
import { db } from '../database.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  listActiveEntityKnowledge,
  listEntityKnowledge,
  markEntityKnowledgeDeleted,
  markEntityKnowledgeTimelineEnd,
  setEntityKnowledgeOrigin,
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
    expect(retrieved!.validFrom).toBeNull();
    expect(retrieved!.validUntil).toBeNull();
  });

  it('creates an entry with a validity window', () => {
    const entry = createEntityKnowledge(
      'persons',
      'Ruvan',
      'Beziehungen',
      'Steht Ilvane wohlgesonnen',
      'ai_extracted',
      '',
      3,
      7
    );
    expect(entry.validFrom).toBe(3);
    expect(entry.validUntil).toBe(7);
  });

  it('timeline-end keeps the fact active but limits its window', () => {
    const entry = createEntityKnowledge(
      'persons',
      'Timeline End Person',
      null,
      'Steht Ilvane gut',
      'manual'
    );
    expect(listActiveEntityKnowledge('persons', 'Timeline End Person')).toHaveLength(1);

    const ended = markEntityKnowledgeTimelineEnd(entry.id, 5, 'after the ambush');
    expect(ended!.status).toBe('active');
    expect(ended!.validUntil).toBe(5);
    expect(ended!.statusReason).toBe('after the ambush');

    // valid_until is EXCLUSIVE: the fact holds up to day (5-1)=4 and already
    // stops being current on day 5, so it never overlaps a replacement that
    // starts on day 5.
    expect(listActiveEntityKnowledge('persons', 'Timeline End Person', '', 4)).toHaveLength(1);
    expect(listActiveEntityKnowledge('persons', 'Timeline End Person', '', 5)).toHaveLength(0);
    expect(listActiveEntityKnowledge('persons', 'Timeline End Person', '', 6)).toHaveLength(0);
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

  it('stamps a diary origin and resolves the diary title', () => {
    const now = new Date().toISOString();
    const diary = db
      .prepare(
        'INSERT INTO diary_entries (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('tester', 'Der Kampf am Fluss', 'Inhalt', now, now);

    const entry = createEntityKnowledge(
      'persons',
      'Gandalf Origin',
      null,
      'Kämpfte am Fluss',
      'ai_extracted'
    );
    expect(entry.originType).toBeNull();
    expect(entry.originTitle).toBeNull();

    setEntityKnowledgeOrigin([entry.id], 'diary', Number(diary.lastInsertRowid));

    const stamped = getEntityKnowledgeEntry(entry.id);
    expect(stamped!.originType).toBe('diary');
    expect(stamped!.originId).toBe(Number(diary.lastInsertRowid));
    expect(stamped!.originTitle).toBe('Der Kampf am Fluss');
  });

  it('stamps a session origin and resolves the session name', () => {
    const session = db
      .prepare(
        `INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory)
         VALUES (?, 'stopped', 'g', 'c', 'tester', ?, 'dir')`
      )
      .run('Session Alpha', new Date().toISOString());

    const entry = createEntityKnowledge(
      'locations',
      'Bree Origin',
      null,
      'Besucht in der Session',
      'ai_extracted'
    );
    setEntityKnowledgeOrigin([entry.id], 'session', Number(session.lastInsertRowid));

    const stamped = listEntityKnowledge('locations', 'Bree Origin')[0];
    expect(stamped.originType).toBe('session');
    expect(stamped.originTitle).toBe('Session Alpha');
  });

  it('keeps manual entries without origin', () => {
    const entry = createEntityKnowledge(
      'organizations',
      'Manual Guild Origin',
      null,
      'Manuell gepflegt',
      'manual'
    );
    expect(entry.originType).toBeNull();
    expect(entry.originId).toBeNull();
    expect(entry.originTitle).toBeNull();
  });

  it('keeps an ending fact and its replacement disjoint on the transition day', () => {
    // valid_until is exclusive: the old fact holds up to day 4 and ends on day
    // 5; the replacement starts on day 5 (validFrom). They must never both be
    // "current", so get_entity never returns contradictory facts.
    const oldFact = createEntityKnowledge(
      'persons',
      'Transition Person',
      'Beziehungen',
      'v1',
      'manual'
    );
    markEntityKnowledgeTimelineEnd(oldFact.id, 5, 'changed');
    createEntityKnowledge(
      'persons',
      'Transition Person',
      'Beziehungen',
      'v2',
      'manual',
      '',
      5,
      null
    );

    expect(listActiveEntityKnowledge('persons', 'Transition Person', '', 4)).toHaveLength(1);
    const onDay5 = listActiveEntityKnowledge('persons', 'Transition Person', '', 5);
    expect(onDay5).toHaveLength(1);
    expect(onDay5[0]!.content).toBe('v2');
  });
});
