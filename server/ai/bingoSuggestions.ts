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
import type { Language } from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';
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

function buildTranscriptsFile(language: Language): {
  sessionsIncluded: number;
  totalChars: number;
} {
  ensureBingoContextDir();

  const sessions = listRecentCompletedSessions(MAX_SESSIONS);
  const lines: string[] = [];
  let totalChars = 0;
  let sessionsIncluded = 0;

  for (const session of sessions) {
    if (!session.transcript || session.transcript.trim().length === 0) continue;

    const header = `=== Session ${session.id}: ${session.name} (${session.startedAt}) ===\n`;
    const summaryBlock = session.longSummary
      ? `--- ${localize(language, 'Zusammenfassung', 'Summary')} ---\n${truncateText(session.longSummary, MAX_SUMMARY_PER_SESSION)}\n\n`
      : session.summary
        ? `--- ${localize(language, 'Kurzzusammenfassung', 'Short summary')} ---\n${truncateText(session.summary, MAX_SUMMARY_PER_SESSION)}\n\n`
        : '';

    const transcriptPart = truncateText(session.transcript.trim(), MAX_TRANSCRIPT_PER_SESSION);
    const transcriptBlock = `--- ${localize(language, 'Transkript (gekürzt)', 'Transcript (abridged)')} ---\n${transcriptPart}\n`;

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
      ? `${localize(
          language,
          `Diese Datei enthält die Zusammenfassungen und gekürzten Transkripte der letzten ${sessionsIncluded} abgeschlossenen Aufnahme-Sessions.`,
          `This file contains summaries and abridged transcripts from the last ${sessionsIncluded} completed recording sessions.`
        )}\n\n${lines.join('')}`
      : localize(
          language,
          'Keine abgeschlossenen Sessions mit Transkripten vorhanden.',
          'No completed sessions with transcripts are available.'
        );

  writeFileSync(TRANSCRIPTS_FILE, content, 'utf-8');
  return { sessionsIncluded, totalChars };
}

function prepareBingoContextFiles(language: Language): {
  transcriptsFile: string;
  sessionsIncluded: number;
} {
  const { sessionsIncluded } = buildTranscriptsFile(language);
  return { transcriptsFile: TRANSCRIPTS_FILE, sessionsIncluded };
}

export function buildPrompt(
  count: number,
  transcriptsFile: string,
  batchId: string,
  audience: TaskAudience,
  language: Language = getAiLanguage()
): string {
  const t = (german: string, english: string) => localize(language, german, english);
  const dmFocus =
    audience === 'dm'
      ? [
          t(
            '8. Analysiere die Transkripte gezielt nach Momenten, die von den SPIELERN ausgelöst werden und die der Dungeon Master live am Tisch beobachten kann:',
            '8. Analyze the transcripts specifically for moments caused by PLAYERS that the Dungeon Master can observe live at the table:'
          ),
          t(
            '   - Würfelglück oder Würfelpech einzelner Spieler (z. B. natürliche 1en oder 20en, mehrere Fehlschläge hintereinander, verpatzte wichtige Würfe)',
            "   - Individual players' lucky or unlucky dice rolls (for example, natural 1s or 20s, several failures in a row, botching important rolls)"
          ),
          t(
            '   - Typische Verhaltensmuster: jemand fragt ständig nach Boni oder Modifikatoren, vergisst seine Fähigkeiten, blättert im Regelwerk',
            '   - Typical behavior patterns: someone constantly asks about bonuses or modifiers, forgets their abilities, or flips through the rulebook'
          ),
          t(
            '   - Lustige Spieler-Sprüche, Floskeln oder Reaktionen, die sich wiederholen',
            '   - Funny player quotes, catchphrases, or reactions that recur'
          ),
          t(
            '   - Gruppendynamik: Plan wird sofort wieder verworfen, endlose Diskussionen über das Vorgehen, jemand redet sich in Gefahr',
            '   - Group dynamics: a plan is immediately abandoned, endless discussions about the approach, or someone talks themselves into danger'
          ),
          t(
            '   - Missgeschicke: Charakterdaten werden vergessen, NPC-Namen falsch genannt, der Gruppe fällt etwas Offensichtliches spät auf',
            '   - Mishaps: character details are forgotten, NPC names are said incorrectly, or the group notices something obvious too late'
          ),
          t(
            '   - Wiederkehrende Interaktionen zwischen den Charakteren (Streit, Insider, Running Gags unter Spielern)',
            '   - Recurring interactions between characters (arguments, inside jokes, or running gags among players)'
          ),
        ]
      : [
          t(
            '8. Analysiere die Transkripte gezielt nach wiederkehrenden, unbeabsichtigten oder DM-getriebenen Momenten, die sich für Bingo eignen:',
            '8. Analyze the transcripts specifically for recurring, unintentional, or DM-driven moments suitable for Bingo:'
          ),
          t(
            '   - Typische Sprüche, Floskeln oder Reaktionen des Dungeon Masters',
            '   - Typical quotes, catchphrases, or reactions from the Dungeon Master'
          ),
          t(
            '   - Wiederkehrende Insider-Witze, running gags oder Memes der Gruppe, die oft unbeabsichtigt entstehen',
            '   - Recurring inside jokes, running gags, or memes from the group that often arise unintentionally'
          ),
          t(
            '   - Würfelglücks-/Pech-Muster, die der Spieler nicht steuern kann (z. B. natürliche 1 oder 20 an ungünstigen Stellen, mehrere Fehlschläge hintereinander)',
            '   - Dice luck or bad-luck patterns the player cannot control (for example, a natural 1 or 20 at an awkward moment or several failures in a row)'
          ),
          t(
            '   - Wiederkehrende Missgeschicke: Jemand vergisst einen wichtigen NPC-Namen, verwechselt Orte, missversteht den DM, verliert den Faden im Plan',
            '   - Recurring mishaps: someone forgets an important NPC name, confuses locations, misunderstands the DM, or loses track of the plan'
          ),
          t(
            '   - Gruppendynamiken, die sich entwickeln, ohne dass einzelne Spieler sie direkt erzwingen (z. B. der Plan wird sofort verworfen, jemand redet sich in Gefahr, der Gruppe fällt erst spät etwas offensichtliches auf)',
            '   - Group dynamics that develop without any individual player directly forcing them (for example, a plan is immediately abandoned, someone talks themselves into danger, or the group notices something obvious too late)'
          ),
          t(
            '   - NPC- oder Gegner-Aktionen, die immer wieder auf gleiche Weise unerwartet laufen',
            '   - NPC or opponent actions that repeatedly go unexpectedly in the same way'
          ),
          t(
            '   - Lustige, wiederkehrende Interaktionen zwischen Charakteren, NPCs oder dem DM, die aus Missverständnissen oder Improvisation entstehen',
            '   - Funny recurring interactions between characters, NPCs, or the DM that arise from misunderstandings or improvisation'
          ),
        ];

  const dmImportant =
    audience === 'dm'
      ? t(
          'WICHTIG: Diese Aufgaben landen auf dem privaten Bingo-Feld des Dungeon Masters. Er markiert sie selbst, sobald er den Moment am Tisch beobachtet. Die Aufgaben müssen Ereignisse beschreiben, die von den SPIELERN ausgelöst werden und während der Sitzung sichtbar passieren – nicht was der DM selbst tut oder erzählt. Vermeide Vorschläge über DM-Entscheidungen, NPCs oder Weltgeschehen.',
          "IMPORTANT: These tasks go on the Dungeon Master's private Bingo board. The DM marks them when they observe the moment at the table. The tasks must describe events caused by PLAYERS that visibly happen during the session, not what the DM does or says. Avoid suggestions about DM decisions, NPCs, or world events."
        )
      : t(
          'WICHTIG: Die Aufgaben sollen Ereignisse beschreiben, die weitgehend außerhalb der direkten Kontrolle eines einzelnen Spielers liegen. Vermeide Vorschläge wie "Ein Spieler tut X" oder "Jemand entscheidet sich für Y". Fokus auf: DM-Sprüche, Würfelpech, NPC-Verhalten, Missverständnisse, vergessene Details und andere unbeabsichtigte Momente.',
          'IMPORTANT: The tasks should describe events largely outside any single player\'s direct control. Avoid suggestions such as "A player does X" or "Someone chooses Y". Focus on DM quotes, bad dice luck, NPC behavior, misunderstandings, forgotten details, and other unintentional moments.'
        );

  return [
    t(
      'Du bist ein Assistent für ein D&D-Bingo-Spiel. Du arbeitest mit Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D Bingo game. You work with tools and respond concisely in English.'
    ),
    outputLanguageInstruction(language),
    '',
    t(
      `Aufgabe: Erstelle genau ${count} neue Bingo-Aufgaben für die bevorstehende Sitzung.`,
      `Task: Create exactly ${count} new Bingo tasks for the upcoming session.`
    ),
    '',
    t(
      `Deine Batch-ID ist "${batchId}". Rufe am Ende unbedingt submit_bingo_suggestions({ batchId: "${batchId}", suggestions: ["...", "..."] }) auf, um die Aufgaben an den Server zu übergeben.`,
      `Your batch ID is "${batchId}". At the end, you MUST call submit_bingo_suggestions({ batchId: "${batchId}", suggestions: ["...", "..."] }) to submit the tasks to the server.`
    ),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      '1. Rufe get_bingo_state() auf. Es liefert den aktuellen Bingo-Zustand: Spielfeldgröße, bereits vorhandene Aufgaben getrennt nach Spieler- und DM-Pool, ausstehende Vorschläge und kürzlich abgelehnte Vorschläge (vermeide alle davon).',
      '1. Call get_bingo_state(). It returns the current Bingo state: board size, existing tasks separated into player and DM pools, pending suggestions, and recently rejected suggestions (avoid all of them).'
    ),
    t(
      '2. Rufe get_previous_session_summaries(limit=5) auf, um die neuesten abgeschlossenen Aufnahme-Sessions zu sehen.',
      '2. Call get_previous_session_summaries(limit=5) to see the most recent completed recording sessions.'
    ),
    t(
      '3. Rufe get_session_summary(sessionId) für Sessions auf, die für das Bingo besonders interessant erscheinen (z. B. die letzten 2-3 Sessions).',
      '3. Call get_session_summary(sessionId) for sessions that seem especially interesting for Bingo (for example, the last two or three sessions).'
    ),
    t(
      `4. Lies die Datei ${transcriptsFile} mit dem read-Tool. Sie enthält die Zusammenfassungen und gekürzten Transkripte der letzten Sessions.`,
      `4. Read the file ${transcriptsFile} with the read tool. It contains summaries and abridged transcripts from the latest sessions.`
    ),
    t(
      '5. Nutze list_entities, um bekannte Personen, Organisationen, Orte und namenhafte Gegenstände zu sehen.',
      '5. Use list_entities to see known people, organizations, locations, and named items.'
    ),
    t(
      '6. Nutze get_entity(type, name, qualifier?) für alle Entitäten, die in den Sessions, Tagebüchern oder Bingo-Vorschlägen relevant erscheinen. Bei Namensgleichheit liefert list_entities Qualifier – nutze den passenden.',
      '6. Use get_entity(type, name, qualifier?) for every entity relevant to the sessions, diaries, or Bingo suggestions. For namesakes, list_entities provides qualifiers; use the appropriate one.'
    ),
    t(
      '7. Nutze search_diary_entries(query), um Hintergrundwissen zu wiederkehrenden Themen, Orten oder Charakteren zu finden.',
      '7. Use search_diary_entries(query) to find background knowledge about recurring topics, locations, or characters.'
    ),
    ...dmFocus,
    t(
      '9. Erstelle daraus Bingo-Aufgaben, die witzig, wiedererkennbar und realistisch für eine einzelne Sitzung sind.',
      '9. Create Bingo tasks from these moments that are funny, recognizable, and realistic for a single session.'
    ),
    '',
    dmImportant,
    '',
    t('Regeln für die Aufgaben:', 'Task rules:'),
    t(
      '- Kurze, prägnante deutsche Sätze, die in eine Bingo-Zelle passen.',
      '- Short, concise English sentences that fit in a Bingo cell.'
    ),
    t(
      '- Konkret und auf die bekannte Spielwelt bezogen, falls Daten vorhanden sind.',
      '- Make tasks concrete and tied to the known game world when data is available.'
    ),
    t(
      '- Keine Wiederholungen bereits vorhandener Aufgaben, ausstehender Vorschläge oder kürzlich abgelehnte Vorschläge.',
      '- Do not repeat existing tasks, pending suggestions, or recently rejected suggestions.'
    ),
    t(
      '- Keine zwei neuen Vorschläge dürfen sich zu sehr ähneln.',
      '- No two new suggestions may be too similar.'
    ),
    audience === 'dm'
      ? t(
          '- Mischung aus leichten und schweren Momenten; alles muss vom DM am Tisch beobachtbar sein.',
          '- Mix easy and difficult moments; everything must be observable by the DM at the table.'
        )
      : t(
          '- Mischung aus Schwierigkeiten und Arten: Rollenspiel, Kampf, Erkundung, Soziales, Umgebung, Würfelglück.',
          '- Mix difficulties and categories: roleplay, combat, exploration, social scenes, environment, and dice luck.'
        ),
    t(
      '- Jede Aufgabe muss in einer Sitzung realistisch erfüllbar sein.',
      '- Every task must be realistically achievable during one session.'
    ),
    t(
      '- Verwende keine Markdown-Formatierung innerhalb der Aufgabentexte.',
      '- Do not use Markdown formatting inside task texts.'
    ),
    t(
      '- Bevorzuge Aufgaben, die auf tatsächlich wiederkehrenden Momenten aus den Transkripten basieren.',
      '- Prefer tasks based on genuinely recurring moments in the transcripts.'
    ),
    '',
    t(
      `Rufe jetzt submit_bingo_suggestions mit der batchId "${batchId}" auf und übergibe genau ${count} Aufgaben als String-Array.`,
      `Now call submit_bingo_suggestions with batchId "${batchId}" and submit exactly ${count} tasks as a string array.`
    ),
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
  audience: TaskAudience = 'players',
  language?: Language
): Promise<string[]> {
  if (!isAiEnabled()) {
    log.info('AI is not enabled; skipping bingo suggestion generation');
    return [];
  }

  if (count <= 0) return [];

  const runLanguage = language ?? getAiLanguage();
  const batchId = randomUUID();
  createBingoSuggestionBatch(batchId, audience);

  const { transcriptsFile, sessionsIncluded } = prepareBingoContextFiles(runLanguage);
  const prompt = buildPrompt(count, transcriptsFile, batchId, audience, runLanguage);
  log.info(
    `Generating ${count} bingo suggestions for pool "${audience}" (batchId=${batchId}, sessions in context: ${sessionsIncluded})`
  );

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: getBingoModel(),
    title: `dnd-bingo-suggestions-${audience}-${Date.now()}`,
    scopes: ['entity:read', 'recording:read', 'diary:read', 'bingo:read', 'bingo:write'],
    language: runLanguage,
  });

  if (!result.success) {
    log.warn(`Bingo suggestion generation failed: exitCode=${result.exitCode}`);

    // The agent may have already submitted the batch successfully before the
    // CLI exited non-zero (e.g. errors during CLI shutdown after the final
    // answer). Keep submitted results instead of discarding them.
    const batchStatus = getBingoSuggestionBatch(batchId)?.status;
    const submitted =
      batchStatus === 'completed' ? getBingoSuggestionBatchResults(batchId).map((r) => r.text) : [];

    await cleanupSession(result.sessionId);

    if (submitted.length > 0) {
      log.info(
        `Keeping ${submitted.length} submitted suggestions from batch ${batchId} despite exit code ${result.exitCode}`
      );
      return submitted;
    }

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
    }
  })();

  // Register before any cleanup can run: the IIFE above executes synchronously
  // until its first await, so an early return (pool already filled) would
  // resolve the promise before it is registered. A stale resolved entry here
  // would report the refill as running forever and block all future refills.
  // The deletion is therefore scheduled asynchronously after registration.
  refillPromises[audience] = promise;
  void promise.finally(() => {
    delete refillPromises[audience];
  });
  return promise;
}
