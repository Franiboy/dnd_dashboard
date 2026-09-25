import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getModel } from './modelConfig.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { readRewrittenFile } from '../diaryFiles.js';
import {
  clearDiaryEntryDirty,
  getDiaryEntryById,
  getEntryEntities,
} from '../repositories/diary.js';
import { splitEntityLabel } from '../repositories/entityRefs.js';
import { markEntitySummaryDirty } from '../repositories/entitySummaries.js';
import { resolveDiaryEntryArcContext } from './arcContext.js';
import { createLogger } from '../logger.js';
import type { Language } from '../../shared/types.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

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

export function personaLines(
  activePerson: string | null | undefined,
  language: Language = getAiLanguage()
): string[] {
  if (!activePerson) return [];
  return [
    localize(language, 'Perspektive:', 'Perspective:'),
    localize(
      language,
      `- Dieser Tagebucheintrag stammt aus der Sicht von "${activePerson}".`,
      `- This diary entry is written from the perspective of "${activePerson}".`
    ),
    localize(
      language,
      `- Schreibe den Text konsequent aus der Ich-Perspektive von "${activePerson}".`,
      `- Write the text consistently in the first-person perspective of "${activePerson}".`
    ),
    localize(
      language,
      `- Verwende Ton, Wortwahl und Wissen, die zu "${activePerson}" passen, ohne die gegebenen Fakten zu verändern.`,
      `- Use the tone, vocabulary, and knowledge that fit "${activePerson}" without changing the supplied facts.`
    ),
  ];
}

export async function rewriteTextWithAi(
  entryId: number,
  originalHtml: string,
  existingRewrittenContent: string | null,
  existingSessionId: string | null,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<RewriteResult> {
  const runLanguage = language ?? getAiLanguage();
  const plainText = stripHtml(originalHtml).trim();
  if (!plainText) {
    log.warn(`rewriteTextWithAi called with empty content for entry ${entryId}`);
    return { content: null, sessionId: existingSessionId };
  }

  const title = `dnd-diary-${entryId}`;
  const mode = existingRewrittenContent ? 'improve' : 'rewrite';
  const previousContent =
    existingRewrittenContent ||
    localize(runLanguage, '(noch kein Rewrite vorhanden)', '(no rewrite available yet)');
  const arcContext = resolveDiaryEntryArcContext(entryId, runLanguage);

  log.info(`Starting ${mode} for entry ${entryId}`);

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: ${mode === 'rewrite' ? 'Schreibe' : 'Verbessere'} den folgenden deutschen Tagebucheintrag in HTML-Format.`,
      `Task: ${mode === 'rewrite' ? 'Rewrite' : 'Improve'} the following diary entry in HTML format.`
    ),
    ...personaLines(user.activePerson, runLanguage),
    ...(arcContext?.promptLines ?? []),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      `- set_diary_rewrite(entryId=${entryId}, html): Speichert das umgeschriebene HTML. MUSST du am Ende genau ein einziges Mal aufrufen.`,
      `- set_diary_rewrite(entryId=${entryId}, html): Saves the rewritten HTML. You MUST call this exactly once at the end.`
    ),
    t(
      '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
      '- get_entity(type, name, qualifier?): Returns knowledge and summaries for an entity. If several entities have the same name (see list_entities), provide the qualifier of the intended entity.'
    ),
    t(
      `- get_previous_diary_entries(entryId=${entryId}): Liefert vorherige Tagebucheinträge desselben Autors.`,
      `- get_previous_diary_entries(entryId=${entryId}): Returns earlier diary entries by the same author.`
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- Verbessere Grammatik, Stil und Verständlichkeit, aber bewahre den ursprünglichen Sinn und persönlichen Ton.',
      '- Improve grammar, style, and readability while preserving the original meaning and personal tone.'
    ),
    t(
      '- Schreibe den KOMPLETTEN Tagebucheintrag um. Lass keine Absätze, Listen oder Inhalte weg.',
      '- Rewrite the COMPLETE diary entry. Do not omit any paragraphs, lists, or content.'
    ),
    t(
      '- Bewahre alle bestehenden HTML-Tags und Strukturen (Absätze, Überschriften, Listen, Tabellen, fett, kursiv, Links, Farben, Zitate, Code-Blöcke etc.). Ändere nur den Textinhalt, nicht die HTML-Struktur.',
      '- Preserve all existing HTML tags and structures (paragraphs, headings, lists, tables, bold, italic, links, colors, quotes, code blocks, etc.). Change only the text content, not the HTML structure.'
    ),
    t(
      '- Der Editor unterstützt folgende Rich-Text-Formate: h1-h3, p, ul/ol/li (auch verschachtelt), table/thead/tbody/tr/th/td, a, strong/b, em/i, u, s, blockquote, pre, code, span (Farben/Hintergrund) und br. Nutze sie sinnvoll, um den Inhalt übersichtlich zu strukturieren, aber füge keine unnötige Formatierung hinzu.',
      '- The editor supports these rich-text formats: h1-h3, p, ul/ol/li (including nested lists), table/thead/tbody/tr/th/td, a, strong/b, em/i, u, s, blockquote, pre, code, span (colors/background), and br. Use them sensibly to make the content clear, but do not add unnecessary formatting.'
    ),
    t(
      '- Gliedere den Text optisch klar: Ein Thema oder Schauplatz pro Absatz. Vermeide riesige Textwände.',
      '- Structure the text clearly: one topic or location per paragraph. Avoid huge blocks of text.'
    ),
    t(
      '- Wenn du viele gleichartige Fakten, Personen, Orte, Ereignisse oder Verhörpunkte aufzählst, verwende HTML-Aufzählungslisten (<ul><li>...</li></ul>) anstelle eines durch Kommas oder "und" verbundenen Satzes.',
      '- When listing many similar facts, people, places, events, or interrogation points, use HTML bullet lists (<ul><li>...</li></ul>) instead of one sentence connected by commas or "and".'
    ),
    t(
      '- Nutze kurze Zwischenüberschriften (<h2> oder <h3>), um größere Abschnitte (z. B. Orte, Personen, Verhöre, Ereignisse) optisch voneinander zu trennen, falls der Inhalt das hergibt.',
      '- Use short intermediate headings (<h2> or <h3>) to visually separate larger sections (for example, places, people, interrogations, and events) when the content calls for it.'
    ),
    t(
      '- Lüfte den Text: Setze zwischen thematisch unterschiedliche Abschnitte Absatzumbrüche, damit der Eintrag Luft bekommt und nicht zusammengequetscht wirkt.',
      '- Give the text breathing room: place paragraph breaks between thematically different sections so the entry does not feel cramped.'
    ),
    t(
      '- Wickele die Ausgabe nicht in Markdown-Code-Blöcke und füge keine Erklärungen hinzu.',
      '- Do not wrap the output in Markdown code blocks and do not add explanations.'
    ),
    t(
      '- Gib nach dem Tool-Aufruf nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
      '- After the tool call, output only a short confirmation, not the HTML text itself.'
    ),
    t(
      '- DU MUSST die Tools nutzen, um fehlenden Kontext abzufragen, BEVOR du set_diary_rewrite aufrufst.',
      '- You MUST use the tools to retrieve missing context BEFORE calling set_diary_rewrite.'
    ),
    t(
      '- Wenn der Text Personen, Organisationen, Orte oder namenhafte Gegenstände erwähnt, rufe get_entity für jede davon auf – bei Namensgleichheit mit dem Qualifier der im Kontext gemeinten Entität (siehe list_entities).',
      '- If the text mentions people, organizations, locations, or named items, call get_entity for each one; for namesakes, use the qualifier of the entity intended by the context (see list_entities).'
    ),
    t(
      '- Für zeitlichen Kontext rufe get_previous_diary_entries auf.',
      '- For temporal context, call get_previous_diary_entries.'
    ),
    t(
      '- Wenn keine Entitäten erwähnt werden oder keine vorherigen Einträge existieren, speichere das Ergebnis trotzdem direkt.',
      '- If no entities are mentioned or no earlier entries exist, still save the result directly.'
    ),
    '',
    t('Tagebucheintrag:', 'Diary entry:'),
    originalHtml,
    ...(mode === 'improve'
      ? [
          '',
          t('Aktuelles Rewrite (verbessere dieses):', 'Current rewrite (improve this):'),
          previousContent,
        ]
      : []),
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    sessionId: existingSessionId || undefined,
    title,
    scopes: ['diary:read', 'entity:read', 'diary:rewrite'],
    user,
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for entry ${entryId}: exitCode=${result.exitCode}`);
    return { content: null, sessionId: existingSessionId };
  }

  const fileContent = readRewrittenFile(entryId);
  if (!fileContent) {
    log.warn(`No rewritten file content found for entry ${entryId}`);
    return { content: null, sessionId: result.sessionId ?? existingSessionId };
  }

  const finalSessionId = result.sessionId ?? existingSessionId;
  if (finalSessionId) {
    log.info(`Using opencode session for entry ${entryId}: ${finalSessionId}`);
  }

  log.info(`Using rewritten file content for entry ${entryId} (${fileContent.length} bytes)`);
  return { content: normalizeToHtml(fileContent), sessionId: finalSessionId };
}

export async function improveRewrittenWithCommand(
  entryId: number,
  originalHtml: string,
  existingRewrittenContent: string,
  command: string,
  sessionId: string,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<RewriteResult> {
  const runLanguage = language ?? getAiLanguage();
  const plainOriginal = stripHtml(originalHtml).trim();
  const arcContext = resolveDiaryEntryArcContext(entryId, runLanguage);

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      'Aufgabe: Verbessere einen bereits umgeschriebenen deutschen Tagebucheintrag basierend auf einem Benutzerbefehl.',
      'Task: Improve an already rewritten diary entry based on a user command.'
    ),
    ...personaLines(user.activePerson, runLanguage),
    ...(arcContext?.promptLines ?? []),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      `- set_diary_rewrite(entryId=${entryId}, html): Speichert das bearbeitete HTML. MUSST du am Ende genau ein einziges Mal aufrufen.`,
      `- set_diary_rewrite(entryId=${entryId}, html): Saves the edited HTML. You MUST call this exactly once at the end.`
    ),
    t(
      '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
      '- get_entity(type, name, qualifier?): Returns knowledge and summaries for an entity. If several entities have the same name (see list_entities), provide the qualifier of the intended entity.'
    ),
    t(
      `- get_previous_diary_entries(entryId=${entryId}): Liefert vorherige Tagebucheinträge desselben Autors.`,
      `- get_previous_diary_entries(entryId=${entryId}): Returns earlier diary entries by the same author.`
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- Halte die Ausgabe im HTML-Format. Bewahre alle bestehenden HTML-Tags und Strukturen (Absätze, Überschriften, Listen, Tabellen, fett, kursiv, Links, Farben, Zitate, Code-Blöcke etc.).',
      '- Keep the output in HTML format. Preserve all existing HTML tags and structures (paragraphs, headings, lists, tables, bold, italic, links, colors, quotes, code blocks, etc.).'
    ),
    t(
      '- Der Editor unterstützt folgende Rich-Text-Formate: h1-h3, p, ul/ol/li (auch verschachtelt), table/thead/tbody/tr/th/td, a, strong/b, em/i, u, s, blockquote, pre, code, span (Farben/Hintergrund) und br. Nutze sie sinnvoll, um den Inhalt übersichtlich zu strukturieren, aber füge keine unnötige Formatierung hinzu.',
      '- The editor supports these rich-text formats: h1-h3, p, ul/ol/li (including nested lists), table/thead/tbody/tr/th/td, a, strong/b, em/i, u, s, blockquote, pre, code, span (colors/background), and br. Use them sensibly to make the content clear, but do not add unnecessary formatting.'
    ),
    t(
      '- Gliedere den Text optisch klar: Ein Thema oder Schauplatz pro Absatz. Vermeide riesige Textwände.',
      '- Structure the text clearly: one topic or location per paragraph. Avoid huge blocks of text.'
    ),
    t(
      '- Wenn du viele gleichartige Fakten, Personen, Orte, Ereignisse oder Verhörpunkte aufzählst, verwende HTML-Aufzählungslisten (<ul><li>...</li></ul>) anstelle eines durch Kommas oder "und" verbundenen Satzes.',
      '- When listing many similar facts, people, places, events, or interrogation points, use HTML bullet lists (<ul><li>...</li></ul>) instead of one sentence connected by commas or "and".'
    ),
    t(
      '- Nutze kurze Zwischenüberschriften (<h2> oder <h3>), um größere Abschnitte (z. B. Orte, Personen, Verhöre, Ereignisse) optisch voneinander zu trennen, falls der Inhalt das hergibt.',
      '- Use short intermediate headings (<h2> or <h3>) to visually separate larger sections (for example, places, people, interrogations, and events) when the content calls for it.'
    ),
    t(
      '- Lüfte den Text: Setze zwischen thematisch unterschiedliche Abschnitte Absatzumbrüche, damit der Eintrag Luft bekommt und nicht zusammengequetscht wirkt.',
      '- Give the text breathing room: place paragraph breaks between thematically different sections so the entry does not feel cramped.'
    ),
    t(
      '- Ändere nur den Textinhalt wie gewünscht. Wickele die Ausgabe nicht in Markdown-Code-Blöcke.',
      '- Change only the text content as requested. Do not wrap the output in Markdown code blocks.'
    ),
    t(
      '- Gib nach dem Tool-Aufruf nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
      '- After the tool call, output only a short confirmation, not the HTML text itself.'
    ),
    t(
      '- DU MUSST die Tools nutzen, um fehlenden Kontext abzufragen, BEVOR du set_diary_rewrite aufrufst.',
      '- You MUST use the tools to retrieve missing context BEFORE calling set_diary_rewrite.'
    ),
    t(
      '- Wenn der Text oder der Befehl Personen, Organisationen, Orte oder namenhafte Gegenstände erwähnt, rufe get_entity für jede davon auf – bei Namensgleichheit mit dem Qualifier der im Kontext bzw. Befehl gemeinten Entität (siehe list_entities).',
      '- If the text or command mentions people, organizations, locations, or named items, call get_entity for each one; for namesakes, use the qualifier of the entity intended by the context or command (see list_entities).'
    ),
    t(
      '- Für zeitlichen Kontext rufe get_previous_diary_entries auf.',
      '- For temporal context, call get_previous_diary_entries.'
    ),
    t(
      '- Wenn keine Entitäten erwähnt werden oder keine vorherigen Einträge existieren, speichere das Ergebnis trotzdem direkt.',
      '- If no entities are mentioned or no earlier entries exist, still save the result directly.'
    ),
    '',
    t('Benutzerbefehl:', 'User command:'),
    command,
    '',
    t('Aktuelles Rewrite (bearbeite dieses):', 'Current rewrite (edit this):'),
    existingRewrittenContent,
    ...(plainOriginal
      ? [
          '',
          t('Originaler Tagebucheintrag zur Referenz:', 'Original diary entry for reference:'),
          originalHtml,
        ]
      : []),
  ].join('\n');

  log.info(`Applying rewrite command for entry ${entryId}: ${command}`);
  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    sessionId,
    scopes: ['diary:read', 'entity:read', 'diary:rewrite'],
    user,
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  if (!result.success) {
    log.error(`Rewrite command failed for entry ${entryId}: exitCode=${result.exitCode}`);
    return { content: null, sessionId: result.sessionId ?? sessionId };
  }

  const fileContent = readRewrittenFile(entryId);
  if (!fileContent) {
    log.warn(`No rewritten file content found after command for entry ${entryId}`);
    return { content: null, sessionId: result.sessionId ?? sessionId };
  }

  log.info(
    `Using rewritten file content after command for entry ${entryId} (${fileContent.length} bytes)`
  );
  return { content: normalizeToHtml(fileContent), sessionId: result.sessionId ?? sessionId };
}

export async function summarizeTextWithAi(
  entryId: number,
  text: string,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<string | null> {
  const runLanguage = language ?? getAiLanguage();
  const plainText = stripHtml(text);
  if (!plainText) {
    log.warn('summarizeTextWithAi called with empty content');
    return null;
  }

  log.info(`Starting summarize for entry ${entryId} with model ${model ?? 'default'}`);
  const arcContext = resolveDiaryEntryArcContext(entryId, runLanguage);

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      'Aufgabe: Erstelle eine sehr grobe Zusammenfassung des folgenden deutschen Tagebucheintrags.',
      'Task: Create a very rough summary of the following diary entry.'
    ),
    ...personaLines(user.activePerson, runLanguage),
    ...(arcContext?.promptLines ?? []),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      `- set_diary_summary(entryId=${entryId}, summary): Speichert die Zusammenfassung. MUSST du am Ende genau einmal aufrufen.`,
      `- set_diary_summary(entryId=${entryId}, summary): Saves the summary. You MUST call this exactly once at the end.`
    ),
    t(
      '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
      '- get_entity(type, name, qualifier?): Returns knowledge and summaries for an entity. If several entities have the same name (see list_entities), provide the qualifier of the intended entity.'
    ),
    t(
      `- get_previous_diary_entries(entryId=${entryId}): Liefert vorherige Tagebucheinträge desselben Autors.`,
      `- get_previous_diary_entries(entryId=${entryId}): Returns earlier diary entries by the same author.`
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- Die gespeicherte Zusammenfassung darf maximal 500 Zeichen lang sein. Überschreite dieses Limit auf keinen Fall.',
      '- The stored summary may contain at most 500 characters. Never exceed this limit.'
    ),
    t(
      '- Nenne nur die gröbsten Ereignisse, Orte und Handlungsstränge, z. B. "Kampf mit Drachen", "Aufenthalt in Goldenfields", "Verhandlung in Waterdeep".',
      '- Mention only the broadest events, locations, and plot threads, for example "battle with dragons", "stay in Goldenfields", or "negotiation in Waterdeep".'
    ),
    t(
      '- Lass Details, Namen, Vermutungen und Gefühle weg, sofern sie nicht absolut zentral für das gröbste Ereignis sind.',
      '- Omit details, names, speculation, and feelings unless they are absolutely central to the broadest event.'
    ),
    t(
      '- Schreibe keine zusammenhängende Erzählung, sondern eine kurze Liste von knappen Stichpunkten.',
      '- Do not write a continuous narrative; write a short list of concise bullet points.'
    ),
    t(
      '- Halte dich strikt an den vorliegenden Text und erfinke keine Details, die darin nicht stehen.',
      '- Follow the supplied text strictly and do not invent details that are not present.'
    ),
    t(
      '- Gib maximal 3–5 Punkte aus, jeder Punkt in einer eigenen Zeile.',
      '- Output at most 3–5 points, with each point on its own line.'
    ),
    t(
      '- Gib nach dem Tool-Aufruf nur eine kurze Bestätigung aus, nicht die Zusammenfassung selbst.',
      '- After the tool call, output only a short confirmation, not the summary itself.'
    ),
    t(
      '- DU MUSST die Tools nutzen, um Hintergrundinformationen abzufragen, BEVOR du set_diary_summary aufrufst.',
      '- You MUST use the tools to retrieve background information BEFORE calling set_diary_summary.'
    ),
    t(
      '- Wenn der Text Personen, Organisationen, Orte oder namenhafte Gegenstände enthält, rufe get_entity für jede davon auf.',
      '- If the text contains people, organizations, locations, or named items, call get_entity for each one.'
    ),
    t(
      '- Für zeitlichen Kontext rufe get_previous_diary_entries auf.',
      '- For temporal context, call get_previous_diary_entries.'
    ),
    t(
      '- Wenn keine Entitäten erwähnt werden oder keine vorherigen Einträge existieren, speichere die Zusammenfassung trotzdem direkt.',
      '- If no entities are mentioned or no earlier entries exist, still save the summary directly.'
    ),
    '',
    t('Tagebucheintrag:', 'Diary entry:'),
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-diary-summarize-${entryId}-${Date.now()}`,
    scopes: ['diary:read', 'entity:read', 'diary:summarize'],
    user,
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  if (!result.success) {
    log.warn(`Summary failed for entry ${entryId}: exitCode=${result.exitCode}`);
    if (result.sessionId) {
      deleteOpenCodeSession(result.sessionId);
    }
    return null;
  }

  const entry = getDiaryEntryById(entryId);
  const summary = entry?.summary ?? null;
  if (!summary) {
    log.warn(`No summary saved for entry ${entryId}`);
    if (result.sessionId) {
      deleteOpenCodeSession(result.sessionId);
    }
    return null;
  }

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  log.info(`Summary loaded for entry ${entryId} (${summary.length} chars)`);
  return summary;
}

export interface DiaryEntities {
  persons: string[];
  organizations: string[];
  locations: string[];
  items: string[];
}

export async function extractEntitiesFromDiary(
  entryId: number,
  text: string,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<DiaryEntities> {
  const runLanguage = language ?? getAiLanguage();
  const plainText = stripHtml(text);
  if (!plainText) {
    return { persons: [], organizations: [], locations: [], items: [] };
  }

  const arcContext = resolveDiaryEntryArcContext(entryId, runLanguage);

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      'Aufgabe: Extrahiere alle eindeutigen Personen/Charaktere, Organisationen/Fraktionen, Orte und namenhaften Gegenstände aus dem folgenden deutschen Tagebucheintrag.',
      'Task: Extract all distinct people/characters, organizations/factions, locations, and named items from the following diary entry.'
    ),
    ...(arcContext?.promptLines ?? []),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      `- link_diary_entity(entryId=${entryId}, type, name, qualifier?): Verknüpft eine Entität mit diesem Tagebucheintrag. MUSST du für jede gefundene Entität aufrufen.`,
      `- link_diary_entity(entryId=${entryId}, type, name, qualifier?): Links an entity to this diary entry. You MUST call this for every entity found.`
    ),
    t(
      '- list_entities(type?): Listet alle bereits bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) und Mini-Zusammenfassung auf.',
      '- list_entities(type?): Lists all known entities, including qualifiers (to distinguish namesakes) and mini-summaries.'
    ),
    t(
      '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität.',
      '- get_entity(type, name, qualifier?): Returns knowledge and summaries for an entity.'
    ),
    '',
    t('Regeln:', 'Rules:'),
    t(
      '- persons: Lebende Wesen, Charaktere, Tiere mit eigenem Namen oder eindeutiger Bezeichnung. Keine allgemeinen Begriffe wie "Wachen", "Aufständische" oder "Leute".',
      '- persons: Living beings, characters, named animals, or uniquely identified creatures. Do not use generic terms such as "guards", "rebels", or "people".'
    ),
    t(
      '- organizations: Gruppen, Gilden, Fraktionen, Clans, Häuser, Orden, Reiche, Familien, militärische Einheiten, Firmen oder andere Kollektive mit eigenem Namen. Keine allgemeinen Gruppenbezeichnungen.',
      '- organizations: Named groups, guilds, factions, clans, houses, orders, kingdoms, families, military units, companies, or other collectives. Do not use generic group labels.'
    ),
    t(
      '- locations: Städte, Dörfer, Länder, Regionen, Kontinente, Landmarken, Gebäude, Dungeons, Festungen, Wälder, Berge, Flüsse oder andere Orte mit eigenem Namen. Keine unbestimmten Orte wie "ein Wald" oder "der Markt".',
      '- locations: Named cities, villages, countries, regions, continents, landmarks, buildings, dungeons, forts, forests, mountains, rivers, or other places. Do not use vague locations such as "a forest" or "the market".'
    ),
    t(
      '- items: Besondere, namenhafte Gegenstände mit kultureller, magischer oder erzählerischer Bedeutung (z. B. "Die Klinge des Magiers", "Das Amulett von Morath", "Der Schild des Klanruf"), die wiederkehrend erwähnt werden. Keine gewöhnlichen Gebrauchsgegenstände wie Schaufel, Pistole, Fackel, Seil oder Rucksack.',
      '- items: Special named items with cultural, magical, or narrative significance (for example, "the Wizard\'s Blade", "the Amulet of Morath", or "the Clanwarrior\'s Shield") that are mentioned repeatedly. Do not include ordinary items such as a shovel, pistol, torch, rope, or backpack.'
    ),
    '',
    t(
      'DU MUSST die verfügbaren Tools nutzen, um bekannte Entitäten zu ermitteln, BEVOR du link_diary_entity aufrufst:',
      'You MUST use the available tools to identify known entities BEFORE calling link_diary_entity:'
    ),
    t(
      '- Rufe list_entities auf, um alle bereits bekannten Entitäten zu sehen.',
      '- Call list_entities to see all already known entities.'
    ),
    t(
      '- Wenn du unsicher bei einer Schreibweise bist, rufe get_entity(type, name) auf, um den korrekten Namen zu ermitteln.',
      '- If you are unsure about a spelling, call get_entity(type, name) to determine the correct name.'
    ),
    t(
      '- Verwende die exakte Schreibweise, die bereits in der Datenbank existiert, um Dubletten zu vermeiden.',
      '- Use the exact spelling already present in the database to avoid duplicates.'
    ),
    t(
      '- Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), lies den Kontext sorgfältig, entscheide, welche gemeint ist, und übergib bei link_diary_entity deren Qualifier.',
      '- If several entities have the same name (list_entities shows different qualifiers), read the context carefully, decide which one is intended, and pass its qualifier to link_diary_entity.'
    ),
    t(
      '- Existiert eine Entität noch nicht, übernimm den Namen so, wie er im Text genannt wird.',
      '- If an entity does not exist yet, use the name exactly as it appears in the text.'
    ),
    t(
      '- Extrahiere nur Entitäten, die im Text tatsächlich vorkommen. Erfinke keine Details.',
      '- Extract only entities that actually occur in the text. Do not invent details.'
    ),
    t(
      '- Wenn keine Entitäten im Text vorkommen, beende die Aufgabe ohne weitere Tool-Aufrufe.',
      '- If the text contains no entities, finish without any further tool calls.'
    ),
    '',
    t('Tagebucheintrag:', 'Diary entry:'),
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-diary-entities-${entryId}-${Date.now()}`,
    scopes: ['entity:read', 'entity:extract'],
    user,
    arcId: arcContext?.arcId,
    language: runLanguage,
    onLog,
  });

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  if (!result.success) {
    return { persons: [], organizations: [], locations: [], items: [] };
  }

  return getEntryEntities(entryId);
}

export async function processDiaryEntryAi(
  entryId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<boolean> {
  const runLanguage = language ?? getAiLanguage();
  const entry = getDiaryEntryById(entryId);
  if (!entry) {
    log.warn(`processDiaryEntryAi called with unknown entry ${entryId}`);
    return false;
  }

  log.info(`Processing AI for diary entry ${entryId}`);
  const [summary, entities] = await Promise.all([
    summarizeTextWithAi(entryId, entry.content, user, model, onLog, runLanguage),
    extractEntitiesFromDiary(entryId, entry.content, user, model, onLog, runLanguage),
  ]);

  // Linked entities are qualified labels ("Name (Qualifier)") - parse them
  // back so the dirty flag lands on the exact homonym.
  const markDirty = (
    type: 'persons' | 'organizations' | 'locations' | 'items',
    labels: string[]
  ) => {
    for (const label of labels) {
      const { name, qualifier } = splitEntityLabel(label);
      markEntitySummaryDirty(type, name, qualifier);
    }
  };
  markDirty('persons', entities.persons);
  markDirty('organizations', entities.organizations);
  markDirty('locations', entities.locations);
  markDirty('items', entities.items);

  const totalEntities =
    entities.persons.length +
    entities.organizations.length +
    entities.locations.length +
    entities.items.length;

  if (totalEntities > 0) {
    log.info(`Marked ${totalEntities} entity summaries as dirty for entry ${entryId}`);
  }

  try {
    const { distributeKnowledgeFromText } = await import('./knowledge.js');
    await distributeKnowledgeFromText(entry.content, {
      model,
      onLog,
      user,
      origin: { type: 'diary', id: entryId },
      language: runLanguage,
    });
  } catch (err) {
    log.warn(`Knowledge distribution failed for entry ${entryId}: ${err}`);
  }

  clearDiaryEntryDirty(entryId);
  log.info(`Finished AI processing for diary entry ${entryId}, summary=${summary ? 'ok' : 'none'}`);
  return summary !== null;
}
