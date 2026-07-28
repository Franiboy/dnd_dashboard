import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { listAllKnowledge } from '../repositories/entityKnowledge.js';
import { getEntitySummary } from '../repositories/entitySummaries.js';
import { stripHtml } from './rewrite.js';
import { createLogger } from '../logger.js';
import type { EntityKnowledgeEntry, EntityType } from '../../shared/types.js';

const log = createLogger('knowledge');

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
    map.set(row.id, { id: row.id, entityType: row.entityType, entityName: row.entityName, status: row.status });
  }
  return map;
}

function computeDistributionDiff(
  before: Map<number, KnowledgeSnapshot>,
  after: EntityKnowledgeEntry[],
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
): Promise<DistributeResult> {
  const plainText = stripHtml(text).trim();
  if (!plainText) return { created: [], deleted: [] };

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Analysiere den folgenden Text und ordne die darin enthaltenen Fakten den passenden Entitäten zu.',
    '',
    'Verfügbare Tools:',
    '- get_entity(type, name): Liefert Zusammenfassung, Wissen und Tagebucheinträge zu einer Entität. MUSS verwendet werden, um bestehendes Wissen zu prüfen.',
    '- list_entities(type?): Listet alle bekannten Entitäten auf.',
    '- create_knowledge(type, name, content, title?): Erstellt einen Wissenseintrag.',
    '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht.',
    '',
    'Regeln:',
    '- DU MUSST vor dem Erstellen oder Löschen von Wissen get_entity für jede im Text erwähnte Entität aufrufen, um bestehendes Wissen zu sehen.',
    '- Ordne jeden Fakt einer oder mehreren Entitäten zu.',
    '- Wenn eine Entität noch nicht existiert, wird sie automatisch durch create_knowledge angelegt.',
    '- Verwende die exakte Schreibweise aus der Datenbank, wenn eine passende Entität existiert.',
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
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-distribute-knowledge-${Date.now()}`,
    scopes: ['entity:read', 'knowledge:distribute'],
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter);

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  if (!result.success) {
    log.warn(`Knowledge distribution failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [] };
  }

  log.info(`Distributed ${diff.created.length} new entries and marked ${diff.deleted.length} entries as deleted`);
  return diff;
}

export async function generateEntitySummary(
  entityType: EntityType,
  entityName: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const typeLabel = entityType === 'persons' ? 'Person' : entityType === 'organizations' ? 'Organisation' : 'Ort';

  const summaryRow = getEntitySummary(entityType, entityName);
  const previousSummary = summaryRow?.summary
    ? `Vorherige Zusammenfassung (korrigiere oder erweitere sie bei Bedarf):\n${summaryRow.summary}\n\n`
    : '';

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Erstelle eine knappe, aber aussagekräftige Zusammenfassung für die ${typeLabel} "${entityName}".`,
    '',
    'Verfügbare Tools:',
    `- get_entity(type="${entityType}", name="${entityName}"): Liefert alle Informationen zur Entität. DU MUSST dieses Tool aufrufen, bevor du die Zusammenfassung erstellst.`,
    `- set_entity_summary(type="${entityType}", name="${entityName}", summary): Speichert die Zusammenfassung. Verwende diesen type und name genau so.`,
    '',
    'Regeln:',
    '- Rufe get_entity auf, um Wissen und verknüpfte Tagebucheinträge zu erhalten.',
    '- Beschreibe die wichtigsten Eigenschaften, Beziehungen und Ereignisse.',
    '- Vermeide Spekulation; nutze nur die gegebenen Informationen.',
    '- Korrigiere die vorherige Zusammenfassung, falls neue Informationen sie widerlegen.',
    '- Maximal 3-5 Sätze.',
    '- Speichere die Zusammenfassung erst, nachdem du get_entity aufgerufen hast.',
    '',
    previousSummary,
    `Zusammenfassung für ${entityName}:`,
  ].join('\n');

  log.info(`Generating summary for ${entityType}/${entityName}`);

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-entity-summary-${entityType}-${entityName}-${Date.now()}`,
    scopes: ['entity:read', 'entity:summary'],
    onLog,
  });

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  if (!result.success) {
    log.warn(`Summary generation failed for ${entityType}/${entityName}: exitCode=${result.exitCode}`);
    return null;
  }

  const summaryRowAfter = getEntitySummary(entityType, entityName);
  if (!summaryRowAfter?.summary) {
    log.warn(`No summary saved for ${entityType}/${entityName}`);
    return null;
  }

  log.info(`Summary generated for ${entityType}/${entityName}`);
  return summaryRowAfter.summary;
}
