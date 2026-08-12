import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGame } from '../game.js';
import { createLogger } from '../logger.js';
import { isAiEnabled } from './config.js';
import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getBingoModel, getGenerationBatchSize, getRefillThreshold, getTargetPoolSize } from '../bingoConfig.js';
import { listRecentCompletedSessions } from '../repositories/recordings.js';
import {
  countPendingSuggestions,
  createBingoSuggestions,
  getAllPendingSuggestionTexts,
  getRejectedSuggestionTexts,
  rejectAllPendingSuggestions,
} from '../repositories/bingoSuggestions.js';

const log = createLogger('bingo-suggestions');

const BINGO_CONTEXT_DIR = join(process.cwd(), 'data', 'bingo');
const TRANSCRIPTS_FILE = join(BINGO_CONTEXT_DIR, 'transcripts.txt');

const MAX_SESSIONS = 5;
const MAX_SUMMARY_PER_SESSION = 3_000;
const MAX_TRANSCRIPT_PER_SESSION = 17_000;
const MAX_TOTAL_CONTEXT_LENGTH = 120_000;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

function ensureBingoContextDir(): void {
  mkdirSync(BINGO_CONTEXT_DIR, { recursive: true });
}

function buildTranscriptsFile(): { sessionsIncluded: number; totalChars: number } {
  ensureBingoContextDir();

  const sessions = listRecentCompletedSessions(MAX_SESSIONS);
  const lines: string[] = [];
  let totalChars = 0;
  let sessionsIncluded = 0;

  for (const session of sessions) {
    if (!session.transcript || session.transcript.trim().length === 0) continue;

    const header = `=== Session ${session.id}: ${session.name} (${session.startedAt}) ===\n`;
    const summaryBlock = session.longSummary
      ? `--- Zusammenfassung ---\n${truncateText(session.longSummary, MAX_SUMMARY_PER_SESSION)}\n\n`
      : session.summary
        ? `--- Kurzzusammenfassung ---\n${truncateText(session.summary, MAX_SUMMARY_PER_SESSION)}\n\n`
        : '';

    const transcriptPart = truncateText(session.transcript.trim(), MAX_TRANSCRIPT_PER_SESSION);
    const transcriptBlock = `--- Transkript (gekürzt) ---\n${transcriptPart}\n`;

    const block = `${header}${summaryBlock}${transcriptBlock}\n\n`;

    if (totalChars + block.length > MAX_TOTAL_CONTEXT_LENGTH) {
      break;
    }

    lines.push(block);
    totalChars += block.length;
    sessionsIncluded += 1;
  }

  const content =
    lines.length > 0
      ? `Diese Datei enthält die Zusammenfassungen und gekürzten Transkripte der letzten ${sessionsIncluded} abgeschlossenen Aufnahme-Sessions.\n\n${lines.join('')}`
      : 'Keine abgeschlossenen Sessions mit Transkripten vorhanden.';

  writeFileSync(TRANSCRIPTS_FILE, content, 'utf-8');
  return { sessionsIncluded, totalChars };
}

function prepareBingoContextFiles(): { transcriptsFile: string; sessionsIncluded: number } {
  const { sessionsIncluded } = buildTranscriptsFile();
  return { transcriptsFile: TRANSCRIPTS_FILE, sessionsIncluded };
}

function buildPrompt(count: number, transcriptsFile: string): string {
  return [
    'Du bist ein Assistent für ein D&D-Bingo-Spiel. Du arbeitest mit Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Erstelle genau ${count} neue Bingo-Aufgaben für die bevorstehende Sitzung.`,
    '',
    'Vorgehen:',
    '1. Rufe get_bingo_state() auf. Es liefert den aktuellen Bingo-Zustand: Spielfeldgröße, bereits vorhandene öffentliche Aufgaben, ausstehende Vorschläge und kürzlich abgelehnte Vorschläge (vermeide alle davon).',
    '2. Rufe get_previous_session_summaries(limit=5) auf, um die neuesten abgeschlossenen Aufnahme-Sessions zu sehen.',
    '3. Rufe get_session_summary(sessionId) für Sessions auf, die für das Bingo besonders interessant erscheinen (z. B. die letzten 2-3 Sessions).',
    `4. Lies die Datei ${transcriptsFile} mit dem read-Tool. Sie enthält die Zusammenfassungen und gekürzten Transkripte der letzten Sessions.`,
    '5. Nutze list_entities, um bekannte Personen, Organisationen und Orte zu sehen.',
    '6. Nutze get_entity(type, name) für alle Entitäten, die in den Sessions, Tagebüchern oder Bingo-Vorschlägen relevant erscheinen.',
    '7. Nutze search_diary_entries(query), um Hintergrundwissen zu wiederkehrenden Themen, Orten oder Charakteren zu finden.',
    '8. Analysiere die Transkripte gezielt nach wiederkehrenden, lustigen Momenten, die sich für Bingo eignen:',
    '   - Typische Sprüche, Floskeln oder Reaktionen des Dungeon Masters (Nils)',
    '   - Wiederkehrende Insider-Witze, Memes oder running gags der Spielergruppe',
    '   - Häufige Spieler-Aussagen (z. B. "Ich schleiche mich an", "Kann ich das mit Vorteil würfeln?", "Wir reden uns tot")',
    '   - Typische Würfelglücks-/Pech-Muster (z. B. natürliche 1 oder 20 an ungünstigen Stellen)',
    '   - Wiederkehrende Gruppendynamiken (z. B. jemand redet sich in Gefahr, der Plan wird sofort verworfen, jemand vergisst einen NPC-Namen)',
    '   - Lustige, wiederkehrende Interaktionen zwischen Charakteren, NPCs oder dem DM',
    '9. Erstelle daraus Bingo-Aufgaben, die witzig, wiedererkennbar und realistisch für eine einzelne Sitzung sind.',
    '',
    'Regeln für die Aufgaben:',
    '- Kurze, prägnante deutsche Sätze, die in eine Bingo-Zelle passen.',
    '- Konkret und auf die bekannte Spielwelt bezogen, falls Daten vorhanden sind.',
    '- Keine Wiederholungen bereits vorhandener Aufgaben, ausstehender Vorschläge oder kürzlich abgelehnter Vorschläge.',
    '- Keine zwei neuen Vorschläge dürfen sich zu sehr ähneln.',
    '- Mischung aus Schwierigkeiten und Arten: Rollenspiel, Kampf, Erkundung, Soziales, Umgebung, Würfelglück.',
    '- Jede Aufgabe muss in einer Sitzung realistisch erfüllbar sein.',
    '- Verwende keine Markdown-Formatierung innerhalb der Aufgabentexte.',
    '- Bevorzuge Aufgaben, die auf tatsächlich wiederkehrenden Momenten aus den Transkripten basieren (z. B. "Nils sagt: ...", "Jemand wirft einen natürlichen 1", "Ein Spieler zitiert einen NPC").',
    '- Antworte AUSSCHLIESSLICH mit einem validen JSON-Array aus Strings, ohne Erklärungen, ohne Code-Blöcke.',
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

  const { transcriptsFile, sessionsIncluded } = prepareBingoContextFiles();
  const prompt = buildPrompt(count, transcriptsFile);
  log.info(`Generating ${count} bingo suggestions (sessions in context: ${sessionsIncluded})`);

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: getBingoModel(),
    title: `dnd-bingo-suggestions-${Date.now()}`,
    scopes: ['entity:read', 'recording:read', 'diary:read', 'bingo:read'],
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

export function isBingoSuggestionRefillRunning(): boolean {
  return refillPromise !== null;
}

export function runBingoSuggestionRefillNow(): boolean {
  if (!isAiEnabled()) return false;
  if (refillPromise) return false;
  ensureSuggestionPool({ force: true }).catch((err) => {
    log.error('Manual bingo suggestion refill failed:', err);
  });
  return true;
}

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
