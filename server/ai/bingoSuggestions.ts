import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getGame } from '../game.js';
import { createLogger } from '../logger.js';
import { isAiEnabled } from './config.js';
import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import type { TaskAudience } from '../../shared/types.js';
import {
  getBingoModel,
  getGenerationBatchSize,
  getRefillThreshold,
  getTargetPoolSize,
} from '../bingoConfig.js';
import { listRecentCompletedSessions } from '../repositories/recordings.js';
import {
  countPendingSuggestions,
  createBingoSuggestions,
  getAllPendingSuggestionTexts,
  getBingoSuggestionBatch,
  getBingoSuggestionBatchResults,
  getRejectedSuggestionTexts,
  rejectAllPendingSuggestions,
  createBingoSuggestionBatch,
  failBingoSuggestionBatch,
} from '../repositories/bingoSuggestions.js';

const log = createLogger('bingo-suggestions');

const BINGO_CONTEXT_DIR = join(process.cwd(), 'data', 'bingo');
const TRANSCRIPTS_FILE = join(BINGO_CONTEXT_DIR, 'transcripts.txt');
const LAST_OUTPUT_FILE = join(BINGO_CONTEXT_DIR, 'last-output.txt');

const MAX_SESSIONS = 5;
const MAX_SUMMARY_PER_SESSION = 3_000;
const MAX_TRANSCRIPT_PER_SESSION = 17_000;
const MAX_TOTAL_CONTEXT_LENGTH = 120_000;
const BATCH_POLL_INTERVAL_MS = 500;
const BATCH_TIMEOUT_MS = 10 * 60 * 1000;

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

function buildPrompt(
  count: number,
  transcriptsFile: string,
  batchId: string,
  audience: TaskAudience
): string {
  const dmFocus =
    audience === 'dm'
      ? [
          '8. Analysiere die Transkripte gezielt nach Momenten, die von den SPIELERN ausgelöst werden und die der Dungeon Master live am Tisch beobachten kann:',
          '   - Würfelglück oder Würfelpech einzelner Spieler (z. B. natürliche 1en oder 20en, mehrere Fehlschläge hintereinander, verpatzte wichtige Würfe)',
          '   - Typische Verhaltensmuster: jemand fragt ständig nach Boni oder Modifikatoren, vergisst seine Fähigkeiten, blättert im Regelwerk',
          '   - Lustige Spieler-Sprüche, Floskeln oder Reaktionen, die sich wiederholen',
          '   - Gruppendynamik: Plan wird sofort wieder verworfen, endlose Diskussionen über das Vorgehen, jemand redet sich in Gefahr',
          '   - Missgeschicke: Charakterdaten werden vergessen, NPC-Namen falsch genannt, der Gruppe fällt etwas Offensichtliches spät auf',
          '   - Wiederkehrende Interaktionen zwischen den Charakteren (Streit, Insider, Running Gags unter Spielern)',
        ]
      : [
          '8. Analysiere die Transkripte gezielt nach wiederkehrenden, unbeabsichtigten oder DM-getriebenen Momenten, die sich für Bingo eignen:',
          '   - Typische Sprüche, Floskeln oder Reaktionen des Dungeon Masters (Nils)',
          '   - Wiederkehrende Insider-Witze, running gags oder Memes der Gruppe, die oft unbeabsichtigt entstehen',
          '   - Würfelglücks-/Pech-Muster, die der Spieler nicht steuern kann (z. B. natürliche 1 oder 20 an ungünstigen Stellen, mehrere Fehlschläge hintereinander)',
          '   - Wiederkehrende Missgeschicke: Jemand vergisst einen wichtigen NPC-Namen, verwechselt Orte, missversteht den DM, verliert den Faden im Plan',
          '   - Gruppendynamiken, die sich entwickeln, ohne dass einzelne Spieler sie direkt erzwingen (z. B. der Plan wird sofort verworfen, jemand redet sich in Gefahr, der Gruppe fällt erst spät etwas offensichtliches auf)',
          '   - NPC- oder Gegner-Aktionen, die immer wieder auf gleiche Weise unerwartet laufen',
          '   - Lustige, wiederkehrende Interaktionen zwischen Charakteren, NPCs oder dem DM, die aus Missverständnissen oder Improvisation entstehen',
        ];

  const dmImportant =
    audience === 'dm'
      ? 'WICHTIG: Diese Aufgaben landen auf dem privaten Bingo-Feld des Dungeon Masters. Er markiert sie selbst, sobald er den Moment am Tisch beobachtet. Die Aufgaben müssen Ereignisse beschreiben, die von den SPIELERN ausgelöst werden und während der Sitzung sichtbar passieren – nicht was der DM selbst tut oder erzählt. Vermeide Vorschläge über DM-Entscheidungen, NPCs oder Weltgeschehen.'
      : 'WICHTIG: Die Aufgaben sollen Ereignisse beschreiben, die weitgehend außerhalb der direkten Kontrolle eines einzelnen Spielers liegen. Vermeide Vorschläge wie "Ein Spieler tut X" oder "Jemand entscheidet sich für Y". Fokus auf: DM-Sprüche, Würfelpech, NPC-Verhalten, Missverständnisse, vergessene Details und andere unbeabsichtigte Momente.';

  return [
    'Du bist ein Assistent für ein D&D-Bingo-Spiel. Du arbeitest mit Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Erstelle genau ${count} neue Bingo-Aufgaben für die bevorstehende Sitzung.`,
    '',
    `Deine Batch-ID ist "${batchId}". Rufe am Ende unbedingt submit_bingo_suggestions({ batchId: "${batchId}", suggestions: ["...", "..."] }) auf, um die Aufgaben an den Server zu übergeben.`,
    '',
    'Vorgehen:',
    '1. Rufe get_bingo_state() auf. Es liefert den aktuellen Bingo-Zustand: Spielfeldgröße, bereits vorhandene Aufgaben getrennt nach Spieler- und DM-Pool, ausstehende Vorschläge und kürzlich abgelehnte Vorschläge (vermeide alle davon).',
    '2. Rufe get_previous_session_summaries(limit=5) auf, um die neuesten abgeschlossenen Aufnahme-Sessions zu sehen.',
    '3. Rufe get_session_summary(sessionId) für Sessions auf, die für das Bingo besonders interessant erscheinen (z. B. die letzten 2-3 Sessions).',
    `4. Lies die Datei ${transcriptsFile} mit dem read-Tool. Sie enthält die Zusammenfassungen und gekürzten Transkripte der letzten Sessions.`,
    '5. Nutze list_entities, um bekannte Personen, Organisationen und Orte zu sehen.',
    '6. Nutze get_entity(type, name) für alle Entitäten, die in den Sessions, Tagebüchern oder Bingo-Vorschlägen relevant erscheinen.',
    '7. Nutze search_diary_entries(query), um Hintergrundwissen zu wiederkehrenden Themen, Orten oder Charakteren zu finden.',
    ...dmFocus,
    '9. Erstelle daraus Bingo-Aufgaben, die witzig, wiedererkennbar und realistisch für eine einzelne Sitzung sind.',
    '',
    dmImportant,
    '',
    'Regeln für die Aufgaben:',
    '- Kurze, prägnante deutsche Sätze, die in eine Bingo-Zelle passen.',
    '- Konkret und auf die bekannte Spielwelt bezogen, falls Daten vorhanden sind.',
    '- Keine Wiederholungen bereits vorhandener Aufgaben, ausstehender Vorschläge oder kürzlich abgelehnte Vorschläge.',
    '- Keine zwei neuen Vorschläge dürfen sich zu sehr ähneln.',
    audience === 'dm'
      ? '- Mischung aus leichten und schweren Momenten; alles muss vom DM am Tisch beobachtbar sein.'
      : '- Mischung aus Schwierigkeiten und Arten: Rollenspiel, Kampf, Erkundung, Soziales, Umgebung, Würfelglück.',
    '- Jede Aufgabe muss in einer Sitzung realistisch erfüllbar sein.',
    '- Verwende keine Markdown-Formatierung innerhalb der Aufgabentexte.',
    '- Bevorzuge Aufgaben, die auf tatsächlich wiederkehrenden Momenten aus den Transkripten basieren.',
    '',
    `Rufe jetzt submit_bingo_suggestions mit der batchId "${batchId}" auf und übergibe genau ${count} Aufgaben als String-Array.`,
  ].join('\n');
}

async function cleanupSession(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  await deleteOpenCodeSession(sessionId);
}

function waitForBatch(
  batchId: string,
  timeoutMs: number
): Promise<{ status: string; results?: { text: string; source: string }[] }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      const batch = getBingoSuggestionBatch(batchId);
      if (batch?.status === 'completed') {
        resolve({ status: 'completed', results: getBingoSuggestionBatchResults(batchId) });
        return;
      }
      if (batch?.status === 'failed' || Date.now() - start > timeoutMs) {
        if (batch?.status !== 'failed') {
          failBingoSuggestionBatch(batchId);
        }
        resolve({ status: batch?.status ?? 'timeout' });
        return;
      }
      setTimeout(poll, BATCH_POLL_INTERVAL_MS);
    };
    poll();
  });
}

export async function generateBingoSuggestionBatch(
  count: number,
  audience: TaskAudience = 'players'
): Promise<string[]> {
  if (!isAiEnabled()) {
    log.info('AI is not enabled; skipping bingo suggestion generation');
    return [];
  }

  if (count <= 0) return [];

  const batchId = randomUUID();
  createBingoSuggestionBatch(batchId, audience);

  const { transcriptsFile, sessionsIncluded } = prepareBingoContextFiles();
  const prompt = buildPrompt(count, transcriptsFile, batchId, audience);
  log.info(
    `Generating ${count} bingo suggestions for pool "${audience}" (batchId=${batchId}, sessions in context: ${sessionsIncluded})`
  );

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: getBingoModel(),
    title: `dnd-bingo-suggestions-${audience}-${Date.now()}`,
    scopes: ['entity:read', 'recording:read', 'diary:read', 'bingo:read', 'bingo:write'],
  });

  if (!result.success) {
    log.warn(`Bingo suggestion generation failed: exitCode=${result.exitCode}`);
    await cleanupSession(result.sessionId);
    failBingoSuggestionBatch(batchId);
    return [];
  }

  writeFileSync(LAST_OUTPUT_FILE, result.output, 'utf-8');
  log.info(`OpenCode raw output saved to ${LAST_OUTPUT_FILE} (${result.output.length} chars)`);

  const { status, results } = await waitForBatch(batchId, BATCH_TIMEOUT_MS);
  await cleanupSession(result.sessionId);

  if (status !== 'completed' || !results) {
    log.warn(`Bingo suggestion batch ${batchId} did not complete in time: ${status}`);
    return [];
  }

  const suggestions = results.map((r) => r.text);
  log.info(`Generated ${suggestions.length} bingo suggestions via batch ${batchId}`);
  return suggestions;
}

let refillPromises: Partial<Record<TaskAudience, Promise<void>>> = {};

export function isBingoSuggestionRefillRunning(audience: TaskAudience = 'players'): boolean {
  return refillPromises[audience] !== undefined;
}

export function runBingoSuggestionRefillNow(audience: TaskAudience = 'players'): boolean {
  if (!isAiEnabled()) return false;
  if (refillPromises[audience]) return false;
  ensureSuggestionPool({ force: true, audience }).catch((err) => {
    log.error(`Manual bingo suggestion refill (${audience}) failed:`, err);
  });
  return true;
}

interface EnsureSuggestionPoolOptions {
  force?: boolean;
  clear?: boolean;
  audience?: TaskAudience;
}

export async function ensureSuggestionPool(
  options: EnsureSuggestionPoolOptions = {}
): Promise<void> {
  if (!isAiEnabled()) return;

  const audience: TaskAudience = options.audience === 'dm' ? 'dm' : 'players';

  if (refillPromises[audience]) return refillPromises[audience];

  const target = getTargetPoolSize();
  const threshold = getRefillThreshold();

  const promise = (async () => {
    try {
      if (options.clear) {
        rejectAllPendingSuggestions(audience);
      }

      let currentPending = countPendingSuggestions(audience);

      if (currentPending >= target) return;
      if (!options.force && currentPending >= threshold) return;

      let iterations = 0;
      const maxIterations = 5;

      while (currentPending < target && iterations < maxIterations) {
        iterations += 1;
        const needed = Math.max(0, Math.min(getGenerationBatchSize(), target - currentPending));
        if (needed <= 0) break;

        log.info(
          `Refilling bingo suggestion pool "${audience}": pending=${currentPending}, needed=${needed}`
        );

        const generated = await generateBingoSuggestionBatch(needed, audience);
        const seen = new Set([
          ...getGame()
            .tasks.filter((task) => (task.audience ?? 'players') === audience)
            .map((task) => task.text.toLowerCase().trim()),
          ...getAllPendingSuggestionTexts(audience).map((text) => text.toLowerCase().trim()),
          ...getRejectedSuggestionTexts(audience).map((text) => text.toLowerCase().trim()),
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
          .map((text) => ({ text, source: 'ai' as const, audience }));

        if (unique.length === 0) {
          log.info('No unique bingo suggestions generated in this batch, stopping refill');
          break;
        }

        createBingoSuggestions(unique);
        log.info(`Added ${unique.length} bingo suggestions to the pool "${audience}"`);
        currentPending = countPendingSuggestions(audience);
      }

      if (currentPending < target) {
        log.warn(
          `Bingo suggestion pool "${audience}" refill stopped at ${currentPending}/${target} after ${iterations} iteration(s)`
        );
      }
    } catch (err) {
      log.error(`Failed to refill bingo suggestion pool "${audience}":`, err);
    } finally {
      delete refillPromises[audience];
    }
  })();

  refillPromises[audience] = promise;
  return promise;
}
