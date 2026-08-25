// One-off data repair for the production campaign database.
//
// Fixes the "Kerigan" homonym mess that accumulated before entities could
// share a name:
//
//   - "Kerrigan"      -> blind paladin of the monastery, shapeshifter
//                        (wyvern form), Zhentarim middleman. ONE being,
//                        gets a disambiguating qualifier.
//   - "Carrigon"      -> AI mishearing duplicate of the paladin. Merged into
//                        Kerrigan as an alias (links, knowledge and summary
//                        move along).
//   - "Wyfern"        -> the wyvern form, merged into Kerrigan as an alias.
//   - "Carrigen"      -> the surviving garden gnome of the "die Kerigans"
//                        group, now Calzone's companion. Becomes his own
//                        person "Kerigan (Begleiter von Calzone)".
//   - Alias "Karigen" keeps pointing at Kerrigan, now qualifier-aware.
//
// Usage:
//   npx tsx scripts/fix-kerrigan-entities.ts            # dry run (rollback)
//   npx tsx scripts/fix-kerrigan-entities.ts --apply    # write changes
//
// Every step is idempotent - the script can be run repeatedly.

import 'dotenv/config';
import { runMigrations } from '../server/migrations.js';
import { db } from '../server/database.js';
import { addEntityAlias, updateEntity } from '../server/repositories/diary.js';
import { renameEntityKnowledge } from '../server/repositories/entityKnowledge.js';

const KERRIGAN_NAME = 'Kerrigan';
const KERRIGAN_QUALIFIER = 'Paladin des Klosters und Zentarim-Mittelsmann';
const KERIGAN_GNOME_NAME = 'Kerigan';
const KERIGAN_GNOME_QUALIFIER = 'Begleiter von Calzone';

const apply = process.argv.includes('--apply');

function personRow(name: string): { id: number; name: string; qualifier: string } | undefined {
  return db
    .prepare(
      'SELECT id, name, qualifier FROM persons WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1'
    )
    .get(name) as { id: number; name: string; qualifier: string } | undefined;
}

function count(table: string, where: string, ...params: (string | number)[]): number {
  return Number(
    db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(...params)?.c ?? 0
  );
}

/** Gives the plain "Kerrigan" row its disambiguating qualifier. */
function qualifyKerrigan(): void {
  const row = personRow(KERRIGAN_NAME);
  if (!row) {
    console.log(`!! Person "${KERRIGAN_NAME}" nicht gefunden – bitte zuerst anlegen.`);
    process.exitCode = 1;
    return;
  }
  if ((row.qualifier ?? '') === KERRIGAN_QUALIFIER) {
    console.log(`= ${KERRIGAN_NAME} trägt den Qualifier bereits. Keine Änderung.`);
    return;
  }
  console.log(
    `-> Setze Qualifier von "${row.name}" (${row.qualifier || 'ohne'}) auf "${KERRIGAN_QUALIFIER}".`
  );
  if (!apply) return;
  const tx = db.transaction(() => {
    db.prepare('UPDATE persons SET qualifier = ? WHERE id = ?').run(KERRIGAN_QUALIFIER, row.id);
    // Move knowledge + summary keys to the qualified identity.
    renameEntityKnowledge('persons', row.name, row.name, '', KERRIGAN_QUALIFIER);
    // Existing aliases keep targeting this person, now qualifier-aware.
    db.prepare(
      'UPDATE entity_aliases SET canonical = ?, canonical_qualifier = ? WHERE type = ? AND canonical = ? COLLATE NOCASE'
    ).run(row.name, KERRIGAN_QUALIFIER, 'persons', row.name);
  });
  tx();
}

/**
 * Merges a duplicate person into the qualified Kerrigan via the regular
 * alias mechanism: diary links, knowledge entries and summaries move to the
 * target, the source row disappears, its name stays as an alias.
 */
function mergeIntoKerrigan(duplicateName: string): void {
  const dup = personRow(duplicateName);
  if (!dup) {
    console.log(`= "${duplicateName}" existiert nicht (schon gemergt?). Überspringe.`);
    return;
  }
  const links = count('diary_entry_persons', 'person_id = ?', dup.id);
  const knowledge = count(
    'entity_knowledge_entries',
    "entity_type = 'persons' AND entity_name = ? COLLATE NOCASE",
    duplicateName
  );
  console.log(
    `-> Merge "${duplicateName}" (${links} Eintrags-Links, ${knowledge} Wissenseinträge) in "${KERRIGAN_NAME} (${KERRIGAN_QUALIFIER})"; Name bleibt als Alias erhalten.`
  );
  if (!apply) return;
  addEntityAlias('persons', duplicateName, KERRIGAN_NAME, KERRIGAN_QUALIFIER);
}

/** Turns "Carrigen" into the gnome companion as a separate homonym person. */
function promoteGnomeCompanion(): void {
  const gnome = personRow(KERIGAN_GNOME_NAME);
  if (gnome && (gnome.qualifier ?? '') === KERIGAN_GNOME_QUALIFIER) {
    console.log(`= "${KERIGAN_GNOME_NAME} (${KERIGAN_GNOME_QUALIFIER})" existiert bereits. OK.`);
    return;
  }

  const src = personRow('Carrigen');
  if (!src) {
    console.log(
      `!! Weder "Carrigen" noch "${KERIGAN_GNOME_NAME} (${KERIGAN_GNOME_QUALIFIER})" gefunden – nichts zu tun.`
    );
    return;
  }
  const links = count('diary_entry_persons', 'person_id = ?', src.id);
  console.log(
    `-> Benenne "Carrigen" (${links} Eintrags-Links) um in "${KERIGAN_GNOME_NAME} (${KERIGAN_GNOME_QUALIFIER})", Alias "Carrigen" bleibt erhalten.`
  );
  if (!apply) return;
  updateEntity(
    'persons',
    src.name,
    KERIGAN_GNOME_NAME,
    ['Carrigen'],
    src.qualifier ?? '',
    KERIGAN_GNOME_QUALIFIER
  );
}

/** Marks the two resulting summaries dirty so the AI regenerates them. */
function markSummariesDirty(): void {
  for (const [name, qualifier] of [
    [KERRIGAN_NAME, KERRIGAN_QUALIFIER],
    [KERIGAN_GNOME_NAME, KERIGAN_GNOME_QUALIFIER],
  ] as const) {
    const row = db
      .prepare(
        'SELECT is_dirty FROM entity_summaries WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
      )
      .get('persons', name, qualifier) as { is_dirty: number } | undefined;
    if (!row) {
      console.log(`- Keine Zusammenfassung für "${name}" vorhanden (wird bei Bedarf erzeugt).`);
      continue;
    }
    if (row.is_dirty) {
      console.log(`= Zusammenfassung für "${name}" ist bereits dirty.`);
      continue;
    }
    console.log(`-> Markiere Zusammenfassung von "${name}" als veraltet (dirty).`);
    if (!apply) continue;
    db.prepare(
      'UPDATE entity_summaries SET is_dirty = 1 WHERE entity_type = ? AND entity_name = ? COLLATE NOCASE AND entity_qualifier = ?'
    ).run('persons', name, qualifier);
  }
}

function report(): void {
  console.log('\n--- Ergebnis ---');
  for (const row of db
    .prepare(
      'SELECT p.name, p.qualifier, COUNT(l.diary_entry_id) AS links FROM persons p LEFT JOIN diary_entry_persons l ON l.person_id = p.id WHERE p.name IN (?, ?, ?) COLLATE NOCASE GROUP BY p.id'
    )
    .all('Kerrigan', 'Kerigan', 'Carrigen') as {
    name: string;
    qualifier: string;
    links: number;
  }[]) {
    console.log(
      `person: ${row.name}${row.qualifier ? ` (${row.qualifier})` : ''} – ${row.links} Links`
    );
  }
  for (const row of db
    .prepare(
      "SELECT alias, canonical, canonical_qualifier FROM entity_aliases WHERE type = 'persons' AND (canonical IN (?, ?) OR alias IN ('Carrigon', 'Wyfern', 'Carrigen', 'Karigen'))"
    )
    .all(KERRIGAN_NAME, KERIGAN_GNOME_NAME) as {
    alias: string;
    canonical: string;
    canonical_qualifier: string;
  }[]) {
    console.log(
      `alias: ${row.alias} -> ${row.canonical}${
        row.canonical_qualifier ? ` (${row.canonical_qualifier})` : ''
      }`
    );
  }
}

function main(): void {
  runMigrations();

  console.log(
    apply
      ? '=== Kerrigan-Fix: APPLY (Änderungen werden geschrieben) ===\n'
      : '=== Kerrigan-Fix: DRY RUN (Änderungen werden am Ende zurückgerollt) ===\n'
  );

  const runAll = (): void => {
    qualifyKerrigan();
    mergeIntoKerrigan('Carrigon');
    mergeIntoKerrigan('Wyfern');
    promoteGnomeCompanion();
    markSummariesDirty();
    if (apply) {
      // The result block reflects written changes; a dry run only announces
      // its plan and leaves the database untouched.
      report();
    }
  };

  if (apply) {
    runAll();
    return;
  }

  // Dry run: run every operation inside a real transaction and roll it back
  // by throwing a sentinel from within - the documented better-sqlite3 way
  // to abort a transaction. The database stays completely untouched.
  class RollbackSignal extends Error {}

  try {
    db.transaction(() => {
      runAll();
      throw new RollbackSignal();
    })();
  } catch (err) {
    if (!(err instanceof RollbackSignal)) throw err;
  }
  console.log('\n(Dry run – alle Änderungen wurden zurückgerollt.)');
}

main();
