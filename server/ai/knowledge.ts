import { runOpenCode } from './opencode.js';
import {
  ensureEntityExists,
  findExistingEntitiesInText,
  getDiaryEntryById,
  listAllEntityNames,
  listDiaryEntryContentsByEntity,
  listPreviousDiaryEntriesByUser,
} from '../repositories/diary.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  listActiveEntityKnowledge,
  markEntityKnowledgeDeleted,
} from '../repositories/entityKnowledge.js';
import {
  clearEntitySummaryDirty,
  getEntitySummary,
  setEntitySummary,
} from '../repositories/entitySummaries.js';
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

interface DistributedKnowledge {
  type: EntityType;
  name: string;
  title: string | null;
  content: string;
}

interface Contradiction {
  id: number;
  reason: string;
}

interface DistributeResult {
  created: EntityKnowledgeEntry[];
  deleted: { id: number; reason: string; entry: EntityKnowledgeEntry }[];
}

function parseDistributeResultJson(raw: string): { add: DistributedKnowledge[]; delete: Contradiction[] } | null {
  const cleaned = raw.trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  const validTypes: EntityType[] = ['persons', 'organizations', 'locations'];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const add: DistributedKnowledge[] = [];
    if ('add' in parsed && Array.isArray(parsed.add)) {
      for (const item of parsed.add) {
        if (typeof item !== 'object' || item === null) continue;
        const type = 'type' in item && validTypes.includes(item.type as EntityType) ? (item.type as EntityType) : null;
        const name = 'name' in item && item.name ? String(item.name).trim() : '';
        const title = 'title' in item && item.title ? String(item.title).trim() : null;
        const content = 'content' in item && item.content ? String(item.content).trim() : '';
        if (!type || !name || !content) continue;
        add.push({ type, name, title: title && title.length > 0 ? title : null, content });
      }
    }

    const del: Contradiction[] = [];
    if ('delete' in parsed && Array.isArray(parsed.delete)) {
      for (const item of parsed.delete) {
        if (typeof item !== 'object' || item === null) continue;
        const id = 'id' in item && typeof item.id === 'number' ? item.id : Number(String(item.id));
        const reason = 'reason' in item && item.reason ? String(item.reason).trim() : '';
        if (isNaN(id) || !reason) continue;
        del.push({ id, reason });
      }
    }

    return { add, delete: del };
  } catch {
    return null;
  }
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
    'Widerspricht ein neuer Fakt einem bestehenden Wissenseintrag, markiere den alten als gelöscht. Lösche ihn aber nicht wirklich, sondern gib nur seine ID in "delete" zurück.',
    '',
    'Regeln:',
    '- Ordne jeden Fakt einer oder mehreren Entitäten zu.',
    '- Wenn eine Entität noch nicht existiert, wähle den passenden Typ und erstelle sie.',
    '- Verwende die exakte Schreibweise aus dem Text, wenn keine bestehende Entität passt.',
    '- Gib das Ergebnis als JSON-Objekt zurück: {"add": [{"type": "persons|organizations|locations", "name": "Entitätsname", "title": "Kategorie", "content": "Fakt"}, ...], "delete": [{"id": 123, "reason": "Widerspruch mit neuem Text"}, ...]}',
    '- title ist optional und sollte eine Kategorie wie "Zugehörigkeit", "Beziehungen", "Herkunft", "Beruf", "Ziele" oder "Notizen" sein.',
    '- content ist der eigentliche Faktentext.',
    '- Ein Fakt kann mehreren Entitäten zugeordnet werden.',
    '- Extrahiere nur Fakten, die im Text tatsächlich vorkommen. Erfinke keine Details.',
    '- Halte jeden Fakt kurz und prägnant.',
    '- In "delete" dürfen nur IDs aus dem bestehenden Wissen stehen.',
    '',
    ...(allRelevantEntities.length > 0
      ? [
          'Bekannte Entitäten (verwende diese Schreibweisen, wenn sie passen):',
          ...allRelevantEntities.map((e) => `- ${e.type}: ${e.name}`),
          '',
        ]
      : []),
    ...(existingKnowledgeText
      ? ['Bestehendes Wissen (nur diese IDs dürfen in "delete" vorkommen):', existingKnowledgeText, '']
      : []),
    'Text:',
    plainText,
    '',
    'Antworte ausschließlich mit dem JSON-Objekt.',
  ].join('\n');

  log.info(`Distributing knowledge from free text`);

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-distribute-knowledge-${Date.now()}`,
    onLog,
  });

  if (!result.success) {
    log.warn(`Knowledge distribution failed: exitCode=${result.exitCode}`);
    return { created: [], deleted: [] };
  }

  const parsed = parseDistributeResultJson(result.output);
  if (!parsed || (parsed.add.length === 0 && parsed.delete.length === 0)) {
    log.warn('No knowledge distributed from text');
    return { created: [], deleted: [] };
  }

  const createdEntries: EntityKnowledgeEntry[] = [];
  const deletedEntries: { id: number; reason: string; entry: EntityKnowledgeEntry }[] = [];

  for (const item of parsed.add) {
    const canonical = ensureEntityExists(item.type, item.name);
    const entry = createEntityKnowledge(item.type, canonical, item.title, item.content, 'ai_extracted');
    createdEntries.push(entry);
  }

  for (const item of parsed.delete) {
    const existing = getEntityKnowledgeEntry(item.id);
    if (!existing) continue;
    const updated = markEntityKnowledgeDeleted(item.id, item.reason);
    if (updated) {
      deletedEntries.push({ id: item.id, reason: item.reason, entry: updated });
    }
  }

  log.info(`Distributed ${createdEntries.length} new entries and marked ${deletedEntries.length} entries as deleted`);
  return { created: createdEntries, deleted: deletedEntries };
}

export async function generateEntitySummary(
  entityType: EntityType,
  entityName: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const knowledge = listActiveEntityKnowledge(entityType, entityName);
  const diaryEntries = listDiaryEntryContentsByEntity(entityType, entityName);
  const summaryRow = getEntitySummary(entityType, entityName);

  const typeLabel = entityType === 'persons' ? 'Person' : entityType === 'organizations' ? 'Organisation' : 'Ort';

  const knowledgeContext = knowledge
    .map((entry) => (entry.title ? `${entry.title}: ${entry.content}` : entry.content))
    .join('\n');

  const diaryContext = diaryEntries
    .map((entry) => `Titel: ${entry.title}\n${stripHtml(entry.content)}`)
    .join('\n\n---\n\n');

  const previousSummary = summaryRow?.summary ? `Vorherige Zusammenfassung:\n${summaryRow.summary}\n\n` : '';

  const prompt = [
    `Erstelle eine knappe, aber aussagekräftige Zusammenfassung für die ${typeLabel} "${entityName}".`,
    'Nutze dafür die folgenden Wissenseinträge und Tagebucheinträge.',
    '',
    'Regeln:',
    '- Beschreibe die wichtigsten Eigenschaften, Beziehungen und Ereignisse.',
    '- Vermeide Spekulation; nutze nur die gegebenen Informationen.',
    '- Maximal 3-5 Sätze.',
    '- Antworte ausschließlich mit der Zusammenfassung, ohne Einleitung.',
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
    onLog,
  });

  if (!result.success) {
    log.warn(`Summary generation failed for ${entityType}/${entityName}: exitCode=${result.exitCode}`);
    return null;
  }

  const summary = result.output.trim();
  if (!summary) {
    log.warn(`No summary generated for ${entityType}/${entityName}`);
    return null;
  }

  setEntitySummary(entityType, entityName, summary, false);
  clearEntitySummaryDirty(entityType, entityName);
  log.info(`Summary generated for ${entityType}/${entityName}`);
  return summary;
}
