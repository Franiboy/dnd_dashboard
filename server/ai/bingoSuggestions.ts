import type { EntityType } from '../../shared/types.js';
import { getGame } from '../game.js';
import { createLogger } from '../logger.js';
import { isAiEnabled } from './config.js';
import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getBingoModel, getGenerationBatchSize, getRefillThreshold, getTargetPoolSize } from '../bingoConfig.js';
import { getEntityMappings } from '../repositories/diary.js';
import { getEntitySummary } from '../repositories/entitySummaries.js';
import { listActiveEntityKnowledge } from '../repositories/entityKnowledge.js';
import {
  countPendingSuggestions,
  createBingoSuggestions,
  getAllPendingSuggestionTexts,
  getRejectedSuggestionTexts,
  rejectAllPendingSuggestions,
} from '../repositories/bingoSuggestions.js';

const log = createLogger('bingo-suggestions');

interface EntityContext {
  type: EntityType;
  name: string;
  aliases: string[];
  summary: string | null;
  miniSummary: string | null;
  knowledge: string[];
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

function buildEntityContext(limit = 80): EntityContext[] {
  const mappings = getEntityMappings().slice(0, limit);
  const result: EntityContext[] = [];

  for (const mapping of mappings) {
    const type = mapping.type as EntityType;
    const summary = getEntitySummary(type, mapping.canonical);
    const knowledge = listActiveEntityKnowledge(type, mapping.canonical)
      .slice(0, 3)
      .map((entry) => (entry.title ? `${entry.title}: ${entry.content}` : entry.content));

    result.push({
      type,
      name: mapping.canonical,
      aliases: mapping.aliases,
      summary: summary?.summary ?? null,
      miniSummary: summary?.miniSummary ?? null,
      knowledge,
    });
  }

  return result;
}

function formatEntityContext(entities: EntityContext[]): string {
  if (entities.length === 0) return 'Keine Entitäten vorhanden.';

  const lines: string[] = [];
  for (const entity of entities) {
    const typeLabel = entity.type === 'persons' ? 'Person' : entity.type === 'organizations' ? 'Organisation' : 'Ort';
    lines.push(`- [${typeLabel}] ${entity.name}`);
    if (entity.aliases.length > 0) lines.push(`  Aliase: ${entity.aliases.join(', ')}`);
    if (entity.miniSummary) lines.push(`  Kurz: ${entity.miniSummary}`);
    if (entity.summary) lines.push(`  Zusammenfassung: ${truncateText(entity.summary, 400)}`);
    if (entity.knowledge.length > 0) {
      lines.push(`  Wissen:`);
      for (const fact of entity.knowledge) lines.push(`    - ${truncateText(fact, 300)}`);
    }
  }

  return lines.join('\n');
}

function formatBulletList(title: string, items: string[]): string {
  if (items.length === 0) return `${title}:\nKeine`;
  return `${title}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

function buildPrompt(count: number): string {
  const game = getGame();
  const entities = buildEntityContext();
  const existingTasks = game.tasks
    .filter((task) => !task.isPrivate)
    .map((task) => task.text);
  const pendingSuggestions = getAllPendingSuggestionTexts();
  const rejectedSuggestions = getRejectedSuggestionTexts().slice(-50);

  return [
    'Du bist ein Assistent für ein D&D-Bingo-Spiel.',
    `Aufgabe: Erstelle genau ${count} neue Bingo-Aufgaben für die bevorstehende Sitzung.`,
    '',
    'Nutze die folgenden Informationen, um die Aufgaben passend zur Welt, den Charakteren und Orten zu machen:',
    '- Die bereits im Bingo vorhandenen Aufgaben (vermeide Duplikate und Variationen).',
    '- Bereits generierte oder abgelehnte Vorschläge (nicht erneut vorschlagen).',
    '- Die bekannten Entitäten (Personen, Organisationen, Orte) mit Zusammenfassungen und Wissen.',
    '',
    `Aktuelle Spielfeldgröße: ${game.gridSize}x${game.gridSize}.`,
    '',
    'Regeln für die Aufgaben:',
    '- Kurze, prägnante deutsche Sätze, die in eine Bingo-Zelle passen.',
    '- Konkret und auf die bekannte Spielwelt bezogen, falls Daten vorhanden sind.',
    '- Keine Wiederholungen bereits vorhandener Aufgaben, Vorschläge oder voneinander.',
    '- Mischung aus Schwierigkeiten und Arten: Rollenspiel, Kampf, Erkundung, Soziales, Umgebung, Würfelglück.',
    '- Jede Aufgabe muss in einer Sitzung realistisch erfüllbar sein.',
    '- Verwende keine Markdown-Formatierung innerhalb der Aufgabentexte.',
    '- Antworte AUSSCHLIESSLICH mit einem validen JSON-Array aus Strings, ohne Erklärungen, ohne Code-Blöcke.',
    '',
    formatBulletList('Bereits vorhandene Bingo-Aufgaben (öffentlich)', existingTasks),
    '',
    formatBulletList('Bereits generierte Vorschläge im Pool (nicht erneut vorschlagen)', pendingSuggestions),
    '',
    formatBulletList('Zuletzt abgelehnte Vorschläge (nicht erneut vorschlagen)', rejectedSuggestions),
    '',
    `Bekannte Entitäten (${entities.length}):`,
    formatEntityContext(entities),
    '',
    `Gib nun genau ${count} neue Bingo-Aufgaben als JSON-Array aus:`,
  ].join('\n');
}

function stripCodeFences(output: string): string {
  const match = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : output.trim();
}

function extractFirstTopLevelArray(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseSuggestions(output: string): string[] {
  const cleaned = stripCodeFences(output);

  try {
    return parseStringArray(JSON.parse(cleaned));
  } catch {
    const array = extractFirstTopLevelArray(cleaned);
    if (!array) return [];
    try {
      return parseStringArray(JSON.parse(array));
    } catch {
      return [];
    }
  }
}

async function cleanupSession(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  await deleteOpenCodeSession(sessionId);
}

export async function generateBingoSuggestionBatch(count: number): Promise<string[]> {
  if (!isAiEnabled()) {
    log.info('AI is not enabled; skipping bingo suggestion generation');
    return [];
  }

  if (count <= 0) return [];

  const prompt = buildPrompt(count);
  log.info(`Generating ${count} bingo suggestions`);

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: getBingoModel(),
    title: `dnd-bingo-suggestions-${Date.now()}`,
    scopes: ['entity:read'],
  });

  if (!result.success) {
    log.warn(`Bingo suggestion generation failed: exitCode=${result.exitCode}`);
    await cleanupSession(result.sessionId);
    return [];
  }

  const suggestions = parseSuggestions(result.output);
  log.info(`Generated ${suggestions.length} bingo suggestions`);

  await cleanupSession(result.sessionId);

  return suggestions;
}

let refillPromise: Promise<void> | null = null;

interface EnsureSuggestionPoolOptions {
  force?: boolean;
  clear?: boolean;
}

export async function ensureSuggestionPool(options: EnsureSuggestionPoolOptions = {}): Promise<void> {
  if (!isAiEnabled()) return;

  if (refillPromise) return refillPromise;

  const target = getTargetPoolSize();
  const threshold = getRefillThreshold();

  refillPromise = (async () => {
    try {
      if (options.clear) {
        rejectAllPendingSuggestions();
      }

      let currentPending = countPendingSuggestions();

      if (currentPending >= target) return;
      if (!options.force && currentPending >= threshold) return;

      let iterations = 0;
      const maxIterations = 5;

      while (currentPending < target && iterations < maxIterations) {
        iterations += 1;
        const needed = Math.max(0, Math.min(getGenerationBatchSize(), target - currentPending));
        if (needed <= 0) break;

        log.info(`Refilling bingo suggestion pool: pending=${currentPending}, needed=${needed}`);

        const generated = await generateBingoSuggestionBatch(needed);
        const seen = new Set([
          ...getGame().tasks.map((task) => task.text.toLowerCase().trim()),
          ...getAllPendingSuggestionTexts().map((text) => text.toLowerCase().trim()),
          ...getRejectedSuggestionTexts().map((text) => text.toLowerCase().trim()),
        ]);

        const unique = generated
          .map((text) => text.trim())
          .filter((text) => {
            const normalized = text.toLowerCase();
            if (normalized.length < 3 || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
          })
          .slice(0, needed)
          .map((text) => ({ text, source: 'ai' as const }));

        if (unique.length === 0) {
          log.info('No unique bingo suggestions generated in this batch, stopping refill');
          break;
        }

        createBingoSuggestions(unique);
        log.info(`Added ${unique.length} bingo suggestions to the pool`);
        currentPending = countPendingSuggestions();
      }

      if (currentPending < target) {
        log.warn(`Bingo suggestion pool refill stopped at ${currentPending}/${target} after ${iterations} iteration(s)`);
      }
    } catch (err) {
      log.error('Failed to refill bingo suggestion pool:', err);
    } finally {
      refillPromise = null;
    }
  })();

  return refillPromise;
}
