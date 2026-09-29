import { describe, expect, it } from 'vitest';
import { db } from '../database.js';
import {
  activateStoryArc,
  createStoryArc,
  deleteStoryArc,
  getActiveArcId,
  getArcIdForDiaryEntry,
  getArcIdForSession,
  getStoryArc,
  knowledgeOverlapsArcRange,
  linkStoryArcEntity,
  listArcIdsForEntity,
  listEntitiesForArc,
  listEntitiesOutsideArcs,
  listStoryArcs,
  storyArcExists,
  updateStoryArc,
} from './storyArcs.js';
import { createSession } from './recordings.js';
import {
  createDiaryEntry,
  createSessionDiaryDraft,
  ensureEntityExists,
  setDiaryEntryPersons,
} from './diary.js';
import { runMigrations } from '../migrations.js';

function insertSession(name: string, arcId: number | null, gameDay: number | null): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory, arc_id, game_day)
         VALUES (?, 'completed', 'g', 'c', 'tester', ?, 'dir', ?, ?)`
      )
      .run(name, now, arcId, gameDay).lastInsertRowid
  );
}

function insertEntry(user: string, arcId: number | null, gameDay: number | null): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO diary_entries (user_id, title, content, arc_id, game_day, created_at, updated_at)
         VALUES (?, 'Eintrag', 'Inhalt', ?, ?, ?, ?)`
      )
      .run(user, arcId, gameDay, now, now).lastInsertRowid
  );
}

function insertUser(id: string, activePerson: string | null, approved = true): void {
  db.prepare(
    `INSERT INTO users (id, username, display_name, is_approved, active_person, disabled_apps, failed_login_attempts, created_at)
     VALUES (?, ?, ?, ?, ?, '[]', 0, ?)`
  ).run(id, id, id, approved ? 1 : 0, activePerson, new Date().toISOString());
}

describe('storyArcs repository', () => {
  it('starts with a seeded active arc (migration)', () => {
    runMigrations();
    expect(getActiveArcId()).not.toBeNull();
  });

  it('creates arcs as planned and keeps the update', () => {
    const arc = createStoryArc({ name: 'Der Schattenkrieg', description: 'Kapitel 2' });
    expect(arc.status).toBe('planned');
    const updated = updateStoryArc(arc.id, { name: 'Schattenkrieg', description: null });
    expect(updated?.name).toBe('Schattenkrieg');
    expect(updated?.description).toBeNull();
  });

  it('keeps exactly one active arc when switching', () => {
    const a = createStoryArc({ name: 'Arc A' });
    const b = createStoryArc({ name: 'Arc B' });
    activateStoryArc(a.id);
    expect(getActiveArcId()).toBe(a.id);
    activateStoryArc(b.id);
    expect(getActiveArcId()).toBe(b.id);
    expect(getStoryArc(a.id)?.status).toBe('completed');
    expect(getStoryArc(b.id)?.status).toBe('active');
  });

  it('refuses to delete the active arc and nulls members otherwise', () => {
    const active = getActiveArcId()!;
    expect(() => deleteStoryArc(active)).toThrow();

    const arc = createStoryArc({ name: 'Wegwerf-Arc' });
    const sessionId = insertSession('S', arc.id, 5);
    const entryId = insertEntry('tester', arc.id, 6);
    expect(deleteStoryArc(arc.id)).toBe(true);
    expect(
      (
        db.prepare('SELECT arc_id AS a FROM recording_sessions WHERE id = ?').get(sessionId) as {
          a: number | null;
        }
      ).a
    ).toBeNull();
    expect(
      (
        db.prepare('SELECT arc_id AS a FROM diary_entries WHERE id = ?').get(entryId) as {
          a: number | null;
        }
      ).a
    ).toBeNull();
  });

  it('refuses to delete a completed arc while planned ones stay deletable', () => {
    const completed = createStoryArc({ name: 'Alte Kampagne' });
    const other = createStoryArc({ name: 'Nachfolger' });
    activateStoryArc(completed.id);
    activateStoryArc(other.id);
    expect(getStoryArc(completed.id)?.status).toBe('completed');
    expect(() => deleteStoryArc(completed.id)).toThrow();

    const planned = createStoryArc({ name: 'Noch nie aktiv' });
    expect(getStoryArc(planned.id)?.status).toBe('planned');
    expect(deleteStoryArc(planned.id)).toBe(true);
  });

  it('derives game-day range and member counts from members', () => {
    const arc = createStoryArc({ name: 'Zeitreise' });
    const s1 = insertSession('S1', arc.id, 10);
    db.prepare('UPDATE recording_sessions SET game_day_end = 12 WHERE id = ?').run(s1);
    insertEntry('tester', arc.id, 8);
    const loaded = getStoryArc(arc.id)!;
    expect(loaded.sessionCount).toBe(1);
    expect(loaded.diaryEntryCount).toBe(1);
    expect(loaded.gameDayStart).toBe(8);
    expect(loaded.gameDayEnd).toBe(12);
  });
});

describe('story arc auto-assignment', () => {
  it('files new sessions into the active arc', () => {
    const arc = createStoryArc({ name: 'Aktiv-Arc' });
    activateStoryArc(arc.id);
    const session = createSession({
      name: 'Auto-Session',
      guildId: 'g',
      channelId: 'c',
      createdBy: 'auto',
      directory: 'dir',
    });
    expect(session.arcId).toBe(arc.id);
    expect(getArcIdForSession(session.id)).toBe(arc.id);
  });

  it('files manual diary entries into the active arc unless told otherwise', () => {
    const arc = createStoryArc({ name: 'Tagebuch-Arc' });
    activateStoryArc(arc.id);
    const entry = createDiaryEntry('tester', 'Spieltag 900', '<p>Text</p>', null, 900);
    expect(entry.arcId).toBe(arc.id);
    const explicit = createDiaryEntry('tester', 'Spieltag 901', '<p>Text</p>', null, 901, null);
    expect(explicit.arcId).toBeNull();
  });

  it('inherits the session arc for diary drafts', () => {
    const session = createSession({
      name: 'Draft-Quelle',
      guildId: 'g',
      channelId: 'c',
      createdBy: 'auto',
      directory: 'dir',
    });
    const arc = createStoryArc({ name: 'Draft-Arc' });
    activateStoryArc(arc.id);
    db.prepare('UPDATE recording_sessions SET arc_id = ? WHERE id = ?').run(arc.id, session.id);
    // Drafts inherit the arc of their source session.
    const draft = createSessionDiaryDraft('tester', 'Entwurf', session.id, '<p>Entwurf</p>');
    expect(draft.arcId).toBe(arc.id);
    expect(getArcIdForDiaryEntry(draft.id)).toBe(arc.id);
  });
});

describe('story arc entity links (m:n)', () => {
  it('links entities idempotently and lists them per arc', () => {
    const arc = createStoryArc({ name: 'Entitäts-Arc' });
    activateStoryArc(arc.id);
    const entry = insertEntry('tester', arc.id, 1);

    // Auto-link through the diary entry funnel.
    setDiaryEntryPersons(entry, ['Ruvan']);
    setDiaryEntryPersons(entry, ['Ruvan']);
    expect(listEntitiesForArc(arc.id).persons).toEqual([{ name: 'Ruvan', qualifier: '' }]);
    expect(listArcIdsForEntity('persons', 'Ruvan')).toContain(arc.id);

    // Manual removal is authoritative until the next run re-links.
    db.prepare('DELETE FROM story_arc_entities WHERE arc_id = ?').run(arc.id);
    expect(listEntitiesForArc(arc.id).persons).toEqual([]);
  });

  it('does not link entities when the entry is unassigned', () => {
    const entry = insertEntry('tester', null, 2);
    setDiaryEntryPersons(entry, ['Arcloser Held']);
    expect(listArcIdsForEntity('persons', 'Arcloser Held')).toEqual([]);
  });

  it('keeps one entity in several arcs', () => {
    const a = createStoryArc({ name: 'Arc-X' });
    const b = createStoryArc({ name: 'Arc-Y' });
    ensureEntityExists('persons', 'Ilvane');
    linkStoryArcEntity(a.id, 'persons', { name: 'Ilvane', qualifier: '' });
    linkStoryArcEntity(b.id, 'persons', { name: 'Ilvane', qualifier: '' });
    linkStoryArcEntity(a.id, 'persons', { name: 'Ilvane', qualifier: '' });
    expect(listArcIdsForEntity('persons', 'Ilvane').sort()).toEqual([a.id, b.id].sort());
  });

  it('links case-insensitively: differently cased identities share one row', () => {
    const arc = createStoryArc({ name: 'Case-Arc' });
    const row = ensureEntityExists('persons', 'Gandalf');
    expect(row.name).toBe('Gandalf');
    linkStoryArcEntity(arc.id, 'persons', { name: 'gandalf', qualifier: '' });
    linkStoryArcEntity(arc.id, 'persons', { name: 'GANDALF', qualifier: '' });
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM story_arc_entities WHERE entity_name LIKE ?')
      .get('gandalf') as { n: number };
    expect(count.n).toBe(1);
    expect(listArcIdsForEntity('persons', 'gandalf')).toEqual([arc.id]);
    expect(listArcIdsForEntity('persons', 'Gandalf')).toEqual([arc.id]);
    // The arc view only lists real entity rows, never ghost spellings.
    expect(listEntitiesForArc(arc.id).persons).toEqual([{ name: 'Gandalf', qualifier: '' }]);
  });

  it('lists entities outside every arc for the "Ohne Arc" view', () => {
    const arc = createStoryArc({ name: 'Only-Some-Arc' });
    ensureEntityExists('persons', 'Verlinkt');
    ensureEntityExists('persons', 'Unverlinkt');
    linkStoryArcEntity(arc.id, 'persons', { name: 'Verlinkt', qualifier: '' });
    const outside = listEntitiesOutsideArcs();
    const names = outside.persons.map((ref) => ref.name.toLowerCase());
    expect(names).toContain('unverlinkt');
    expect(names).not.toContain('verlinkt');
  });

  it('storyArcExists checks ids without loading stats', () => {
    const arc = createStoryArc({ name: 'Exists-Arc' });
    expect(storyArcExists(arc.id)).toBe(true);
    expect(storyArcExists(arc.id + 99999)).toBe(false);
  });
});

describe('story arc main-character auto-link', () => {
  it("files the approved users' active persons into every new arc", () => {
    ensureEntityExists('persons', 'Ilvane');
    ensureEntityExists('persons', 'Ruvan');
    ensureEntityExists('persons', 'Privat');
    insertUser('u1', 'Ilvane');
    // Case/whitespace variants canonicalize onto the same person row.
    insertUser('u2', ' ruvan ');
    insertUser('u3', 'RUVAN');
    insertUser('u4', null);
    // Unapproved users and names without a world entity row stay out.
    insertUser('u5', 'Privat', false);
    insertUser('u6', 'Geistercharakter');

    const arc = createStoryArc({ name: 'Hauptcharakter-Arc' });
    expect(listEntitiesForArc(arc.id).persons).toEqual([
      { name: 'Ilvane', qualifier: '' },
      { name: 'Ruvan', qualifier: '' },
    ]);
    expect(getStoryArc(arc.id)!.entityCount).toBe(2);

    // Every subsequent arc gets the same seed, not just the first one.
    const second = createStoryArc({ name: 'Zweiter Hauptcharakter-Arc' });
    expect(listEntitiesForArc(second.id).persons).toEqual([
      { name: 'Ilvane', qualifier: '' },
      { name: 'Ruvan', qualifier: '' },
    ]);

    expect(listArcIdsForEntity('persons', 'Privat')).toEqual([]);
    expect(listArcIdsForEntity('persons', 'Geistercharakter')).toEqual([]);
  });
});

describe('knowledge arc-range overlap', () => {
  it('treats valid windows as inclusive-from / exclusive-until', () => {
    const range = { start: 10, end: 20 };
    expect(knowledgeOverlapsArcRange({ validFrom: 5, validUntil: 10 }, range)).toBe(false);
    expect(knowledgeOverlapsArcRange({ validFrom: 5, validUntil: 11 }, range)).toBe(true);
    expect(knowledgeOverlapsArcRange({ validFrom: 20, validUntil: null }, range)).toBe(true);
    expect(knowledgeOverlapsArcRange({ validFrom: 21, validUntil: null }, range)).toBe(false);
    // Timeless facts are valid during the whole range.
    expect(knowledgeOverlapsArcRange({ validFrom: null, validUntil: null }, range)).toBe(true);
  });
});

describe('story arc chapter numbers', () => {
  it('creates, reads and clears chapter numbers', () => {
    const arc = createStoryArc({ name: 'Kapitel-Arc', chapterNumber: 2 });
    expect(getStoryArc(arc.id)?.chapterNumber).toBe(2);
    const updated = updateStoryArc(arc.id, { chapterNumber: 3 });
    expect(updated?.chapterNumber).toBe(3);
    expect(updateStoryArc(arc.id, { chapterNumber: null })?.chapterNumber).toBeNull();
  });

  it('rejects invalid and duplicate numbers but allows several unnumbered arcs', () => {
    const numbered = createStoryArc({ name: 'Kapitel Eins', chapterNumber: 1 });
    expect(() => createStoryArc({ name: 'Nochmal Eins', chapterNumber: 1 })).toThrow();
    expect(() => createStoryArc({ name: 'Null', chapterNumber: 0 })).toThrow();

    const unnumberedA = createStoryArc({ name: 'Ohne Nummer 1' });
    const unnumberedB = createStoryArc({ name: 'Ohne Nummer 2' });
    expect(unnumberedA.chapterNumber).toBeNull();
    expect(unnumberedB.chapterNumber).toBeNull();

    // Updating onto a taken number fails; keeping the arc's own number works.
    const other = createStoryArc({ name: 'Kapitel Zwei', chapterNumber: 2 });
    expect(() => updateStoryArc(other.id, { chapterNumber: 1 })).toThrow();
    expect(updateStoryArc(other.id, { chapterNumber: 2 })?.chapterNumber).toBe(2);
    expect(getStoryArc(numbered.id)?.chapterNumber).toBe(1);
  });
});

describe('story arcs list ordering', () => {
  it('sorts the active arc first', () => {
    const arcs = listStoryArcs();
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.find((a) => a.status === 'active')).toEqual(arcs[0]);
  });
});
