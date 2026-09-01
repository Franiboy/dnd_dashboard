import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getModel } from './modelConfig.js';
import {
  getEntityKnowledgeEntry,
  listAllKnowledge,
  setEntityKnowledgeOrigin,
} from '../repositories/entityKnowledge.js';
import { getEntitySummary } from '../repositories/entitySummaries.js';
import { getCurrentGameDay } from '../repositories/gameTimeline.js';
import { stripHtml } from './rewrite.js';
import { createLogger } from '../logger.js';
import type { KnowledgeTarget, McpSessionUser } from '../mcp/tokens.js';
import type { EntityKnowledgeEntry, EntityType, KnowledgeOriginType } from '../../shared/types.js';

const log = createLogger('knowledge');

/** German singular label for an entity type, used in AI prompts and rules. */
function entityTypeLabel(type: EntityType): string {
  switch (type) {
    case 'persons':
      return 'Person';
    case 'organizations':
      return 'Organisation';
    case 'locations':
      return 'Ort';
    case 'items':
      return 'Gegenstand';
  }
}

/** Text a knowledge distribution run was derived from. */
export interface KnowledgeOrigin {
  type: KnowledgeOriginType;
  id: number;
}

interface DistributeResult {
  created: EntityKnowledgeEntry[];
  deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
  /** Active facts whose validity window ended during the run (timeline change). */
  ended: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
}

interface KnowledgeSnapshot {
  id: number;
  entityType: EntityType;
  entityName: string;
  status: 'active' | 'deleted';
  validUntil: number | null;
}

/** Shared options for the opencode-based knowledge flows. */
export interface KnowledgePromptOptions {
  model?: string;
  onLog?: (line: string) => void;
  /** Display-only provenance (diary entry / session the text came from). */
  origin?: KnowledgeOrigin;
  /** Acting user; scopes the searchable diary entries (admin sees all). */
  user?: McpSessionUser;
}

function takeKnowledgeSnapshot(): Map<number, KnowledgeSnapshot> {
  const rows = listAllKnowledge();
  const map = new Map<number, KnowledgeSnapshot>();
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      entityType: row.entityType,
      entityName: row.entityName,
      status: row.status,
      validUntil: row.validUntil,
    });
  }
  return map;
}

function computeDistributionDiff(
  before: Map<number, KnowledgeSnapshot>,
  after: EntityKnowledgeEntry[]
): DistributeResult {
  const afterById = new Map<number, EntityKnowledgeEntry>();
  for (const entry of after) afterById.set(entry.id, entry);

  const created: EntityKnowledgeEntry[] = [];
  const deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[] = [];
  const ended: { id: number; reason: string; entry: EntityKnowledgeEntry }[] = [];

  for (const [id, entry] of afterById) {
    if (!before.has(id)) {
      created.push(entry);
    }
  }

  for (const [id, beforeEntry] of before) {
    const afterEntry = afterById.get(id);
    if (beforeEntry.status === 'active' && afterEntry?.status === 'deleted') {
      deleted.push({ id, reason: afterEntry.statusReason || 'Widerspruch', entry: afterEntry });
      continue;
    }
    // An active fact was given an end of validity -> a sequenced timeline change.
    if (
      beforeEntry.status === 'active' &&
      afterEntry?.status === 'active' &&
      afterEntry.validUntil !== null &&
      afterEntry.validUntil !== beforeEntry.validUntil
    ) {
      ended.push({
        id,
        reason: afterEntry.statusReason || 'Ende der Gültigkeit',
        entry: afterEntry,
      });
    }
  }

  return { created, deleted, ended };
}

export async function distributeKnowledgeFromText(
  text: string,
  options: KnowledgePromptOptions = {}
): Promise<DistributeResult> {
  const { model, onLog, origin, user } = options;
  const plainText = stripHtml(text).trim();
  if (!plainText) return { created: [], deleted: [], ended: [] };

  const currentGameDay = getCurrentGameDay();

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Analysiere den folgenden Text und ordne die darin enthaltenen Fakten den passenden Entitäten zu.',
    '',
    `Der aktuelle Spieltag der Kampagne ist ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}. Nutze ihn als Bezugspunkt für zeitgebundene Fakten.`,
    '',
    'Verfügbare Tools:',
    '- get_entity(type, name, qualifier?): Liefert Zusammenfassung, aktuell gültiges Wissen, nicht mehr gültige Historie und verknüpfte Tagebucheinträge (mit Spieltag) zu einer Entität. MUSS verwendet werden, um bestehendes Wissen zu prüfen.',
    '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
    '- search_diary_entries(query, limit?): Durchsucht Tagebucheinträge nach einem Begriff, um Aussagen zu verifizieren.',
    '- get_diary_entry(entryId): Liefert einen vollständigen Tagebucheintrag.',
    '- get_previous_diary_entries(entryId, limit?): Liefert frühere Einträge desselben Autors.',
    '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Erstellt einen Wissenseintrag. validFrom/validUntil sind optionale Spieltage für zeitgebundene Fakten.',
    '- end_knowledge(id, until, reason?): Beendet einen aktiven Fakt ab einem Spieltag (war wahr, gilt ab dann nicht mehr) - für zeitliche Änderungen, nicht für Widerrufe.',
    '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch / trifft nie zu).',
    '',
    'Regeln:',
    '- DU MUSST vor dem Erstellen, Beenden oder Löschen von Wissen get_entity für jede im Text erwähnte Entität aufrufen, um bestehendes Wissen zu sehen (inkl. includeHistory=true, um beendete/gelöschte Einträge zu berücksichtigen).',
    '- Verifiziere zeitgebundene Aussagen gegen das Tagebuch: Suche mit search_diary_entries nach dem Ereignis und lese Treffer mit get_diary_entry vollständig, um zu bestimmen, wann etwas passiert ist (die verknüpften Einträge in get_entity zeigen den Spieltag).',
    '- Du siehst die Tagebucheinträge aller Spieler (gemeinsames Weltwissen) – nutze sie zur Verifikation.',
    '- Ordne jeden Fakt einer oder mehreren Entitäten zu.',
    '- Wenn eine Entität noch nicht existiert, wird sie automatisch durch create_knowledge angelegt.',
    '- Verwende die exakte Schreibweise aus der Datenbank, wenn eine passende Entität existiert.',
    '- Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), wähle anhand des Kontexts die richtige Entität und gib beim Aufruf von get_entity bzw. create_knowledge deren Qualifier an.',
    '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
    '- content ist der eigentliche Faktentext.',
    '- Ein Fakt kann mehreren Entitäten zugeordnet werden.',
    '- Extrahiere nur Fakten, die im Text tatsächlich vorkommen. Erfinke keine Details.',
    '- Halte jeden Fakt kurz und prägnant.',
    '- Wenn ein bestehender Eintrag unvollständig ist, ergänze ihn mit create_knowledge für dieselbe Entität.',
    '- Zeitgebundene Fakten (Beziehungen, Stimmungen, Zugehörigkeit, Ziele) bekommen ein Gültigkeitsfenster über validFrom/validUntil, immer bezogen auf den aktuellen Spieltag. Zeitliche Angaben im Text ("seit der Schlacht", "bis zum Fest", "inzwischen") werden dazu verwendet.',
    '- Zeitlose Fakten (z. B. "ist eine Elfe", Herkunft, Beruf) erhalten kein Fenster.',
    '- Wird ein bestehender aktiver Fakt durch eine zeitliche Änderung ersetzt ("stand X gut, jetzt nicht mehr"), beende den alten mit end_knowledge(id, until=<Spieltag>, reason) und erstelle den neuen mit validFrom=<Spieltag>.',
    '- validUntil ist EXKLUSIV: Der Fakt gilt bis einschließlich Spieltag (validUntil - 1) und ab validUntil nicht mehr. Endet ein Fakt am Spieltag X und beginnt der Ersatz mit validFrom=X, überlappen sich beide niemals.',
    '- Widerspricht ein neuer Fakt einem bestehenden Eintrag grundlegend (er war falsch, nicht nur überholt), lösche den alten mit delete_knowledge(id, reason) und erstelle einen neuen, korrekten Eintrag.',
    '- In delete_knowledge und end_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
    '',
    'Text:',
    plainText,
    '',
    'Speichere die Fakten direkt über die Tools, aber nur nachdem du das bestehende Wissen abgefragt hast. Wenn keine Fakten im Text enthalten sind, beende die Aufgabe ohne weitere Tool-Aufrufe.',
  ].join('\n');

  log.info(`Distributing knowledge from free text`);

  const snapshotBefore = takeKnowledgeSnapshot();

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-distribute-knowledge-${Date.now()}`,
    scopes: ['entity:read', 'knowledge:distribute', 'diary:read', 'diary:read-all'],
    user,
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter);

  // Record where the newly created entries came from (display-only provenance).
  if (origin && diff.created.length > 0) {
    const createdIds = diff.created.map((entry) => entry.id);
    setEntityKnowledgeOrigin(createdIds, origin.type, origin.id);
    diff.created = createdIds
      .map((id) => getEntityKnowledgeEntry(id))
      .filter((entry): entry is EntityKnowledgeEntry => entry !== null);
  }

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  if (!result.success) {
    log.warn(`Knowledge distribution failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [], ended: [] };
  }

  log.info(
    `Distributed ${diff.created.length} new entries, ended ${diff.ended.length} and marked ${diff.deleted.length} entries as deleted${
      origin ? ` from ${origin.type} #${origin.id}` : ''
    }`
  );
  return diff;
}

export interface KnowledgeCorrectionTarget {
  entityType: EntityType;
  entityName: string;
  entityQualifier?: string;
}

export interface CorrectedEntitySummary extends KnowledgeCorrectionTarget {
  summary: string | null;
  miniSummary: string | null;
}

export interface KnowledgeCorrectionResult extends DistributeResult {
  summaries: CorrectedEntitySummary[];
}

function targetKey(target: KnowledgeCorrectionTarget): string {
  return `${target.entityType}/${target.entityName.toLowerCase()}/${target.entityQualifier ?? ''}`;
}

export function collectAffectedEntities(
  focus: KnowledgeCorrectionTarget | null,
  result: DistributeResult
): KnowledgeCorrectionTarget[] {
  const targets = new Map<string, KnowledgeCorrectionTarget>();
  if (focus) {
    targets.set(targetKey(focus), focus);
  }
  for (const entry of [
    ...result.created,
    ...(result.deleted ?? []).map((d) => d.entry),
    ...(result.ended ?? []).map((d) => d.entry),
  ]) {
    const target = {
      entityType: entry.entityType,
      entityName: entry.entityName,
      entityQualifier: entry.entityQualifier ?? '',
    };
    if (!targets.has(targetKey(target))) {
      targets.set(targetKey(target), target);
    }
  }
  return [...targets.values()];
}

export async function correctKnowledgeFromText(
  correction: string,
  focus?: KnowledgeCorrectionTarget,
  options: KnowledgePromptOptions = {}
): Promise<KnowledgeCorrectionResult> {
  const { model, onLog, user } = options;
  const plainText = stripHtml(correction).trim();
  if (!plainText) return { created: [], deleted: [], ended: [], summaries: [] };

  const typeLabel = focus ? entityTypeLabel(focus.entityType) : null;

  const currentGameDay = getCurrentGameDay();

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Der Nutzer meldet einen Fehler im gespeicherten Wissen. Prüfe das betroffene Wissen gegen die Korrektur und berichtige es.',
    ...(typeLabel && focus
      ? [
          `Fokus-Entität: ${typeLabel} "${focus.entityName}" – ihr Wissen ist auf jeden Fall zu prüfen.`,
        ]
      : []),
    `Der aktuelle Spieltag der Kampagne ist ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}.`,
    '',
    'Verfügbare Tools:',
    '- get_entity(type, name, qualifier?): Liefert Zusammenfassung, aktuell gültiges Wissen, nicht mehr gültige Historie und verknüpfte Tagebucheinträge (mit Spieltag) zu einer Entität. MUSS verwendet werden, um bestehendes Wissen zu prüfen.',
    '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
    '- search_diary_entries(query, limit?): Durchsucht Tagebucheinträge nach einem Begriff, um Aussagen zu verifizieren.',
    '- get_diary_entry(entryId): Liefert einen vollständigen Tagebucheintrag.',
    '- get_previous_diary_entries(entryId, limit?): Liefert frühere Einträge desselben Autors.',
    '- get_session_summary(sessionId): Liefert kurze und lange Zusammenfassung einer Session (inkl. Transkript-Codes wie 000003, 696969).',
    '- get_previous_session_summaries(sessionId, limit?): Liefert vorherige Session-Zusammenfassungen (grob).',
    '- list_recent_sessions(limit?): Listet die letzten Sessions ohne bekannte ID auf (Einstieg für Session-Suche). Danach get_session_summary(sessionId) für Details.',
    '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Erstellt einen Wissenseintrag; validFrom/validUntil sind optionale Spieltage für zeitgebundene Fakten.',
    '- end_knowledge(id, until, reason?): Beendet einen aktiven Fakt ab einem Spieltag (zeitliche Änderung, bleibt als Historie).',
    '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch).',
    '',
    'Regeln:',
    '- DU MUSST vor dem Löschen, Beenden oder Erstellen get_entity für die Fokus-Entität und jede in der Korrektur erwähnte Entität aufrufen – am besten mit includeHistory=true, um auch beendete/gelöschte Einträge zu sehen.',
    '- Verifiziere Aussagen der Korrektur gegen Tagebuch UND grob gegen Sessions: Suche mit search_diary_entries nach dem Ereignis und lese Treffer mit get_diary_entry vollständig; ergänze mit list_recent_sessions / get_session_summary / get_previous_session_summaries für Session-Codes (z. B. Kreide 000003) und Transkript-Hinweise. Die verknüpften Einträge in get_entity zeigen den Spieltag, damit du "wann" etwas passiert ist bestimmen und Gültigkeitsfenster sauber setzen kannst.',
    '- Du siehst die Tagebucheinträge aller Spieler (gemeinsames Weltwissen) plus Session-Zusammenfassungen – nutze beides zur Verifikation, Diary gilt als primäre Quelle, Sessions als grobe Ergänzung.',
    '- Ist ein bestehender aktiver Eintrag nur überholt (zeitliche Änderung, z. B. "steht A nicht mehr gut"), beende ihn mit end_knowledge(id, until=<Spieltag>, reason) und erstelle den korrigierten Fakt mit validFrom=<Spieltag>.',
    '- validUntil ist EXKLUSIV: Der Fakt gilt bis einschließlich Spieltag (validUntil - 1) und ab validUntil nicht mehr. Endet ein Fakt am Spieltag X und beginnt der Ersatz mit validFrom=X, überlappen sich beide niemals.',
    '- Widerspricht ein Eintrag der Korrektur grundlegend (er war falsch), markiere ihn mit delete_knowledge(id, reason).',
    '- In delete_knowledge und end_knowledge muss reason kurz erklären, warum der Eintrag falsch bzw. beendet ist, mit Bezug zur Korrektur.',
    '- Erstelle mit create_knowledge die korrekten Fakten, die sich aus der Korrektur ergeben; setze bei zeitgebundenen Fakten das Gültigkeitsfenster.',
    '- Extrahiere nur Fakten, die in der Korrektur tatsächlich vorkommen. Erfinde keine Details.',
    '- Lasse Einträge unangetastet, die nicht von der Korrektur betroffen sind.',
    '- Verwende die exakte Schreibweise aus der Datenbank, wenn eine passende Entität existiert.',
    '- Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), wähle anhand des Kontexts die richtige Entität und gib deren Qualifier an.',
    '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
    '- Ein Fakt kann mehreren Entitäten zugeordnet werden.',
    '- In delete_knowledge und end_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
    '',
    'Korrektur:',
    plainText,
    '',
    'Speichere die Berichtigungen direkt über die Tools, aber nur nachdem du das bestehende Wissen abgefragt hast. Widerspricht nichts der Korrektur, erstelle nur fehlende korrigierte Fakten oder beende die Aufgabe ohne weitere Tool-Aufrufe.',
  ].join('\n');

  log.info('Correcting knowledge from free text');

  const snapshotBefore = takeKnowledgeSnapshot();

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-correct-knowledge-${Date.now()}`,
    scopes: [
      'entity:read',
      'knowledge:distribute',
      'diary:read',
      'diary:read-all',
      'recording:read',
    ],
    user,
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter);

  if (!result.success) {
    log.warn(`Knowledge correction failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [], ended: [], summaries: [] };
  }

  // Refresh summaries of every affected entity so corrections are visible immediately.
  const summaries: CorrectedEntitySummary[] = [];
  for (const target of collectAffectedEntities(focus ?? null, diff)) {
    const generated = await generateEntitySummary(target.entityType, target.entityName, {
      model,
      onLog,
      user,
      qualifier: target.entityQualifier ?? '',
      knowledgeTarget: {
        entityType: target.entityType,
        entityName: target.entityName,
        entityQualifier: target.entityQualifier ?? '',
      },
    });
    summaries.push({
      entityType: target.entityType,
      entityName: target.entityName,
      entityQualifier: target.entityQualifier ?? '',
      summary: generated?.summary ?? null,
      miniSummary: generated?.miniSummary ?? null,
    });
  }

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  log.info(
    `Corrected knowledge: created ${diff.created.length} entries, ended ${diff.ended.length} and marked ${diff.deleted.length} entries as deleted`
  );
  return { created: diff.created, deleted: diff.deleted, ended: diff.ended, summaries };
}

export interface KnowledgeReviewOptions {
  model?: string;
  onLog?: (line: string) => void;
  /** Acting user; scopes the searchable diary entries (admin sees all). */
  user?: McpSessionUser;
  /** Disambiguator for homonyms; '' targets the plain name. */
  qualifier?: string;
}

/**
 * Reviews the complete knowledge of a single entity against the players'
 * diary entries plus roughly against session summaries (shared world context): ends outdated facts, deletes
 * contradictions and adds corroborated facts that are missing, then refreshes
 * the affected entity summaries.
 */
export async function reviewEntityKnowledge(
  entityType: EntityType,
  entityName: string,
  options: KnowledgeReviewOptions = {}
): Promise<KnowledgeCorrectionResult> {
  const { model, onLog, user, qualifier = '' } = options;
  const typeLabel = entityTypeLabel(entityType);
  const qualifiedName = qualifier ? `${entityName} (${qualifier})` : entityName;
  const currentGameDay = getCurrentGameDay();

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Überprüfe das gesamte gespeicherte Wissen der Fokus-Entität darauf, ob es aktuell und stimmig ist, und berichtige es anhand der verfügbaren Kontext-Einträge (Tagebücher aller Spieler, Spieltage).',
    '',
    `Fokus-Entität: ${typeLabel} "${qualifiedName}".`,
    `Der aktuelle Spieltag der Kampagne ist ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}.`,
    '',
    'Verfügbare Tools:',
    `- get_entity(type="${entityType}", name="${entityName}"${
      qualifier ? `, qualifier="${qualifier}"` : ''
    }, includeHistory=true): Liefert Zusammenfassung, aktuell gültiges Wissen, nicht mehr gültige Historie und verknüpfte Tagebucheinträge (mit Spieltag) der Entität. MUSST du zuerst aufrufen.`,
    '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
    '- search_diary_entries(query, limit?): Durchsucht die Tagebucheinträge aller Spieler nach einem Begriff, um Aussagen zu verifizieren.',
    '- get_diary_entry(entryId): Liefert einen vollständigen Tagebucheintrag.',
    '- get_previous_diary_entries(entryId, limit?): Liefert frühere Einträge desselben Autors.',
    '- get_session_summary(sessionId): Liefert kurze und lange Zusammenfassung einer Session (inkl. Transkript-Codes wie 000003, 696969).',
    '- get_previous_session_summaries(sessionId, limit?): Liefert vorherige Session-Zusammenfassungen (grob).',
    '- list_recent_sessions(limit?): Listet die letzten Sessions ohne bekannte ID auf (Einstieg für Session-Suche). Danach get_session_summary(sessionId) für Details.',
    '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Erstellt einen Wissenseintrag; validFrom/validUntil sind optionale Spieltage für zeitgebundene Fakten.',
    '- end_knowledge(id, until, reason?): Beendet einen aktiven Fakt ab einem Spieltag (zeitliche Änderung, bleibt als Historie).',
    '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch).',
    '',
    'Vorgehen:',
    '1. Rufe get_entity für die Fokus-Entität auf (includeHistory=true), um das komplette Wissen inkl. Historie und die verknüpften Tagebucheinträge (mit Spieltag) zu sehen.',
    '2. Lies bei Bedarf die relevanten Kontext-Einträge vollständig: Tagebücher via search_diary_entries/get_diary_entry UND grob Sessions via list_recent_sessions / get_session_summary / get_previous_session_summaries (wichtig für Kreide-Codes, Transkript-Hinweise wie 000003, die nur in Sessions vorkommen), um den zeitlichen Verlauf und den aktuellen Stand der Entität zu verstehen.',
    '3. Gleiche jeden aktiven Wissenseintrag gegen diesen Kontext (Diary primär, Sessions grob ergänzend) ab:',
    '   - Zeitlich überholt (der Fakt stimmt, gilt aber seit einem Spieltag nicht mehr): beende ihn mit end_knowledge(id, until=<Spieltag>, reason).',
    '   - Grundsätzlich falsch (Widerspruch zum belegten Kontext): markiere ihn mit delete_knowledge(id, reason).',
    '   - Korrekt und aktuell: lasse ihn unangetastet.',
    '4. Ergänze mit create_knowledge Fakten, die durch den Kontext belegt sind und im gespeicherten Wissen fehlen; setze bei zeitgebundenen Fakten validFrom/validUntil anhand der Spieltage.',
    '   - Extrahiere nur Fakten, die tatsächlich durch die Kontext-Einträge belegt sind. Erfinde keine Details.',
    '5. Prüfe auch beendete/gelöschte Einträge: Hat sich der Zustand erneut geändert (z. B. lebt eine "verstorbene" Person doch wieder), lege den korrigierten Fakt neu mit passendem Gültigkeitsfenster an.',
    '',
    'Regeln:',
    '- Arbeite nur an der Fokus-Entität; ändere kein Wissen anderer Entitäten.',
    '- validUntil ist EXKLUSIV: Der Fakt gilt bis einschließlich Spieltag (validUntil - 1) und ab validUntil nicht mehr. Endet ein Fakt am Spieltag X und beginnt der Ersatz mit validFrom=X, überlappen sich beide niemals.',
    '- In delete_knowledge und end_knowledge muss reason kurz erklären, warum der Eintrag falsch bzw. beendet ist, mit Bezug zum belegten Kontext.',
    '- In delete_knowledge und end_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
    '- Verwende die exakte Schreibweise aus der Datenbank (Qualifier bei Namensgleichheit).',
    '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
    '',
    'Wenn das gesamte bestehende Wissen bereits korrekt und aktuell ist, beende die Aufgabe ohne weitere Tool-Aufrufe.',
  ].join('\n');

  log.info(`Reviewing knowledge for ${typeLabel}/${qualifiedName}`);

  const snapshotBefore = takeKnowledgeSnapshot();

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-review-knowledge-${Date.now()}`,
    scopes: [
      'entity:read',
      'knowledge:distribute',
      'diary:read',
      'diary:read-all',
      'recording:read',
    ],
    user,
    knowledgeTarget: { entityType, entityName, entityQualifier: qualifier },
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter);

  if (!result.success) {
    log.warn(`Knowledge review failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [], ended: [], summaries: [] };
  }

  // Refresh summaries of every affected entity so corrections are visible immediately.
  const summaries: CorrectedEntitySummary[] = [];
  for (const target of collectAffectedEntities(
    { entityType, entityName, entityQualifier: qualifier },
    diff
  )) {
    const generated = await generateEntitySummary(target.entityType, target.entityName, {
      model,
      onLog,
      user,
      qualifier: target.entityQualifier ?? '',
      knowledgeTarget: {
        entityType,
        entityName,
        entityQualifier: qualifier,
      },
    });
    summaries.push({
      entityType: target.entityType,
      entityName: target.entityName,
      entityQualifier: target.entityQualifier ?? '',
      summary: generated?.summary ?? null,
      miniSummary: generated?.miniSummary ?? null,
    });
  }

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  log.info(
    `Reviewed knowledge for ${typeLabel}/${qualifiedName}: created ${diff.created.length}, ended ${diff.ended.length}, deleted ${diff.deleted.length}`
  );
  return { created: diff.created, deleted: diff.deleted, ended: diff.ended, summaries };
}

export interface GeneratedEntitySummary {
  summary: string;
  miniSummary: string | null;
}

export interface EntitySummaryOptions {
  model?: string;
  onLog?: (line: string) => void;
  /** Acting user; scopes the searchable diary entries (admin sees all). */
  user?: McpSessionUser;
  /** Disambiguator for homonyms; '' targets the plain name. */
  qualifier?: string;
  /** Restricts summary writes to the requested entity. */
  knowledgeTarget?: KnowledgeTarget;
}

export async function generateEntitySummary(
  entityType: EntityType,
  entityName: string,
  options: EntitySummaryOptions = {}
): Promise<GeneratedEntitySummary | null> {
  const { model, onLog, user, qualifier = '', knowledgeTarget } = options;
  const typeLabel = entityTypeLabel(entityType);
  const qualifiedName = qualifier ? `${entityName} (${qualifier})` : entityName;

  const summaryRow = getEntitySummary(entityType, entityName, qualifier);
  const previousSummary = summaryRow?.summary
    ? `Vorherige Zusammenfassung (korrigiere oder erweitere sie bei Bedarf):\n${summaryRow.summary}\n\n`
    : '';

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Erstelle eine knappe, aber aussagekräftige Zusammenfassung für die ${typeLabel} "${qualifiedName}" und zusätzlich eine sehr kurze Mini-Zusammenfassung (1 Satz, maximal 150 Zeichen) für Tooltips.`,
    '',
    'Verfügbare Tools:',
    `- get_entity(type="${entityType}", name="${entityName}"${
      qualifier ? `, qualifier="${qualifier}"` : ''
    }): Liefert alle Informationen zur Entität. DU MUSST dieses Tool aufrufen, bevor du die Zusammenfassung erstellst.`,
    `- set_entity_summary(type="${entityType}", name="${entityName}", summary, miniSummary${
      qualifier ? `, qualifier="${qualifier}"` : ''
    }): Speichert die Zusammenfassung und Mini-Zusammenfassung. Verwende type und name (und qualifier, falls angegeben) genau so.`,
    '',
    'Regeln:',
    '- Rufe get_entity auf, um Wissen und verknüpfte Tagebucheinträge zu erhalten.',
    '- Beschreibe die wichtigsten Eigenschaften, Beziehungen und Ereignisse.',
    '- Vermeide Spekulation; nutze nur die gegebenen Informationen.',
    '- Korrigiere die vorherige Zusammenfassung, falls neue Informationen sie widerlegen.',
    '- Die normale Zusammenfassung soll maximal 3-5 Sätze haben.',
    '- Die Mini-Zusammenfassung soll 1 Satz mit maximal 150 Zeichen sein und ideal als Tooltip verwendet werden können.',
    '- Speichere beides zusammen mit set_entity_summary, nachdem du get_entity aufgerufen hast.',
    '',
    previousSummary,
    `Zusammenfassung für ${qualifiedName}:`,
  ].join('\n');

  log.info(`Generating summary for ${entityType}/${qualifiedName}`);

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-entity-summary-${entityType}-${entityName}-${Date.now()}`,
    scopes: ['entity:read', 'entity:summary', 'diary:read', 'diary:read-all'],
    user,
    knowledgeTarget,
    onLog,
  });

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  if (!result.success) {
    log.warn(
      `Summary generation failed for ${entityType}/${qualifiedName}: exitCode=${result.exitCode}`
    );
    return null;
  }

  const summaryRowAfter = getEntitySummary(entityType, entityName, qualifier);
  if (!summaryRowAfter?.summary) {
    log.warn(`No summary saved for ${entityType}/${qualifiedName}`);
    return null;
  }

  log.info(`Summary generated for ${entityType}/${qualifiedName}`);
  return {
    summary: summaryRowAfter.summary,
    miniSummary: summaryRowAfter.miniSummary,
  };
}
