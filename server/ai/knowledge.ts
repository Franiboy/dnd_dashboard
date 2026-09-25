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
import {
  resolveArcContextById,
  resolveDiaryEntryArcContext,
  resolveSessionArcContext,
} from './arcContext.js';
import { linkStoryArcEntity } from '../repositories/storyArcs.js';
import { findEntityCanonical } from '../repositories/diary.js';
import { createLogger } from '../logger.js';
import type { KnowledgeTarget, McpSessionUser } from '../mcp/tokens.js';
import type {
  EntityKnowledgeEntry,
  EntityType,
  KnowledgeOriginType,
  Language,
} from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

const log = createLogger('knowledge');

/** Localized singular label for an entity type, used in AI prompts and rules. */
export function entityTypeLabel(type: EntityType, language: Language = getAiLanguage()): string {
  switch (type) {
    case 'persons':
      return localize(language, 'Person', 'Person');
    case 'organizations':
      return localize(language, 'Organisation', 'Organization');
    case 'locations':
      return localize(language, 'Ort', 'Location');
    case 'items':
      return localize(language, 'Gegenstand', 'Item');
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
  /**
   * Explicit story-arc scope (e.g. chosen in the world dialog). The context
   * tools only see diary entries/sessions of this arc. When an origin is
   * given, the arc of the origin wins.
   */
  arcId?: number;
  /** Language captured once for all prompts in this operation. */
  language?: Language;
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
  after: EntityKnowledgeEntry[],
  language: Language
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
      deleted.push({
        id,
        reason: afterEntry.statusReason || localize(language, 'Widerspruch', 'Contradiction'),
        entry: afterEntry,
      });
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
        reason:
          afterEntry.statusReason || localize(language, 'Ende der Gültigkeit', 'End of validity'),
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
  const { model, onLog, origin, user, arcId: explicitArcId } = options;
  const runLanguage = options.language ?? getAiLanguage();
  const plainText = stripHtml(text).trim();
  if (!plainText) return { created: [], deleted: [], ended: [] };

  const currentGameDay = getCurrentGameDay();

  // Arc scope: the origin's arc wins over an explicitly chosen one.
  const arcContext = origin
    ? origin.type === 'diary'
      ? resolveDiaryEntryArcContext(origin.id, runLanguage)
      : resolveSessionArcContext(origin.id, runLanguage)
    : explicitArcId
      ? resolveArcContextById(explicitArcId, runLanguage)
      : null;

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      'Aufgabe: Analysiere den folgenden Text und ordne die darin enthaltenen Fakten den passenden Entitäten zu.',
      'Task: Analyze the following text and assign the facts it contains to the appropriate entities.'
    ),
    ...(arcContext?.promptLines ?? []),
    '',
    t(
      `Der aktuelle Spieltag der Kampagne ist ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}. Nutze ihn als Bezugspunkt für zeitgebundene Fakten.`,
      `The current campaign game day is ${currentGameDay ?? 'unknown (no game day has been set yet)'}. Use it as the reference point for time-bound facts.`
    ),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      '- get_entity(type, name, qualifier?): Liefert Zusammenfassung, aktuell gültiges Wissen, nicht mehr gültige Historie und verknüpfte Tagebucheinträge (mit Spieltag) zu einer Entität. MUSS verwendet werden, um bestehendes Wissen zu prüfen.',
      '- get_entity(type, name, qualifier?): Returns the summary, currently valid knowledge, no-longer-valid history, and linked diary entries (with game day) for an entity. It MUST be used to check existing knowledge.'
    ),
    t(
      '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
      '- list_entities(type?): Lists all known entities, including qualifiers (to distinguish namesakes).'
    ),
    t(
      '- search_diary_entries(query, limit?): Durchsucht Tagebucheinträge nach einem Begriff, um Aussagen zu verifizieren.',
      '- search_diary_entries(query, limit?): Searches diary entries for a term to verify claims.'
    ),
    t(
      '- get_diary_entry(entryId): Liefert einen vollständigen Tagebucheintrag.',
      '- get_diary_entry(entryId): Returns a complete diary entry.'
    ),
    t(
      '- get_previous_diary_entries(entryId, limit?): Liefert frühere Einträge desselben Autors.',
      '- get_previous_diary_entries(entryId, limit?): Returns earlier entries by the same author.'
    ),
    t(
      '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Erstellt einen Wissenseintrag. validFrom/validUntil sind optionale Spieltage für zeitgebundene Fakten.',
      '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Creates a knowledge entry. validFrom/validUntil are optional game days for time-bound facts.'
    ),
    t(
      '- end_knowledge(id, until, reason?): Beendet einen aktiven Fakt ab einem Spieltag (war wahr, gilt ab dann nicht mehr) - für zeitliche Änderungen, nicht für Widerrufe.',
      '- end_knowledge(id, until, reason?): Ends an active fact from a game day onward (it was true and is no longer true afterward); use this for changes over time, not retractions.'
    ),
    t(
      '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch / trifft nie zu).',
      '- delete_knowledge(id, reason?): Marks a knowledge entry as deleted (retraction: the fact was false or never applied).'
    ),
    '',
    t('Regeln:', 'Rules:'),
    t(
      '- DU MUSST vor dem Erstellen, Beenden oder Löschen von Wissen get_entity für jede im Text erwähnte Entität aufrufen, um bestehendes Wissen zu sehen (inkl. includeHistory=true, um beendete/gelöschte Einträge zu berücksichtigen).',
      '- BEFORE creating, ending, or deleting knowledge, you MUST call get_entity for every entity mentioned in the text to inspect existing knowledge (including includeHistory=true so ended or deleted entries are considered).'
    ),
    t(
      '- Verifiziere zeitgebundene Aussagen gegen das Tagebuch: Suche mit search_diary_entries nach dem Ereignis und lese Treffer mit get_diary_entry vollständig, um zu bestimmen, wann etwas passiert ist (die verknüpften Einträge in get_entity zeigen den Spieltag).',
      '- Verify time-bound claims against the diary: search for the event with search_diary_entries and read matching entries completely with get_diary_entry to determine when it happened (linked entries from get_entity show the game day).'
    ),
    t(
      '- Du siehst die Tagebucheinträge aller Spieler (gemeinsames Weltwissen) – nutze sie zur Verifikation.',
      "- You can see every player's diary entries (shared world knowledge); use them for verification."
    ),
    t(
      '- Ordne jeden Fakt einer oder mehreren Entitäten zu.',
      '- Assign each fact to one or more entities.'
    ),
    t(
      '- Wenn eine Entität noch nicht existiert, wird sie automatisch durch create_knowledge angelegt.',
      '- If an entity does not exist yet, create_knowledge creates it automatically.'
    ),
    t(
      '- Verwende die exakte Schreibweise aus der Datenbank, wenn eine passende Entität existiert.',
      '- Use the exact database spelling when a matching entity exists.'
    ),
    t(
      '- Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), wähle anhand des Kontexts die richtige Entität und gib beim Aufruf von get_entity bzw. create_knowledge deren Qualifier an.',
      '- If several entities have the same name (list_entities shows different qualifiers), choose the correct one from the context and provide its qualifier when calling get_entity or create_knowledge.'
    ),
    t(
      '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
      '- title is optional and should be a category such as "Affiliation", "Relationships", "Origin", "Occupation", "Goals", or "Notes".'
    ),
    t('- content ist der eigentliche Faktentext.', '- content is the fact text itself.'),
    t(
      '- Ein Fakt kann mehreren Entitäten zugeordnet werden.',
      '- One fact may be assigned to several entities.'
    ),
    t(
      '- Extrahiere nur Fakten, die im Text tatsächlich vorkommen. Erfinke keine Details.',
      '- Extract only facts that actually occur in the text. Do not invent details.'
    ),
    t('- Halte jeden Fakt kurz und prägnant.', '- Keep every fact short and concise.'),
    t(
      '- Wenn ein bestehender Eintrag unvollständig ist, ergänze ihn mit create_knowledge für dieselbe Entität.',
      '- If an existing entry is incomplete, supplement it with create_knowledge for the same entity.'
    ),
    t(
      '- Zeitgebundene Fakten (Beziehungen, Stimmungen, Zugehörigkeit, Ziele) bekommen ein Gültigkeitsfenster über validFrom/validUntil, immer bezogen auf den aktuellen Spieltag. Zeitliche Angaben im Text ("seit der Schlacht", "bis zum Fest", "inzwischen") werden dazu verwendet.',
      '- Time-bound facts (relationships, moods, affiliations, goals) receive a validity window through validFrom/validUntil, always relative to the current game day. Use temporal expressions in the text ("since the battle", "until the festival", "meanwhile") for this.'
    ),
    t(
      '- Zeitlose Fakten (z. B. "ist eine Elfe", Herkunft, Beruf) erhalten kein Fenster.',
      '- Timeless facts (for example, "is an elf", origin, occupation) receive no window.'
    ),
    t(
      '- Wird ein bestehender aktiver Fakt durch eine zeitliche Änderung ersetzt ("stand X gut, jetzt nicht mehr"), beende den alten mit end_knowledge(id, until=<Spieltag>, reason) und erstelle den neuen mit validFrom=<Spieltag>.',
      '- If a time change replaces an existing active fact ("X used to be friendly, but no longer is"), end the old fact with end_knowledge(id, until=<game day>, reason) and create the new one with validFrom=<game day>.'
    ),
    t(
      '- validUntil ist EXKLUSIV: Der Fakt gilt bis einschließlich Spieltag (validUntil - 1) und ab validUntil nicht mehr. Endet ein Fakt am Spieltag X und beginnt der Ersatz mit validFrom=X, überlappen sich beide niemals.',
      '- validUntil is EXCLUSIVE: the fact holds through game day (validUntil - 1) and no longer applies from validUntil onward. If a fact ends on game day X and its replacement starts with validFrom=X, they never overlap.'
    ),
    t(
      '- Widerspricht ein neuer Fakt einem bestehenden Eintrag grundlegend (er war falsch, nicht nur überholt), lösche den alten mit delete_knowledge(id, reason) und erstelle einen neuen, korrekten Eintrag.',
      '- If a new fact fundamentally contradicts an existing entry (it was false, not merely outdated), delete the old entry with delete_knowledge(id, reason) and create a new correct entry.'
    ),
    t(
      '- In delete_knowledge und end_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
      '- delete_knowledge and end_knowledge may use only IDs from existing knowledge.'
    ),
    '',
    t('Text:', 'Text:'),
    plainText,
    '',
    t(
      'Speichere die Fakten direkt über die Tools, aber nur nachdem du das bestehende Wissen abgefragt hast. Wenn keine Fakten im Text enthalten sind, beende die Aufgabe ohne weitere Tool-Aufrufe.',
      'Save the facts directly through the tools, but only after querying the existing knowledge. If the text contains no facts, finish without further tool calls.'
    ),
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
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter, runLanguage);

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

  // Story-arc bookkeeping: entities touched by this run are additively filed
  // into the origin arc so the world filter keeps up with new knowledge.
  if (arcContext) {
    linkTargetsToArc(arcContext.arcId, collectAffectedEntities(null, diff));
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

/**
 * Files the affected entities of a knowledge run into the story arc. Names are
 * resolved canonically against the entity tables first: knowledge rows may
 * carry spellings that differ from the entity row, and the identity-based
 * link table must not grow ghost identities.
 */
function linkTargetsToArc(arcId: number, targets: KnowledgeCorrectionTarget[]): void {
  for (const target of targets) {
    const canonical = findEntityCanonical(
      target.entityType,
      target.entityName,
      target.entityQualifier ?? ''
    );
    if (!canonical) continue;
    linkStoryArcEntity(arcId, target.entityType, canonical);
  }
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
  const { model, onLog, user, arcId } = options;
  const runLanguage = options.language ?? getAiLanguage();
  const plainText = stripHtml(correction).trim();
  if (!plainText) return { created: [], deleted: [], ended: [], summaries: [] };

  const typeLabel = focus ? entityTypeLabel(focus.entityType, runLanguage) : null;
  const arcContext = arcId ? resolveArcContextById(arcId, runLanguage) : null;

  const currentGameDay = getCurrentGameDay();

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      'Aufgabe: Der Nutzer meldet einen Fehler im gespeicherten Wissen. Prüfe das betroffene Wissen gegen die Korrektur und berichtige es.',
      'Task: The user reports an error in stored knowledge. Check the affected knowledge against the correction and correct it.'
    ),
    ...(typeLabel && focus
      ? [
          t(
            `Fokus-Entität: ${typeLabel} "${focus.entityName}" – ihr Wissen ist auf jeden Fall zu prüfen.`,
            `Focus entity: ${typeLabel} "${focus.entityName}" – its knowledge must be checked.`
          ),
        ]
      : []),
    ...(arcContext?.promptLines ?? []),
    t(
      `Der aktuelle Spieltag der Kampagne ist ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}.`,
      `The current campaign game day is ${currentGameDay ?? 'unknown (no game day has been set yet)'}.`
    ),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      '- get_entity(type, name, qualifier?): Liefert Zusammenfassung, aktuell gültiges Wissen, nicht mehr gültige Historie und verknüpfte Tagebucheinträge (mit Spieltag) zu einer Entität. MUSS verwendet werden, um bestehendes Wissen zu prüfen.',
      '- get_entity(type, name, qualifier?): Returns the summary, currently valid knowledge, no-longer-valid history, and linked diary entries (with game day) for an entity. It MUST be used to check existing knowledge.'
    ),
    t(
      '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
      '- list_entities(type?): Lists all known entities, including qualifiers (to distinguish namesakes).'
    ),
    t(
      '- search_diary_entries(query, limit?): Durchsucht Tagebucheinträge nach einem Begriff, um Aussagen zu verifizieren.',
      '- search_diary_entries(query, limit?): Searches diary entries for a term to verify claims.'
    ),
    t(
      '- get_diary_entry(entryId): Liefert einen vollständigen Tagebucheintrag.',
      '- get_diary_entry(entryId): Returns a complete diary entry.'
    ),
    t(
      '- get_previous_diary_entries(entryId, limit?): Liefert frühere Einträge desselben Autors.',
      '- get_previous_diary_entries(entryId, limit?): Returns earlier entries by the same author.'
    ),
    t(
      '- get_session_summary(sessionId): Liefert kurze und lange Zusammenfassung einer Session (inkl. Transkript-Codes wie 000003, 696969).',
      '- get_session_summary(sessionId): Returns the short and long summary of a session (including transcript codes such as 000003 and 696969).'
    ),
    t(
      '- get_previous_session_summaries(sessionId, limit?): Liefert vorherige Session-Zusammenfassungen (grob).',
      '- get_previous_session_summaries(sessionId, limit?): Returns previous session summaries (brief).'
    ),
    t(
      '- list_recent_sessions(limit?): Listet die letzten Sessions ohne bekannte ID auf (Einstieg für Session-Suche). Danach get_session_summary(sessionId) für Details.',
      '- list_recent_sessions(limit?): Lists recent sessions without a known ID (an entry point for session searches). Then use get_session_summary(sessionId) for details.'
    ),
    t(
      '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Erstellt einen Wissenseintrag; validFrom/validUntil sind optionale Spieltage für zeitgebundene Fakten.',
      '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Creates a knowledge entry; validFrom/validUntil are optional game days for time-bound facts.'
    ),
    t(
      '- end_knowledge(id, until, reason?): Beendet einen aktiven Fakt ab einem Spieltag (zeitliche Änderung, bleibt als Historie).',
      '- end_knowledge(id, until, reason?): Ends an active fact from a game day onward (a change over time, retained as history).'
    ),
    t(
      '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch).',
      '- delete_knowledge(id, reason?): Marks a knowledge entry as deleted (retraction: the fact was false).'
    ),
    '',
    t('Regeln:', 'Rules:'),
    t(
      '- DU MUSST vor dem Löschen, Beenden oder Erstellen get_entity für die Fokus-Entität und jede in der Korrektur erwähnte Entität aufrufen – am besten mit includeHistory=true, um auch beendete/gelöschte Einträge zu sehen.',
      '- BEFORE deleting, ending, or creating, you MUST call get_entity for the focus entity and every entity mentioned in the correction; preferably use includeHistory=true so ended or deleted entries are also visible.'
    ),
    t(
      '- Verifiziere Aussagen der Korrektur gegen Tagebuch UND grob gegen Sessions: Suche mit search_diary_entries nach dem Ereignis und lese Treffer mit get_diary_entry vollständig; ergänze mit list_recent_sessions / get_session_summary / get_previous_session_summaries für Session-Codes (z. B. Kreide 000003) und Transkript-Hinweise. Die verknüpften Einträge in get_entity zeigen den Spieltag, damit du "wann" etwas passiert ist bestimmen und Gültigkeitsfenster sauber setzen kannst.',
      '- Verify the correction against the diary AND approximately against sessions: search for the event with search_diary_entries and read matches completely with get_diary_entry; supplement with list_recent_sessions / get_session_summary / get_previous_session_summaries for session codes (for example, chalk code 000003) and transcript hints. Linked entries from get_entity show the game day, allowing you to determine "when" something happened and set validity windows correctly.'
    ),
    t(
      '- Du siehst die Tagebucheinträge aller Spieler (gemeinsames Weltwissen) plus Session-Zusammenfassungen – nutze beides zur Verifikation, Diary gilt als primäre Quelle, Sessions als grobe Ergänzung.',
      "- You can see every player's diary entries (shared world knowledge) plus session summaries; use both for verification, treating the diary as the primary source and sessions as a rough supplement."
    ),
    t(
      '- Ist ein bestehender aktiver Eintrag nur überholt (zeitliche Änderung, z. B. "steht A nicht mehr gut"), beende ihn mit end_knowledge(id, until=<Spieltag>, reason) und erstelle den korrigierten Fakt mit validFrom=<Spieltag>.',
      '- If an existing active entry is merely outdated (a change over time, for example, "no longer gets along with A"), end it with end_knowledge(id, until=<game day>, reason) and create the corrected fact with validFrom=<game day>.'
    ),
    t(
      '- validUntil ist EXKLUSIV: Der Fakt gilt bis einschließlich Spieltag (validUntil - 1) und ab validUntil nicht mehr. Endet ein Fakt am Spieltag X und beginnt der Ersatz mit validFrom=X, überlappen sich beide niemals.',
      '- validUntil is EXCLUSIVE: the fact holds through game day (validUntil - 1) and no longer applies from validUntil onward. If a fact ends on game day X and its replacement starts with validFrom=X, they never overlap.'
    ),
    t(
      '- Widerspricht ein Eintrag der Korrektur grundlegend (er war falsch), markiere ihn mit delete_knowledge(id, reason).',
      '- If an entry fundamentally contradicts the correction (it was false), mark it with delete_knowledge(id, reason).'
    ),
    t(
      '- In delete_knowledge und end_knowledge muss reason kurz erklären, warum der Eintrag falsch bzw. beendet ist, mit Bezug zur Korrektur.',
      '- In delete_knowledge and end_knowledge, reason must briefly explain why the entry is false or ended, with reference to the correction.'
    ),
    t(
      '- Erstelle mit create_knowledge die korrekten Fakten, die sich aus der Korrektur ergeben; setze bei zeitgebundenen Fakten das Gültigkeitsfenster.',
      '- Use create_knowledge to create the correct facts resulting from the correction; set the validity window for time-bound facts.'
    ),
    t(
      '- Extrahiere nur Fakten, die in der Korrektur tatsächlich vorkommen. Erfinde keine Details.',
      '- Extract only facts that actually occur in the correction. Do not invent details.'
    ),
    t(
      '- Lasse Einträge unangetastet, die nicht von der Korrektur betroffen sind.',
      '- Leave entries unaffected by the correction untouched.'
    ),
    t(
      '- Verwende die exakte Schreibweise aus der Datenbank, wenn eine passende Entität existiert.',
      '- Use the exact database spelling when a matching entity exists.'
    ),
    t(
      '- Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), wähle anhand des Kontexts die richtige Entität und gib deren Qualifier an.',
      '- If several entities have the same name (list_entities shows different qualifiers), choose the correct one from the context and provide its qualifier.'
    ),
    t(
      '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
      '- title is optional and should be a category such as "Affiliation", "Relationships", "Origin", "Occupation", "Goals", or "Notes".'
    ),
    t(
      '- Ein Fakt kann mehreren Entitäten zugeordnet werden.',
      '- One fact may be assigned to several entities.'
    ),
    t(
      '- In delete_knowledge und end_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
      '- delete_knowledge and end_knowledge may use only IDs from existing knowledge.'
    ),
    '',
    t('Korrektur:', 'Correction:'),
    plainText,
    '',
    t(
      'Speichere die Berichtigungen direkt über die Tools, aber nur nachdem du das bestehende Wissen abgefragt hast. Widerspricht nichts der Korrektur, erstelle nur fehlende korrigierte Fakten oder beende die Aufgabe ohne weitere Tool-Aufrufe.',
      'Save the corrections directly through the tools, but only after querying the existing knowledge. If nothing contradicts the correction, create only missing corrected facts or finish without further tool calls.'
    ),
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
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter, runLanguage);

  if (!result.success) {
    log.warn(`Knowledge correction failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [], ended: [], summaries: [] };
  }

  // Story-arc bookkeeping: entities touched by this correction are additively
  // filed into the chosen arc so the world filter keeps up.
  if (arcContext) {
    linkTargetsToArc(arcContext.arcId, collectAffectedEntities(focus ?? null, diff));
  }

  // Refresh summaries of every affected entity so corrections are visible immediately.
  const summaries: CorrectedEntitySummary[] = [];
  for (const target of collectAffectedEntities(focus ?? null, diff)) {
    const generated = await generateEntitySummary(target.entityType, target.entityName, {
      model,
      onLog,
      user,
      qualifier: target.entityQualifier ?? '',
      language: runLanguage,
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
  /** Optional story-arc scope so the review does not scan the whole campaign. */
  arcId?: number;
  /** Language captured once for the review and its follow-up summaries. */
  language?: Language;
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
  const { model, onLog, user, qualifier = '', arcId } = options;
  const runLanguage = options.language ?? getAiLanguage();
  const typeLabel = entityTypeLabel(entityType, runLanguage);
  const qualifiedName = qualifier ? `${entityName} (${qualifier})` : entityName;
  const arcContext = arcId ? resolveArcContextById(arcId, runLanguage) : null;
  const currentGameDay = getCurrentGameDay();

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      'Aufgabe: Überprüfe das gesamte gespeicherte Wissen der Fokus-Entität darauf, ob es aktuell und stimmig ist, und berichtige es anhand der verfügbaren Kontext-Einträge (Tagebücher aller Spieler, Spieltage).',
      "Task: Check all stored knowledge for the focus entity for currency and consistency, then correct it using the available context (all players' diaries and game days)."
    ),
    '',
    t(
      `Fokus-Entität: ${typeLabel} "${qualifiedName}".`,
      `Focus entity: ${typeLabel} "${qualifiedName}".`
    ),
    ...(arcContext?.promptLines ?? []),
    t(
      `Der aktuelle Spieltag der Kampagne ist ${currentGameDay ?? 'unbekannt (noch kein Spieltag gesetzt)'}.`,
      `The current campaign game day is ${currentGameDay ?? 'unknown (no game day has been set yet)'}.`
    ),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      `- get_entity(type="${entityType}", name="${entityName}"${
        qualifier ? `, qualifier="${qualifier}"` : ''
      }, includeHistory=true): Liefert Zusammenfassung, aktuell gültiges Wissen, nicht mehr gültige Historie und verknüpfte Tagebucheinträge (mit Spieltag) der Entität. MUSST du zuerst aufrufen.`,
      `- get_entity(type="${entityType}", name="${entityName}"${
        qualifier ? `, qualifier="${qualifier}"` : ''
      }, includeHistory=true): Returns the summary, currently valid knowledge, no-longer-valid history, and linked diary entries (with game day) for the entity. You MUST call this first.`
    ),
    t(
      '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
      '- list_entities(type?): Lists all known entities, including qualifiers (to distinguish namesakes).'
    ),
    t(
      '- search_diary_entries(query, limit?): Durchsucht die Tagebucheinträge aller Spieler nach einem Begriff, um Aussagen zu verifizieren.',
      "- search_diary_entries(query, limit?): Searches every player's diary entries for a term to verify claims."
    ),
    t(
      '- get_diary_entry(entryId): Liefert einen vollständigen Tagebucheintrag.',
      '- get_diary_entry(entryId): Returns a complete diary entry.'
    ),
    t(
      '- get_previous_diary_entries(entryId, limit?): Liefert frühere Einträge desselben Autors.',
      '- get_previous_diary_entries(entryId, limit?): Returns earlier entries by the same author.'
    ),
    t(
      '- get_session_summary(sessionId): Liefert kurze und lange Zusammenfassung einer Session (inkl. Transkript-Codes wie 000003, 696969).',
      '- get_session_summary(sessionId): Returns the short and long summary of a session (including transcript codes such as 000003 and 696969).'
    ),
    t(
      '- get_previous_session_summaries(sessionId, limit?): Liefert vorherige Session-Zusammenfassungen (grob).',
      '- get_previous_session_summaries(sessionId, limit?): Returns previous session summaries (brief).'
    ),
    t(
      '- list_recent_sessions(limit?): Listet die letzten Sessions ohne bekannte ID auf (Einstieg für Session-Suche). Danach get_session_summary(sessionId) für Details.',
      '- list_recent_sessions(limit?): Lists recent sessions without a known ID (an entry point for session searches). Then use get_session_summary(sessionId) for details.'
    ),
    t(
      '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Erstellt einen Wissenseintrag; validFrom/validUntil sind optionale Spieltage für zeitgebundene Fakten.',
      '- create_knowledge(type, name, content, title?, qualifier?, validFrom?, validUntil?): Creates a knowledge entry; validFrom/validUntil are optional game days for time-bound facts.'
    ),
    t(
      '- end_knowledge(id, until, reason?): Beendet einen aktiven Fakt ab einem Spieltag (zeitliche Änderung, bleibt als Historie).',
      '- end_knowledge(id, until, reason?): Ends an active fact from a game day onward (a change over time, retained as history).'
    ),
    t(
      '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht (Widerruf: der Fakt war falsch).',
      '- delete_knowledge(id, reason?): Marks a knowledge entry as deleted (retraction: the fact was false).'
    ),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      '1. Rufe get_entity für die Fokus-Entität auf (includeHistory=true), um das komplette Wissen inkl. Historie und die verknüpften Tagebucheinträge (mit Spieltag) zu sehen.',
      '1. Call get_entity for the focus entity (includeHistory=true) to see all knowledge, its history, and linked diary entries (with game day).'
    ),
    t(
      '2. Lies bei Bedarf die relevanten Kontext-Einträge vollständig: Tagebücher via search_diary_entries/get_diary_entry UND grob Sessions via list_recent_sessions / get_session_summary / get_previous_session_summaries (wichtig für Kreide-Codes, Transkript-Hinweise wie 000003, die nur in Sessions vorkommen), um den zeitlichen Verlauf und den aktuellen Stand der Entität zu verstehen.',
      "2. As needed, read the relevant context entries completely: diaries via search_diary_entries/get_diary_entry AND sessions approximately via list_recent_sessions / get_session_summary / get_previous_session_summaries (important for chalk codes and transcript hints such as 000003 that occur only in sessions), to understand the timeline and the entity's current state."
    ),
    t(
      '3. Gleiche jeden aktiven Wissenseintrag gegen diesen Kontext (Diary primär, Sessions grob ergänzend) ab:',
      '3. Compare every active knowledge entry with this context (diary first, sessions as a rough supplement):'
    ),
    t(
      '   - Zeitlich überholt (der Fakt stimmt, gilt aber seit einem Spieltag nicht mehr): beende ihn mit end_knowledge(id, until=<Spieltag>, reason).',
      '   - Outdated over time (the fact is true but has not applied since a game day): end it with end_knowledge(id, until=<game day>, reason).'
    ),
    t(
      '   - Grundsätzlich falsch (Widerspruch zum belegten Kontext): markiere ihn mit delete_knowledge(id, reason).',
      '   - Fundamentally false (contradicted by the documented context): mark it with delete_knowledge(id, reason).'
    ),
    t(
      '   - Korrekt und aktuell: lasse ihn unangetastet.',
      '   - Correct and current: leave it untouched.'
    ),
    t(
      '4. Ergänze mit create_knowledge Fakten, die durch den Kontext belegt sind und im gespeicherten Wissen fehlen; setze bei zeitgebundenen Fakten validFrom/validUntil anhand der Spieltage.',
      '4. Add with create_knowledge facts supported by the context but missing from stored knowledge; set validFrom/validUntil for time-bound facts according to the game days.'
    ),
    t(
      '   - Extrahiere nur Fakten, die tatsächlich durch die Kontext-Einträge belegt sind. Erfinde keine Details.',
      '   - Extract only facts actually supported by the context entries. Do not invent details.'
    ),
    t(
      '5. Prüfe auch beendete/gelöschte Einträge: Hat sich der Zustand erneut geändert (z. B. lebt eine "verstorbene" Person doch wieder), lege den korrigierten Fakt neu mit passendem Gültigkeitsfenster an.',
      '5. Also check ended/deleted entries: if the state has changed again (for example, a "deceased" person is alive again), recreate the corrected fact with an appropriate validity window.'
    ),
    '',
    t('Regeln:', 'Rules:'),
    t(
      '- Arbeite nur an der Fokus-Entität; ändere kein Wissen anderer Entitäten.',
      '- Work only on the focus entity; do not change knowledge for other entities.'
    ),
    t(
      '- validUntil ist EXKLUSIV: Der Fakt gilt bis einschließlich Spieltag (validUntil - 1) und ab validUntil nicht mehr. Endet ein Fakt am Spieltag X und beginnt der Ersatz mit validFrom=X, überlappen sich beide niemals.',
      '- validUntil is EXCLUSIVE: the fact holds through game day (validUntil - 1) and no longer applies from validUntil onward. If a fact ends on game day X and its replacement starts with validFrom=X, they never overlap.'
    ),
    t(
      '- In delete_knowledge und end_knowledge muss reason kurz erklären, warum der Eintrag falsch bzw. beendet ist, mit Bezug zum belegten Kontext.',
      '- In delete_knowledge and end_knowledge, reason must briefly explain why the entry is false or ended, with reference to the documented context.'
    ),
    t(
      '- In delete_knowledge und end_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
      '- delete_knowledge and end_knowledge may use only IDs from existing knowledge.'
    ),
    t(
      '- Verwende die exakte Schreibweise aus der Datenbank (Qualifier bei Namensgleichheit).',
      '- Use the exact database spelling (including the qualifier for namesakes).'
    ),
    t(
      '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
      '- title is optional and should be a category such as "Affiliation", "Relationships", "Origin", "Occupation", "Goals", or "Notes".'
    ),
    '',
    t(
      'Wenn das gesamte bestehende Wissen bereits korrekt und aktuell ist, beende die Aufgabe ohne weitere Tool-Aufrufe.',
      'If all existing knowledge is already correct and current, finish without further tool calls.'
    ),
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
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter, runLanguage);

  if (!result.success) {
    log.warn(`Knowledge review failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [], ended: [], summaries: [] };
  }

  // Story-arc bookkeeping: entities touched by this review are additively
  // filed into the chosen arc so the world filter keeps up.
  if (arcContext) {
    linkTargetsToArc(
      arcContext.arcId,
      collectAffectedEntities({ entityType, entityName, entityQualifier: qualifier }, diff)
    );
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
      language: runLanguage,
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
  /** Language captured once for this summary run. */
  language?: Language;
}

export async function generateEntitySummary(
  entityType: EntityType,
  entityName: string,
  options: EntitySummaryOptions = {}
): Promise<GeneratedEntitySummary | null> {
  const { model, onLog, user, qualifier = '', knowledgeTarget } = options;
  const runLanguage = options.language ?? getAiLanguage();
  const typeLabel = entityTypeLabel(entityType, runLanguage);
  const qualifiedName = qualifier ? `${entityName} (${qualifier})` : entityName;

  const summaryRow = getEntitySummary(entityType, entityName, qualifier);
  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const previousSummary = summaryRow?.summary
    ? `${t(
        'Vorherige Zusammenfassung (korrigiere oder erweitere sie bei Bedarf):',
        'Previous summary (correct or expand it if needed):'
      )}\n${summaryRow.summary}\n\n`
    : '';

  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Erstelle eine knappe, aber aussagekräftige Zusammenfassung für die ${typeLabel} "${qualifiedName}" und zusätzlich eine sehr kurze Mini-Zusammenfassung (1 Satz, maximal 150 Zeichen) für Tooltips.`,
      `Task: Create a concise but informative summary for the ${typeLabel} "${qualifiedName}" and also a very short mini-summary (one sentence, at most 150 characters) for tooltips.`
    ),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      `- get_entity(type="${entityType}", name="${entityName}"${
        qualifier ? `, qualifier="${qualifier}"` : ''
      }): Liefert alle Informationen zur Entität. DU MUSST dieses Tool aufrufen, bevor du die Zusammenfassung erstellst.`,
      `- get_entity(type="${entityType}", name="${entityName}"${
        qualifier ? `, qualifier="${qualifier}"` : ''
      }): Returns all information about the entity. You MUST call this tool before creating the summary.`
    ),
    t(
      `- set_entity_summary(type="${entityType}", name="${entityName}", summary, miniSummary${
        qualifier ? `, qualifier="${qualifier}"` : ''
      }): Speichert die Zusammenfassung und Mini-Zusammenfassung. Verwende type und name (und qualifier, falls angegeben) genau so.`,
      `- set_entity_summary(type="${entityType}", name="${entityName}", summary, miniSummary${
        qualifier ? `, qualifier="${qualifier}"` : ''
      }): Saves the summary and mini-summary. Use type and name (and qualifier, if provided) exactly as written.`
    ),
    '',
    t('Regeln:', 'Rules:'),
    t(
      '- Rufe get_entity auf, um Wissen und verknüpfte Tagebucheinträge zu erhalten.',
      '- Call get_entity to obtain knowledge and linked diary entries.'
    ),
    t(
      '- Beschreibe die wichtigsten Eigenschaften, Beziehungen und Ereignisse.',
      '- Describe the most important characteristics, relationships, and events.'
    ),
    t(
      '- Vermeide Spekulation; nutze nur die gegebenen Informationen.',
      '- Avoid speculation; use only the supplied information.'
    ),
    t(
      '- Korrigiere die vorherige Zusammenfassung, falls neue Informationen sie widerlegen.',
      '- Correct the previous summary if new information contradicts it.'
    ),
    t(
      '- Die normale Zusammenfassung soll maximal 3-5 Sätze haben.',
      '- The regular summary should contain at most 3–5 sentences.'
    ),
    t(
      '- Die Mini-Zusammenfassung soll 1 Satz mit maximal 150 Zeichen sein und ideal als Tooltip verwendet werden können.',
      '- The mini-summary should be one sentence of at most 150 characters and suitable for use as a tooltip.'
    ),
    t(
      '- Speichere beides zusammen mit set_entity_summary, nachdem du get_entity aufgerufen hast.',
      '- Save both together with set_entity_summary after calling get_entity.'
    ),
    '',
    previousSummary,
    t(`Zusammenfassung für ${qualifiedName}:`, `Summary for ${qualifiedName}:`),
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
    language: runLanguage,
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
