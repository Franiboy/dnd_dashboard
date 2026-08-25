import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getModel } from './modelConfig.js';
import {
  getEntityKnowledgeEntry,
  listAllKnowledge,
  setEntityKnowledgeOrigin,
} from '../repositories/entityKnowledge.js';
import { getEntitySummary } from '../repositories/entitySummaries.js';
import { stripHtml } from './rewrite.js';
import { createLogger } from '../logger.js';
import type { EntityKnowledgeEntry, EntityType, KnowledgeOriginType } from '../../shared/types.js';

const log = createLogger('knowledge');

/** Text a knowledge distribution run was derived from. */
export interface KnowledgeOrigin {
  type: KnowledgeOriginType;
  id: number;
}

interface DistributeResult {
  created: EntityKnowledgeEntry[];
  deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
}

interface KnowledgeSnapshot {
  id: number;
  entityType: EntityType;
  entityName: string;
  status: 'active' | 'deleted';
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

  for (const [id, entry] of afterById) {
    if (!before.has(id)) {
      created.push(entry);
    }
  }

  for (const [id, beforeEntry] of before) {
    const afterEntry = afterById.get(id);
    if (beforeEntry.status === 'active' && afterEntry?.status === 'deleted') {
      deleted.push({ id, reason: afterEntry.statusReason || 'Widerspruch', entry: afterEntry });
    }
  }

  return { created, deleted };
}

export async function distributeKnowledgeFromText(
  text: string,
  model?: string,
  onLog?: (line: string) => void,
  origin?: KnowledgeOrigin
): Promise<DistributeResult> {
  const plainText = stripHtml(text).trim();
  if (!plainText) return { created: [], deleted: [] };

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Analysiere den folgenden Text und ordne die darin enthaltenen Fakten den passenden Entitäten zu.',
    '',
    'Verfügbare Tools:',
    '- get_entity(type, name, qualifier?): Liefert Zusammenfassung, Wissen und Tagebucheinträge zu einer Entität. MUSS verwendet werden, um bestehendes Wissen zu prüfen.',
    '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
    '- create_knowledge(type, name, content, title?, qualifier?): Erstellt einen Wissenseintrag.',
    '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht.',
    '',
    'Regeln:',
    '- DU MUSST vor dem Erstellen oder Löschen von Wissen get_entity für jede im Text erwähnte Entität aufrufen, um bestehendes Wissen zu sehen.',
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
    '- Widerspricht ein neuer Fakt einem bestehenden Eintrag klar und eindeutig, lösche den alten mit delete_knowledge(id) und erstelle einen neuen, korrekten Eintrag.',
    '- In delete_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
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
    scopes: ['entity:read', 'knowledge:distribute'],
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
    return { created: [], deleted: [] };
  }

  log.info(
    `Distributed ${diff.created.length} new entries and marked ${diff.deleted.length} entries as deleted${
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
  for (const entry of [...result.created, ...result.deleted.map((d) => d.entry)]) {
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
  model?: string,
  onLog?: (line: string) => void
): Promise<KnowledgeCorrectionResult> {
  const plainText = stripHtml(correction).trim();
  if (!plainText) return { created: [], deleted: [], summaries: [] };

  const typeLabel = focus
    ? focus.entityType === 'persons'
      ? 'Person'
      : focus.entityType === 'organizations'
        ? 'Organisation'
        : 'Ort'
    : null;

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Der Nutzer meldet einen Fehler im gespeicherten Wissen. Prüfe das betroffene Wissen gegen die Korrektur und berichtige es.',
    ...(typeLabel && focus
      ? [
          `Fokus-Entität: ${typeLabel} "${focus.entityName}" – ihr Wissen ist auf jeden Fall zu prüfen.`,
        ]
      : []),
    '',
    'Verfügbare Tools:',
    '- get_entity(type, name, qualifier?): Liefert Zusammenfassung, Wissen und Tagebucheinträge zu einer Entität. MUSS verwendet werden, um bestehendes Wissen zu prüfen.',
    '- list_entities(type?): Listet alle bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) auf.',
    '- create_knowledge(type, name, content, title?, qualifier?): Erstellt einen Wissenseintrag.',
    '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht.',
    '',
    'Regeln:',
    '- DU MUSST vor dem Löschen oder Erstellen get_entity für die Fokus-Entität und jede in der Korrektur erwähnte Entität aufrufen.',
    '- Finde alle aktiven Wissenseinträge, die der Korrektur klar widersprechen, und markiere sie mit delete_knowledge(id, reason).',
    '- In delete_knowledge muss reason kurz erklären, warum der Eintrag falsch ist, mit Bezug zur Korrektur.',
    '- Erstelle mit create_knowledge die korrekten Fakten, die sich aus der Korrektur ergeben.',
    '- Extrahiere nur Fakten, die in der Korrektur tatsächlich vorkommen. Erfinke keine Details.',
    '- Lasse Einträge unangetastet, die nicht von der Korrektur betroffen sind.',
    '- Verwende die exakte Schreibweise aus der Datenbank, wenn eine passende Entität existiert.',
    '- Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), wähle anhand des Kontexts die richtige Entität und gib deren Qualifier an.',
    '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
    '- Ein Fakt kann mehreren Entitäten zugeordnet werden.',
    '- In delete_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
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
    scopes: ['entity:read', 'knowledge:distribute'],
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter);

  if (!result.success) {
    log.warn(`Knowledge correction failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [], summaries: [] };
  }

  // Refresh summaries of every affected entity so corrections are visible immediately.
  const summaries: CorrectedEntitySummary[] = [];
  for (const target of collectAffectedEntities(focus ?? null, diff)) {
    const generated = await generateEntitySummary(target.entityType, target.entityName, {
      model,
      onLog,
      qualifier: target.entityQualifier ?? '',
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
    `Corrected knowledge: created ${diff.created.length} entries and marked ${diff.deleted.length} entries as deleted`
  );
  return { created: diff.created, deleted: diff.deleted, summaries };
}

export interface GeneratedEntitySummary {
  summary: string;
  miniSummary: string | null;
}

export interface EntitySummaryOptions {
  model?: string;
  onLog?: (line: string) => void;
  /** Disambiguator for homonyms; '' targets the plain name. */
  qualifier?: string;
}

export async function generateEntitySummary(
  entityType: EntityType,
  entityName: string,
  options: EntitySummaryOptions = {}
): Promise<GeneratedEntitySummary | null> {
  const { model, onLog, qualifier = '' } = options;
  const typeLabel =
    entityType === 'persons' ? 'Person' : entityType === 'organizations' ? 'Organisation' : 'Ort';
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
    scopes: ['entity:read', 'entity:summary'],
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
