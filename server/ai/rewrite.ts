import { runOpenCode } from './opencode.js';
import { getRewrittenFilePath, readRewrittenFile, writeRewrittenFile } from '../diaryFiles.js';
import { createLogger } from '../logger.js';

const log = createLogger('rewrite');

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToHtml(text: string): string {
  const trimmed = text.trim();
  if (/<[^>]+>/.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export interface RewriteResult {
  content: string | null;
  sessionId: string | null;
}

export async function rewriteTextWithAi(
  entryId: number,
  originalHtml: string,
  existingRewrittenContent: string | null,
  existingSessionId: string | null,
  model?: string,
  onLog?: (line: string) => void,
): Promise<RewriteResult> {
  const plainText = stripHtml(originalHtml).trim();
  if (!plainText) {
    log.warn(`rewriteTextWithAi called with empty content for entry ${entryId}`);
    return { content: null, sessionId: existingSessionId };
  }

  const rewrittenFilePath = getRewrittenFilePath(entryId);
  const title = `dnd-diary-${entryId}`;
  const mode = existingRewrittenContent ? 'improve' : 'rewrite';

  log.info(`Starting ${mode} for entry ${entryId}, sessionId=${existingSessionId ?? 'none'}`);

  const baseInstructions = [
    'Improve grammar, style and clarity while preserving the original meaning and personal tone.',
    'Preserve all existing HTML tags and structure (paragraphs, headings, lists, bold, italic, etc.). Only change the text content, not the HTML structure.',
    'Do NOT wrap the output in markdown code blocks and do not add explanations. Only output the rewritten HTML.',
  ];

  const promptParts = existingRewrittenContent
    ? [
        'Improve the following rewritten German diary entry further.',
        ...baseInstructions,
        '',
        'Current rewritten version (improve this):',
        existingRewrittenContent,
        '',
        'Original diary entry for reference:',
        originalHtml,
      ]
    : [
        'Rewrite the following German diary entry in HTML format.',
        ...baseInstructions,
        '',
        'Diary entry:',
        originalHtml,
      ];

  const prompt = [
    ...promptParts,
    '',
    `Write the final rewritten HTML to the file ${rewrittenFilePath} and also return it in your response.`,
    'Do NOT run any other commands or perform any other actions.',
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_MODEL || 'provider/GLM5.2',
    sessionId: existingSessionId || undefined,
    title: existingSessionId ? undefined : title,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for entry ${entryId}: exitCode=${result.exitCode}`);
    return { content: null, sessionId: existingSessionId };
  }

  let sessionId = existingSessionId;
  if (!sessionId) {
    const { findOpenCodeSessionId } = await import('./opencode.js');
    sessionId = await findOpenCodeSessionId(process.cwd(), title);
    log.info(`Resolved sessionId for entry ${entryId}: ${sessionId ?? 'none'}`);
  }

  const fileContent = readRewrittenFile(entryId);
  if (fileContent) {
    log.info(`Using rewritten file content for entry ${entryId} (${fileContent.length} bytes)`);
    return { content: normalizeToHtml(fileContent), sessionId };
  }

  const output = extractRewriteOutput(result.output);
  if (!output) {
    log.warn(`No usable output for entry ${entryId}; stdout was empty after filtering`);
    return { content: null, sessionId };
  }

  log.info(`Using stdout output for entry ${entryId} (${output.length} bytes)`);
  writeRewrittenFile(entryId, output);
  return { content: normalizeToHtml(output), sessionId };
}

export async function improveRewrittenWithCommand(
  entryId: number,
  originalHtml: string,
  existingRewrittenContent: string,
  command: string,
  sessionId: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<RewriteResult> {
  const rewrittenFilePath = getRewrittenFilePath(entryId);
  const plainOriginal = stripHtml(originalHtml).trim();

  const prompt = [
    'You are improving a previously rewritten German diary entry based on a user command.',
    'Keep the output in HTML format. Preserve all existing HTML tags and structure.',
    'Only change the text content as requested. Do NOT wrap the output in markdown code blocks.',
    'Do NOT run any other commands or perform any other actions.',
    '',
    `Write the final improved HTML to the file ${rewrittenFilePath} and also return it in your response.`,
    '',
    'User command:',
    command,
    '',
    'Current rewritten version (edit this):',
    existingRewrittenContent,
    ...(plainOriginal
      ? ['', 'Original diary entry for reference:', originalHtml]
      : []),
  ].join('\n');

  log.info(`Applying rewrite command for entry ${entryId}: ${command}`);
  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_MODEL || 'provider/GLM5.2',
    sessionId,
    onLog,
  });

  if (!result.success) {
    log.error(`Rewrite command failed for entry ${entryId}: exitCode=${result.exitCode}`);
    return { content: null, sessionId };
  }

  const fileContent = readRewrittenFile(entryId);
  if (fileContent) {
    log.info(`Using rewritten file content after command for entry ${entryId} (${fileContent.length} bytes)`);
    return { content: normalizeToHtml(fileContent), sessionId };
  }

  const output = extractRewriteOutput(result.output);
  if (!output) {
    log.warn(`No usable output after command for entry ${entryId}`);
    return { content: null, sessionId };
  }

  log.info(`Using stdout output after command for entry ${entryId} (${output.length} bytes)`);
  writeRewrittenFile(entryId, output);
  return { content: normalizeToHtml(output), sessionId };
}

export async function summarizeTextWithAi(
  text: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const plainText = stripHtml(text);
  if (!plainText) {
    log.warn('summarizeTextWithAi called with empty content');
    return null;
  }

  log.info(`Starting summarize with model ${model ?? 'default'}`);

  const prompt = [
    'Wichtig: Deine Antwort darf maximal 500 Zeichen lang sein. Überschreite dieses Limit auf keinen Fall.',
    'Fasse den folgenden deutschen Tagebucheintrag in 3-5 Sätzen zusammen.',
    'Beschreibe die wichtigsten Ereignisse und Ergebnisse knapp und prägnant.',
    'Nenne relevante Namen nur im Fließtext, wenn sie für das Ereignis wichtig sind.',
    'Füge am Ende keine eigene Aufzählung von Beteiligten, Gruppen oder Orten hinzu.',
    'Halte dich strikt an den vorliegenden Text und erfinke keine Details (z. B. Orte, Personen oder Ursachen), die darin nicht stehen.',
    'Do NOT modify any files, run any commands or perform any actions. Only output the summary text.',
    'Antworte ausschließlich auf Deutsch.',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  const raw = await runAiPrompt(
    prompt,
    `dnd-diary-summarize-${Date.now()}`,
    model || process.env.AI_CHEAP_MODEL,
    onLog,
  );
  if (raw === null) {
    log.warn('summarizeTextWithAi received no output');
    return null;
  }
  const summary = raw.replace(/\s+/g, ' ').trim();
  log.info(`Summary generated (${summary.length} chars)`);
  return summary;
}

async function runAiPrompt(
  prompt: string,
  title: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  log.info(`Running AI prompt: title=${title}, model=${model ?? 'default'}`);
  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_MODEL || 'provider/GLM5.2',
    title,
    onLog,
  });

  if (!result.success) {
    log.warn(`AI prompt failed: title=${title}, exitCode=${result.exitCode}`);
    return null;
  }

  const output = extractRewriteOutput(result.output);
  log.info(`AI prompt completed: title=${title}, outputLength=${output.length}`);
  return output;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function extractRewriteOutput(raw: string): string {
  let cleaned = stripAnsi(raw).trim();

  // If the model wrapped the output in a markdown code block, extract it.
  const codeBlockMatch = cleaned.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Filter out opencode status/progress lines (e.g. "> build · code-secure-local")
  // and empty lines that remain after stripping ANSI escape sequences.
  const lines = cleaned.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\s*>\s+\S+\s*·\s*\S+/.test(trimmed)) return false;
    return true;
  });

  return lines.join('\n').trim();
}

export interface DiaryEntities {
  persons: string[];
  organizations: string[];
  locations: string[];
}

export async function extractEntitiesFromDiary(
  text: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<DiaryEntities> {
  const plainText = stripHtml(text);
  if (!plainText) {
    return { persons: [], organizations: [], locations: [] };
  }

  const prompt = [
    'Extrahiere alle eindeutigen Personen/Charaktere, Organisationen/Fraktionen und Orte aus dem folgenden deutschen Tagebucheintrag.',
    '',
    'Regeln:',
    '- persons: Lebende Wesen, Charaktere, Tiere mit eigenem Namen oder eindeutiger Bezeichnung. Keine allgemeinen Begriffe wie "Wachen", "Aufständische" oder "Leute".',
    '- organizations: Gruppen, Gilden, Fraktionen, Clans, Häuser, Orden, Reiche, Familien, militärische Einheiten, Firmen oder andere Kollektive mit eigenem Namen. Keine allgemeinen Gruppenbezeichnungen.',
    '- locations: Städte, Dörfer, Länder, Regionen, Kontinente, Landmarken, Gebäude, Dungeons, Festungen, Wälder, Berge, Flüsse oder andere Orte mit eigenem Namen. Keine unbestimmten Orte wie "ein Wald" oder "der Markt".',
    '',
    'Gib das Ergebnis ausschließlich als gültiges JSON-Objekt in dieser Form zurück:',
    '{"persons": ["..."], "organizations": ["..."], "locations": ["..."]}.',
    'Do NOT modify any files, run any commands or perform any actions. Only output the JSON object.',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-diary-entities-${Date.now()}`,
    onLog,
  });

  if (!result.success) {
    return { persons: [], organizations: [], locations: [] };
  }

  const cleaned = extractRewriteOutput(result.output);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return { persons: [], organizations: [], locations: [] };
  }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (parsed && typeof parsed === 'object') {
      const toStrings = (value: unknown): string[] => {
        if (!Array.isArray(value)) return [];
        return value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      };
      return {
        persons: toStrings(parsed.persons),
        organizations: toStrings(parsed.organizations),
        locations: toStrings(parsed.locations),
      };
    }
  } catch {
    // ignore malformed JSON
  }

  return { persons: [], organizations: [], locations: [] };
}
