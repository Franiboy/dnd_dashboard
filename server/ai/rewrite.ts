import { runOpenCode } from './opencode.js';
import { readRewrittenFile } from '../diaryFiles.js';
import { getDiaryEntryById, getEntryEntities } from '../repositories/diary.js';
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

export function normalizeToHtml(text: string): string {
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
  knowledgeContext?: string,
): Promise<RewriteResult> {
  const plainText = stripHtml(originalHtml).trim();
  if (!plainText) {
    log.warn(`rewriteTextWithAi called with empty content for entry ${entryId}`);
    return { content: null, sessionId: existingSessionId };
  }

  const title = `dnd-diary-${entryId}`;
  const mode = existingRewrittenContent ? 'improve' : 'rewrite';
  const previousContent = existingRewrittenContent || '(noch kein Rewrite vorhanden)';

  log.info(`Starting ${mode} for entry ${entryId}`);

  const prompt = [
    `${mode === 'rewrite' ? 'Schreibe' : 'Verbessere'} den folgenden deutschen Tagebucheintrag in HTML-Format.`,
    'Nutze das Tool "set_diary_rewrite", um den finalen HTML-Text zu speichern.',
    '',
    'Wichtig:',
    '- Verbessere Grammatik, Stil und Verständlichkeit, aber bewahre den ursprünglichen Sinn und persönlichen Ton.',
    '- Bewahre alle bestehenden HTML-Tags und Strukturen (Absätze, Überschriften, Listen, fett, kursiv etc.). Ändere nur den Textinhalt, nicht die HTML-Struktur.',
    '- Wickele die Ausgabe nicht in Markdown-Code-Blöcke und füge keine Erklärungen hinzu.',
    ...(knowledgeContext ? [knowledgeContext] : []),
    '',
    'Tagebucheintrag:',
    originalHtml,
    '',
    'Aktuelles Rewrite (verbessere dieses):',
    previousContent,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_MODEL || 'provider/GLM5.2',
    sessionId: existingSessionId || undefined,
    title,
    scopes: ['diary:rewrite'],
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for entry ${entryId}: exitCode=${result.exitCode}`);
    return { content: null, sessionId: existingSessionId };
  }

  const fileContent = readRewrittenFile(entryId);
  if (!fileContent) {
    log.warn(`No rewritten file content found for entry ${entryId}`);
    return { content: null, sessionId: existingSessionId };
  }

  log.info(`Using rewritten file content for entry ${entryId} (${fileContent.length} bytes)`);
  return { content: normalizeToHtml(fileContent), sessionId: existingSessionId };
}

export async function improveRewrittenWithCommand(
  entryId: number,
  originalHtml: string,
  existingRewrittenContent: string,
  command: string,
  sessionId: string,
  model?: string,
  onLog?: (line: string) => void,
  knowledgeContext?: string,
): Promise<RewriteResult> {
  const plainOriginal = stripHtml(originalHtml).trim();

  const prompt = [
    'Verbessere ein bereits umgeschriebenes deutsches Tagebucheintrag basierend auf einem Benutzerbefehl.',
    'Nutze das Tool "set_diary_rewrite", um den finalen HTML-Text zu speichern.',
    '',
    'Wichtig:',
    '- Halte die Ausgabe im HTML-Format. Bewahre alle bestehenden HTML-Tags und Strukturen.',
    '- Ändere nur den Textinhalt wie gewünscht. Wickele die Ausgabe nicht in Markdown-Code-Blöcke.',
    ...(knowledgeContext ? [knowledgeContext] : []),
    '',
    'Benutzerbefehl:',
    command,
    '',
    'Aktuelles Rewrite (bearbeite dieses):',
    existingRewrittenContent,
    ...(plainOriginal
      ? ['', 'Originaler Tagebucheintrag zur Referenz:', originalHtml]
      : []),
  ].join('\n');

  log.info(`Applying rewrite command for entry ${entryId}: ${command}`);
  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_MODEL || 'provider/GLM5.2',
    sessionId,
    scopes: ['diary:rewrite'],
    onLog,
  });

  if (!result.success) {
    log.error(`Rewrite command failed for entry ${entryId}: exitCode=${result.exitCode}`);
    return { content: null, sessionId };
  }

  const fileContent = readRewrittenFile(entryId);
  if (!fileContent) {
    log.warn(`No rewritten file content found after command for entry ${entryId}`);
    return { content: null, sessionId };
  }

  log.info(`Using rewritten file content after command for entry ${entryId} (${fileContent.length} bytes)`);
  return { content: normalizeToHtml(fileContent), sessionId };
}

export async function summarizeTextWithAi(
  entryId: number,
  text: string,
  model?: string,
  onLog?: (line: string) => void,
  knowledgeContext?: string,
): Promise<string | null> {
  const plainText = stripHtml(text);
  if (!plainText) {
    log.warn('summarizeTextWithAi called with empty content');
    return null;
  }

  log.info(`Starting summarize for entry ${entryId} with model ${model ?? 'default'}`);

  const prompt = [
    'Wichtig: Deine Antwort darf maximal 500 Zeichen lang sein. Überschreite dieses Limit auf keinen Fall.',
    ...(knowledgeContext ? [knowledgeContext] : []),
    'Erstelle eine sehr grobe Zusammenfassung des folgenden deutschen Tagebucheintrags.',
    'Nenne nur die gröbten Ereignisse, Orte und Handlungsstränge, z. B. "Kampf mit Drachen", "Aufenthalt in Goldenfields", "Verhandlung in Waterdeep".',
    'Lass Details, Namen, Vermutungen und Gefühle weg, sofern sie nicht absolut zentral für das gröbste Ereignis sind.',
    'Schreibe keine zusammenhängende Erzählung, sondern eine kurze Liste von knappen Stichpunkten.',
    'Halte dich strikt an den vorliegenden Text und erfinke keine Details, die darin nicht stehen.',
    'Gib maximal 3–5 Punkte aus, jeder Punkt in einer eigenen Zeile.',
    'Nutze das Tool "set_diary_summary", um die Zusammenfassung zu speichern.',
    'Antworte ausschließlich auf Deutsch.',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-diary-summarize-${entryId}-${Date.now()}`,
    scopes: ['diary:summarize'],
    onLog,
  });

  if (!result.success) {
    log.warn(`Summary failed for entry ${entryId}: exitCode=${result.exitCode}`);
    return null;
  }

  const entry = getDiaryEntryById(entryId);
  const summary = entry?.summary ?? null;
  if (!summary) {
    log.warn(`No summary saved for entry ${entryId}`);
    return null;
  }

  log.info(`Summary loaded for entry ${entryId} (${summary.length} chars)`);
  return summary;
}

export interface DiaryEntities {
  persons: string[];
  organizations: string[];
  locations: string[];
}

export async function extractEntitiesFromDiary(
  entryId: number,
  text: string,
  model?: string,
  onLog?: (line: string) => void,
  knowledgeContext?: string,
): Promise<DiaryEntities> {
  const plainText = stripHtml(text);
  if (!plainText) {
    return { persons: [], organizations: [], locations: [] };
  }

  const prompt = [
    'Extrahiere alle eindeutigen Personen/Charaktere, Organisationen/Fraktionen und Orte aus dem folgenden deutschen Tagebucheintrag.',
    ...(knowledgeContext ? [knowledgeContext] : []),
    '',
    'Regeln:',
    '- persons: Lebende Wesen, Charaktere, Tiere mit eigenem Namen oder eindeutiger Bezeichnung. Keine allgemeinen Begriffe wie "Wachen", "Aufständische" oder "Leute".',
    '- organizations: Gruppen, Gilden, Fraktionen, Clans, Häuser, Orden, Reiche, Familien, militärische Einheiten, Firmen oder andere Kollektive mit eigenem Namen. Keine allgemeinen Gruppenbezeichnungen.',
    '- locations: Städte, Dörfer, Länder, Regionen, Kontinente, Landmarken, Gebäude, Dungeons, Festungen, Wälder, Berge, Flüsse oder andere Orte mit eigenem Namen. Keine unbestimmten Orte wie "ein Wald" oder "der Markt".',
    '',
    'Für jede gefundene Entität rufe das Tool "link_diary_entity" auf mit:',
    '{"entryId": number, "type": "persons" | "organizations" | "locations", "name": "Entitätsname"}',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || process.env.AI_CHEAP_MODEL || process.env.AI_MODEL || 'provider/GLM5.2',
    title: `dnd-diary-entities-${entryId}-${Date.now()}`,
    scopes: ['entity:extract'],
    onLog,
  });

  if (!result.success) {
    return { persons: [], organizations: [], locations: [] };
  }

  return getEntryEntities(entryId);
}
