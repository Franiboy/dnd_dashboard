import { runOpenCode } from './opencode.js';
import {
  findExistingEntitiesInText,
  getDiaryEntryById,
  listAllEntityNames,
  listDiaryEntryContentsByEntity,
  listPreviousDiaryEntriesByUser,
} from '../repositories/diary.js';
import { listActiveEntityKnowledge, listAllKnowledge } from '../repositories/entityKnowledge.js';
import { getEntitySummary } from '../repositories/entitySummaries.js';
import { stripHtml } from './rewrite.js';
import { createLogger } from '../logger.js';
import type { EntityKnowledgeEntry, EntityType } from '../../shared/types.js';

const log = createLogger('knowledge');

function formatEntityKnowledge(type: EntityType, name: string): string {
  const entries = listActiveEntityKnowledge(type, name);
  if (entries.length === 0) return '';

  const lines = [`${type === 'persons' ? 'Person' : type === 'organizations' ? 'Organisation' : 'Ort'}: ${name}`];
  for (const entry of entries) {
    const title = entry.title ? `${entry.title}: ` : '';
    lines.push(`  - ${title}${entry.content}`);
  }
  return lines.join('\n');
}

export interface KnowledgeContextOptions {
  userId?: string;
  beforeCreatedAt?: string;
  entryId?: number;
}

function buildDiaryContext(options?: KnowledgeContextOptions): string {
  if (!options) return '';

  let userId = options.userId;
  let beforeCreatedAt = options.beforeCreatedAt;

  if (options.entryId) {
    const entry = getDiaryEntryById(options.entryId);
    if (entry) {
      userId = entry.userId;
      beforeCreatedAt = entry.createdAt;
    }
  }

  if (!userId) return '';
  if (!beforeCreatedAt) {
    beforeCreatedAt = new Date().toISOString();
  }

  const previousEntries = listPreviousDiaryEntriesByUser(userId, beforeCreatedAt, 3);
  if (previousEntries.length === 0) return '';

  const lines = ['Vorherige Tagebucheinträge (zum Kontext):'];
  for (const entry of previousEntries.slice().reverse()) {
    const date = new Date(entry.createdAt).toLocaleDateString('de-DE');
    lines.push(`Titel: ${entry.title} (${date})`);
    lines.push(stripHtml(entry.content));
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function getKnowledgeContextForText(
  text: string,
  options?: KnowledgeContextOptions,
): string {
  const plainText = stripHtml(text);
  if (!plainText.trim()) return '';

  const entities = findExistingEntitiesInText(text);
  const parts: string[] = [];

  for (const name of entities.persons) {
    const formatted = formatEntityKnowledge('persons', name);
    if (formatted) parts.push(formatted);
  }
  for (const name of entities.organizations) {
    const formatted = formatEntityKnowledge('organizations', name);
    if (formatted) parts.push(formatted);
  }
  for (const name of entities.locations) {
    const formatted = formatEntityKnowledge('locations', name);
    if (formatted) parts.push(formatted);
  }

  const diaryContext = buildDiaryContext(options);

  const sections: string[] = [];
  if (parts.length > 0) {
    sections.push('Relevantes Wissen:');
    sections.push(...parts);
  }
  if (diaryContext) {
    if (sections.length > 0) sections.push('');
    sections.push(diaryContext);
  }

  if (sections.length === 0) return '';

  sections.push('');
  return sections.join('\n');
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

  const existingEntities = listAllEntityNames();
  const detectedEntities = findExistingEntitiesInText(text);

  const allRelevantEntities: { type: EntityType; name: string }[] = [
    ...existingEntities.persons.map((name) => ({ type: 'persons' as EntityType, name })),
    ...existingEntities.organizations.map((name) => ({ type: 'organizations' as EntityType, name })),
    ...existingEntities.locations.map((name) => ({ type: 'locations' as EntityType, name })),
  ];

  const relevantKnowledge: { type: EntityType; name: string; entries: EntityKnowledgeEntry[] }[] = [];
  const collect = (type: EntityType, name: string) => {
    const entries = listActiveEntityKnowledge(type, name);
    if (entries.length > 0) {
      relevantKnowledge.push({ type, name, entries });
    }
  };
  for (const name of detectedEntities.persons) collect('persons', name);
  for (const name of detectedEntities.organizations) collect('organizations', name);
  for (const name of detectedEntities.locations) collect('locations', name);

  const existingKnowledgeText = relevantKnowledge
    .map(({ type, name, entries }) => {
      const lines = [`Entität ${type} "${name}":`];
      for (const entry of entries) {
        const title = entry.title ? `${entry.title}: ` : '';
        lines.push(`  - ID ${entry.id}: ${title}${entry.content}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  const prompt = [
    'Analysiere den folgenden Text und ordne die darin enthaltenen Fakten den passenden Entitäten zu.',
    'Widerspricht ein neuer Fakt einem bestehenden Wissenseintrag, markiere den alten als gelöscht.',
    '',
    'Verfügbare Tools:',
    '- create_knowledge(type, name, content, title?): Erstellt einen Wissenseintrag.',
    '- delete_knowledge(id, reason?): Markiert einen Wissenseintrag als gelöscht.',
    '',
    'Regeln:',
    '- Ordne jeden Fakt einer oder mehreren Entitäten zu.',
    '- Wenn eine Entität noch nicht existiert, wird sie automatisch durch create_knowledge angelegt.',
    '- Verwende die exakte Schreibweise aus dem Text, wenn keine bestehende Entität passt.',
    '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
    '- content ist der eigentliche Faktentext.',
    '- Ein Fakt kann mehreren Entitäten zugeordnet werden.',
    '- Extrahiere nur Fakten, die im Text tatsächlich vorkommen. Erfinde keine Details.',
    '- Halte jeden Fakt kurz und prägnant.',
    '- In delete_knowledge dürfen nur IDs aus dem bestehenden Wissen stehen.',
    '',
    ...(allRelevantEntities.length > 0
      ? [
          'Bekannte Entitäten (verwende diese Schreibweisen, wenn sie passen):',
          ...allRelevantEntities.map((e) => `- ${e.type}: ${e.name}`),
          '',
        ]
      : []),
    ...(existingKnowledgeText
      ? ['Bestehendes Wissen (nur diese IDs dürfen in delete_knowledge vorkommen):', existingKnowledgeText, '']
      : []),
    'Text:',
    plainText,
    '',
    'Speichere die Fakten direkt über die Tools.',
  ].join('\n');

  log.info(`Distributing knowledge from free text`);

  const snapshotBefore = takeKnowledgeSnapshot();

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-distribute-knowledge-${Date.now()}`,
    scopes: ['knowledge:distribute'],
    onLog,
  });

  const allAfter = listAllKnowledge();
  const diff = computeDistributionDiff(snapshotBefore, allAfter);

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
  const knowledge = listActiveEntityKnowledge(entityType, entityName);
  const diaryEntries = listDiaryEntryContentsByEntity(entityType, entityName);

  const typeLabel = entityType === 'persons' ? 'Person' : entityType === 'organizations' ? 'Organisation' : 'Ort';

  const knowledgeContext = knowledge
    .map((entry) => (entry.title ? `${entry.title}: ${entry.content}` : entry.content))
    .join('\n');

  const diaryContext = diaryEntries
    .map((entry) => `Titel: ${entry.title}\n${stripHtml(entry.content)}`)
    .join('\n\n---\n\n');

  const summaryRow = getEntitySummary(entityType, entityName);
  const previousSummary = summaryRow?.summary ? `Vorherige Zusammenfassung:\n${summaryRow.summary}\n\n` : '';

  const prompt = [
    `Erstelle eine knappe, aber aussagekräftige Zusammenfassung für die ${typeLabel} "${entityName}".`,
    'Nutze dafür die folgenden Wissenseinträge und Tagebucheinträge.',
    '',
    'Verfügbares Tool:',
    '- set_entity_summary(type, name, summary): Speichert die Zusammenfassung.',
    '',
    'Regeln:',
    '- Beschreibe die wichtigsten Eigenschaften, Beziehungen und Ereignisse.',
    '- Vermeide Spekulation; nutze nur die gegebenen Informationen.',
    '- Maximal 3-5 Sätze.',
    '',
    ...(knowledgeContext ? ['Wissenseinträge:', knowledgeContext, ''] : []),
    ...(diaryContext ? ['Tagebucheinträge:', diaryContext, ''] : []),
    previousSummary,
    `Zusammenfassung für ${entityName}:`,
  ].join('\n');

  log.info(`Generating summary for ${entityType}/${entityName}`);

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-entity-summary-${entityType}-${entityName}-${Date.now()}`,
    scopes: ['entity:summary'],
    onLog,
  });

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
