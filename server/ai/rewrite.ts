import { runOpenCode } from './opencode.js';

function stripHtml(html: string): string {
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

export async function rewriteTextWithAi(text: string, model?: string): Promise<string | null> {
  const plainText = stripHtml(text);
  if (!plainText) return null;

  const prompt = [
    'Rewrite the following diary entry in German. Improve grammar, style and clarity while preserving the original meaning and personal tone.',
    'Do NOT modify any files, run any commands or perform any actions. Only output the rewritten text.',
    'Keep it concise and natural.',
    '',
    'Diary entry:',
    plainText,
  ].join('\n');

  return runAiPrompt(prompt, `dnd-diary-rewrite-${Date.now()}`, model);
}

export async function summarizeTextWithAi(
  text: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const plainText = stripHtml(text);
  if (!plainText) return null;

  const prompt = [
    'Fasse den folgenden deutschen Tagebucheintrag in 3-5 Sätzen zusammen.',
    'Nenne die wichtigsten Ereignisse und beteiligten Personen/Charaktere.',
    'Maximal 300 Zeichen.',
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
  if (raw === null) return null;
  return raw.replace(/\s+/g, ' ').trim();
}

async function runAiPrompt(
  prompt: string,
  title: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_MODEL || 'provider/GLM5.2',
    title,
    onLog,
  });

  if (!result.success) return null;

  return extractRewriteOutput(result.output);
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

export async function extractPersonsFromDiary(
  text: string,
  model?: string,
  onLog?: (line: string) => void,
): Promise<string[]> {
  const plainText = stripHtml(text);
  if (!plainText) return [];

  const prompt = [
    'Extrahiere alle eindeutigen Personen- und Charakternamen aus dem folgenden deutschen Tagebucheintrag.',
    'Nur Eigennamen oder bekannte Bezeichnungen von lebendigen Wesen, keine allgemeinen Begriffe wie "Wachen", "Aufständische" oder "Leute".',
    'Gib das Ergebnis als gültiges JSON-Array von Strings zurück, z. B. ["Sergei", "Vimak", "Sophie"].',
    'Do NOT modify any files, run any commands or perform any actions. Only output the JSON array.',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-diary-persons-${Date.now()}`,
    onLog,
  });

  if (!result.success) return [];

  const cleaned = extractRewriteOutput(result.output);
  const jsonMatch = cleaned.match(/\[.*\]/s);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p: unknown): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }
  } catch {
    return [];
  }

  return [];
}
