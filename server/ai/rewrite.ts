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
    'Beschreibe die wichtigsten Ereignisse und Ergebnisse knapp und prägnant.',
    'Nenne relevante Namen nur im Fließtext, wenn sie für das Ereignis wichtig sind.',
    'Füge am Ende keine eigene Aufzählung von Beteiligten, Gruppen oder Orten hinzu.',
    'Halte dich strikt an den vorliegenden Text und erfinke keine Details (z. B. Orte, Personen oder Ursachen), die darin nicht stehen.',
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
