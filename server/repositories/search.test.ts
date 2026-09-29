import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../database.js';
import { runMigrations } from '../migrations.js';
import { buildFtsQuery, findTranscriptTime, globalSearch } from './search.js';
import {
  createDiaryEntry,
  deleteDiaryEntry,
  ensureEntityExists,
  updateDiaryEntry,
} from './diary.js';
import { replaceSessionEvents } from './timeline.js';

function insertUser(id: string): void {
  db.prepare(
    `INSERT INTO users (id, username, display_name, is_approved, disabled_apps, failed_login_attempts, created_at)
     VALUES (?, ?, ?, 1, '[]', 0, ?)`
  ).run(id, id, id, new Date().toISOString());
}

function insertLegacyDiaryEntry(userId: string, title: string, htmlContent: string): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO diary_entries (user_id, title, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(userId, title, htmlContent, now, now).lastInsertRowid
  );
}

function insertSession(name: string, transcript: string | null): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory, transcript)
         VALUES (?, 'completed', 'g', 'c', 'tester', ?, 'dir', ?)`
      )
      .run(name, now, transcript).lastInsertRowid
  );
}

function insertTimelineSession(name: string, gameDay: number): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory, transcript, game_day)
         VALUES (?, 'completed', 'g', 'c', 'tester', ?, 'dir', 'transcript text', ?)`
      )
      .run(name, now, gameDay).lastInsertRowid
  );
}

function insertKnowledgeFact(
  entityType: string,
  entityName: string,
  title: string | null,
  content: string,
  status = 'active'
): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO entity_knowledge_entries (entity_type, entity_name, title, content, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)`
      )
      .run(entityType, entityName, title, content, status, now, now).lastInsertRowid
  );
}

function deleteFromSearchIndex(sourceType: string, sourceId: number): void {
  db.prepare('DELETE FROM search_index WHERE source_type = ? AND source_id = ?').run(
    sourceType,
    sourceId
  );
}

beforeEach(() => {
  // A fresh diary user per test keeps privacy assertions independent.
  insertUser(`user-${Math.random().toString(36).slice(2, 8)}`);
});

describe('buildFtsQuery', () => {
  it('wraps every token as a quoted prefix term', () => {
    expect(buildFtsQuery('der  Schmied')).toBe('"der"* "Schmied"*');
  });

  it('defuses FTS5 query syntax and quotes', () => {
    // Without quoting, these would be valid (or invalid) FTS5 query grammar.
    expect(buildFtsQuery('a OR b NOT (c)')).toBe('"a"* "OR"* "b"* "NOT"* "(c)"*');
    expect(buildFtsQuery('"halvard"')).toBe('"halvard"*');
    expect(buildFtsQuery('title:geheim NEAR(x)')).toBe('"title:geheim"* "NEAR(x)"*');
  });

  it('caps the token count', () => {
    expect(buildFtsQuery('a b c d e f g h i j k l m n o')).toBe(
      '"a"* "b"* "c"* "d"* "e"* "f"* "g"* "h"* "i"* "j"* "k"* "l"*'
    );
    expect(buildFtsQuery('   ')).toBe('');
  });
});

describe('globalSearch', () => {
  it('finds diary entries and strips HTML from snippets', () => {
    const entry = createDiaryEntry(
      'alice',
      'Spieltag 3',
      '<p>Der <b>Schmied</b> schweigt heute.</p>',
      null,
      3
    );

    const hits = globalSearch('schmied', { userId: 'alice' }).filter((h) => h.source === 'diary');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit || hit.source !== 'diary') throw new Error('expected diary hit');
    expect(hit.id).toBe(entry.id);
    expect(hit.title).toBe('Spieltag 3');
    expect(hit.snippet).toContain('\u0001Schmied\u0002');
    expect(hit.snippet).not.toContain('<');
    expect(hit.gameDay).toBe(3);
  });

  it('never shows foreign diary entries (privacy)', () => {
    createDiaryEntry('alice', 'Geheim', '<p>Der versteckte Schatz im Kerker.</p>');

    expect(globalSearch('schatz', { userId: 'alice' })).toHaveLength(1);
    expect(globalSearch('schatz', { userId: 'bob' })).toHaveLength(0);
  });

  it('re-syncs diary entries on update and delete', () => {
    const entry = createDiaryEntry('alice', 'Titel', '<p>Alter Inhalt</p>');

    expect(globalSearch('alter', { userId: 'alice' })).toHaveLength(1);

    updateDiaryEntry(entry.id, { content: '<p>Neuer Inhalt</p>' });
    expect(globalSearch('alter', { userId: 'alice' })).toHaveLength(0);
    expect(globalSearch('neuer', { userId: 'alice' })).toHaveLength(1);

    deleteDiaryEntry(entry.id);
    expect(globalSearch('neuer', { userId: 'alice' })).toHaveLength(0);
  });

  it('finds session transcripts and reports the match timestamp', () => {
    const id = insertSession(
      'Der Überfall',
      '[00:14] Bob: Wo ist der Schlüssel?\n[02:31] Alice: Fragt den Schmied.\n[04:00] Bob: Ok.'
    );

    const hits = globalSearch('schmied', { userId: 'alice' }).filter((h) => h.source === 'session');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit || hit.source !== 'session') throw new Error('expected session hit');
    expect(hit.id).toBe(id);
    expect(hit.title).toBe('Der Überfall');
    expect(hit.snippet).toContain('\u0001Schmied\u0002');
    expect(hit.transcriptTime).toBe('02:31');
  });

  it('matches umlauts ignoring diacritics and case', () => {
    insertSession('Der Förster und der Übergriff', null);
    // Case folding alone would match the second query; the first one proves
    // the tokenizer strips diacritics on both sides.
    const hits = globalSearch('ubergriff', { userId: 'x' }).filter((h) => h.source === 'session');
    expect(hits).toHaveLength(1);
    const hitsUmlaut = globalSearch('übergriff', { userId: 'x' }).filter(
      (h) => h.source === 'session'
    );
    expect(hitsUmlaut).toHaveLength(1);
  });

  it('re-syncs sessions when the transcript changes', () => {
    const id = insertSession('Session', '[00:10] Alice: Hallo.');
    expect(globalSearch('ork', { userId: 'x' })).toHaveLength(0);

    db.prepare('UPDATE recording_sessions SET transcript = ? WHERE id = ?').run(
      '[00:10] Alice: Ein Ork!',
      id
    );
    expect(globalSearch('ork', { userId: 'x' })).toHaveLength(1);
  });

  it('finds knowledge facts and opens them via the entity reference', () => {
    ensureEntityExists('persons', 'Schmied');
    const factId = insertKnowledgeFact('persons', 'Schmied', 'Waffe', 'Schmiedet seltene Klingen');

    const hits = globalSearch('klingen', { userId: 'x' }).filter((h) => h.source === 'knowledge');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit || hit.source !== 'knowledge') throw new Error('expected knowledge hit');
    expect(hit.id).toBe(factId);
    expect(hit.entityType).toBe('persons');
    expect(hit.entityName).toBe('Schmied');
    expect(hit.snippet).toContain('\u0001Klingen\u0002');
  });

  it('drops soft-deleted knowledge facts from the index', () => {
    const factId = insertKnowledgeFact('locations', 'Kerker', null, 'Verlies unter der Burg');
    expect(globalSearch('verlies', { userId: 'x' })).toHaveLength(1);

    db.prepare(
      "UPDATE entity_knowledge_entries SET status = 'deleted', updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), factId);
    expect(globalSearch('verlies', { userId: 'x' })).toHaveLength(0);

    db.prepare('UPDATE entity_knowledge_entries SET status = ?, updated_at = ? WHERE id = ?').run(
      'active',
      new Date().toISOString(),
      factId
    );
    expect(globalSearch('verlies', { userId: 'x' })).toHaveLength(1);
  });

  it('finds timeline events with their scenes folded into the event hit', () => {
    const sessionId = insertTimelineSession('Das Drachenfest', 5);
    replaceSessionEvents(sessionId, [
      {
        gameDay: 5,
        title: 'Drachenkampf',
        description: '<p>Sieg über den <b>Drachen</b></p>',
        scenes: [
          { gameDay: 5, title: 'Vorbereitung', description: '<p>Die Helden sammeln sich</p>' },
        ],
      },
    ]);

    const hitsFor = (query: string) =>
      globalSearch(query, { userId: 'x' }).filter((h) => h.source === 'timeline');

    const hits = hitsFor('drachen');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit || hit.source !== 'timeline') throw new Error('expected timeline hit');
    expect(hit.id).toBe(
      (
        db.prepare('SELECT id FROM timeline_events WHERE session_id = ?').get(sessionId) as {
          id: number;
        }
      ).id
    );
    expect(hit.title).toBe('Drachenkampf');
    expect(hit.gameDay).toBe(5);
    expect(hit.sessionName).toBe('Das Drachenfest');
    expect(hit.snippet).not.toContain('<');

    // Scene-only terms hit the same parent event, not a separate document.
    expect(hitsFor('vorbereitung')).toHaveLength(1);
    expect(hitsFor('helden')).toHaveLength(1);
  });

  it('keeps the timeline document in sync when scenes change or the session regenerates', () => {
    const sessionId = insertTimelineSession('Kerkerlauf', 8);
    replaceSessionEvents(sessionId, [
      { gameDay: 8, title: 'Einbruch', description: null, scenes: [] },
    ]);
    const hitsFor = (query: string) =>
      globalSearch(query, { userId: 'x' }).filter((h) => h.source === 'timeline');
    expect(hitsFor('einbruch')).toHaveLength(1);

    // A scene written after the event completes the indexed document.
    const eventId = (
      db.prepare('SELECT id FROM timeline_events WHERE session_id = ?').get(sessionId) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO timeline_scenes (event_id, game_day, position, title, description)
       VALUES (?, 8, 0, 'Wachen ausgeschaltet', '<p>Still und leise</p>')`
    ).run(eventId);
    expect(hitsFor('wachen')).toHaveLength(1);

    db.prepare('DELETE FROM timeline_scenes WHERE event_id = ?').run(eventId);
    expect(hitsFor('wachen')).toHaveLength(0);
    expect(hitsFor('einbruch')).toHaveLength(1);

    // Regeneration replaces events (new ids) instead of appending.
    replaceSessionEvents(sessionId, [
      { gameDay: 8, title: 'Rückzug', description: '<p>Der Rückzug</p>', scenes: [] },
    ]);
    expect(hitsFor('einbruch')).toHaveLength(0);
    expect(hitsFor('rückzug')).toHaveLength(1);
  });
});

describe('search index migration', () => {
  it('backfills legacy rows with HTML-only content and is idempotent', () => {
    // Legacy row: raw insert without content_text, indexed only by backfill.
    const id = insertLegacyDiaryEntry('legacy-user', 'Alt', '<p>Versteckter <i>Hinweis</i></p>');
    deleteFromSearchIndex('diary', id);

    runMigrations();

    expect(globalSearch('versteckter', { userId: 'legacy-user' })).toHaveLength(1);
    const text = db.prepare('SELECT content_text FROM diary_entries WHERE id = ?').get(id) as {
      content_text: string;
    };
    expect(text.content_text).toBe('Versteckter Hinweis');

    // A second run must not duplicate or remove index rows.
    const count = () =>
      (db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number }).n;
    const before = count();
    runMigrations();
    expect(count()).toBe(before);
  });

  it('backfills legacy timeline events and scenes into plain-text documents', () => {
    const sessionId = insertTimelineSession('Ritterfest', 3);
    const now = new Date().toISOString();
    // Legacy rows: raw insert without description_text, indexed only by the
    // backfill (the trigger documents were removed below first).
    const eventId = Number(
      db
        .prepare(
          `INSERT INTO timeline_events (game_day, session_id, title, description, prompt_version, generated_at, updated_at)
           VALUES (3, ?, 'Turnier', '<p>Das große <i>Turnier</i></p>', 2, ?, ?)`
        )
        .run(sessionId, now, now).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO timeline_scenes (event_id, game_day, position, title, description)
       VALUES (?, 3, 0, 'Turniervorbereitung', '<p>Rüstung poliert</p>')`
    ).run(eventId);
    deleteFromSearchIndex('timeline', eventId);

    runMigrations();

    const hits = globalSearch('turnier', { userId: 'x' }).filter((h) => h.source === 'timeline');
    expect(hits).toHaveLength(1);
    const text = db
      .prepare('SELECT description_text FROM timeline_events WHERE id = ?')
      .get(eventId) as { description_text: string | null };
    expect(text.description_text).toBe('Das große Turnier');
    // The scene text lands in the same document as the parent event.
    expect(
      globalSearch('rüstung', { userId: 'x' }).filter((h) => h.source === 'timeline')
    ).toHaveLength(1);
  });
});

describe('findTranscriptTime', () => {
  it('finds the timestamp before the first match (MM:SS and HH:MM:SS)', () => {
    const transcript =
      '[00:14] Bob: Wo ist er?\n[1:02:03] Alice: Der Schmied schweigt.\n[04:00] Bob: Ok.';
    expect(findTranscriptTime(transcript, 'schmied')).toBe('1:02:03');
    expect(findTranscriptTime(transcript, 'ist')).toBe('00:14');
    // Tokens shorter than three characters are ignored (too noisy).
    expect(findTranscriptTime(transcript, 'wo')).toBeNull();
    expect(findTranscriptTime(transcript, 'nirgendwo')).toBeNull();
    expect(findTranscriptTime(null, 'schmied')).toBeNull();
  });
});
