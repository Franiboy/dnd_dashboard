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

export async function summarizeTextWithAi(text: string, model?: string): Promise<string | null> {
  const plainText = stripHtml(text);
  if (!plainText) return null;

  const prompt = [
    'Fasse den folgenden deutschen Tagebucheintrag kurz und prägnant zusammen (maximal 300 Zeichen).',
    'Do NOT modify any files, run any commands or perform any actions. Only output the summary text.',
    'Antworte ausschließlich auf Deutsch.',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  return runAiPrompt(
    prompt,
    `dnd-diary-summarize-${Date.now()}`,
    model || process.env.AI_CHEAP_MODEL,
  );
}

async function runAiPrompt(prompt: string, title: string, model?: string): Promise<string | null> {

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_MODEL || 'provider/GLM5.2',
    title,
  });

  if (!result.success) return null;

  return extractRewriteOutput(result.output);
}

function extractRewriteOutput(raw: string): string {
  const trimmed = raw.trim();

  // If the model wrapped the output in a markdown code block, extract it.
  const codeBlockMatch = trimmed.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  return trimmed;
}
