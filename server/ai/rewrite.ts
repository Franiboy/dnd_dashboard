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

export function personaLines(activePerson: string | null | undefined): string[] {
  if (!activePerson) return [];
  return [
    'Perspektive:',
    `- Dieser Tagebucheintrag stammt aus der Sicht von "${activePerson}".`,
    `- Schreibe den Text konsequent aus der Ich-Perspektive von "${activePerson}".`,
    `- Verwende Ton, Wortwahl und Wissen, die zu "${activePerson}" passen, ohne die gegebenen Fakten zu verändern.`,
  ];
}

export async function rewriteTextWithAi(
  entryId: number,
  originalHtml: string,
  existingRewrittenContent: string | null,
  existingSessionId: string | null,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
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
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: ${mode === 'rewrite' ? 'Schreibe' : 'Verbessere'} den folgenden deutschen Tagebucheintrag in HTML-Format.`,
    ...personaLines(user.activePerson),
    '',
    'Verfügbare Tools:',
    `- set_diary_rewrite(entryId=${entryId}, html): Speichert das umgeschriebene HTML. MUSST du am Ende genau ein einziges Mal aufrufen.`,
    '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
    `- get_previous_diary_entries(entryId=${entryId}): Liefert vorherige Tagebucheinträge desselben Autors.`,
    '',
    'Wichtig:',
    '- Verbessere Grammatik, Stil und Verständlichkeit, aber bewahre den ursprünglichen Sinn und persönlichen Ton.',
    '- Schreibe den KOMPLETTEN Tagebucheintrag um. Lass keine Absätze, Listen oder Inhalte weg.',
    '- Bewahre alle bestehenden HTML-Tags und Strukturen (Absätze, Überschriften, Listen, Tabellen, fett, kursiv, Links, Farben, Zitate, Code-Blöcke etc.). Ändere nur den Textinhalt, nicht die HTML-Struktur.',
    '- Der Editor unterstützt folgende Rich-Text-Formate: h1-h3, p, ul/ol/li (auch verschachtelt), table/thead/tbody/tr/th/td, a, strong/b, em/i, u, s, blockquote, pre, code, span (Farben/Hintergrund) und br. Nutze sie sinnvoll, um den Inhalt übersichtlich zu strukturieren, aber füge keine unnötige Formatierung hinzu.',
    '- Gliedere den Text optisch klar: Ein Thema oder Schauplatz pro Absatz. Vermeide riesige Textwände.',
    '- Wenn du viele gleichartige Fakten, Personen, Orte, Ereignisse oder Verhörpunkte aufzählst, verwende HTML-Aufzählungslisten (<ul><li>...</li></ul>) anstelle eines durch Kommas oder "und" verbundenen Satzes.',
    '- Nutze kurze Zwischenüberschriften (<h2> oder <h3>), um größere Abschnitte (z. B. Orte, Personen, Verhöre, Ereignisse) optisch voneinander zu trennen, falls der Inhalt das hergibt.',
    '- Lüfte den Text: Setze zwischen thematisch unterschiedliche Abschnitte Absatzumbrüche, damit der Eintrag Luft bekommt und nicht zusammengequetscht wirkt.',
    '- Wickele die Ausgabe nicht in Markdown-Code-Blöcke und füge keine Erklärungen hinzu.',
    '- Gib nach dem Tool-Aufruf nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
    '- DU MUSST die Tools nutzen, um fehlenden Kontext abzufragen, BEVOR du set_diary_rewrite aufrufst.',
    '- Wenn der Text Personen, Organisationen oder Orte erwähnt, rufe get_entity für jede davon auf – bei Namensgleichheit mit dem Qualifier der im Kontext gemeinten Entität (siehe list_entities).',
    '- Für zeitlichen Kontext rufe get_previous_diary_entries auf.',
    '- Wenn keine Entitäten erwähnt werden oder keine vorherigen Einträge existieren, speichere das Ergebnis trotzdem direkt.',
    '',
    'Tagebucheintrag:',
    originalHtml,
    ...(mode === 'improve' ? ['', 'Aktuelles Rewrite (verbessere dieses):', previousContent] : []),
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    sessionId: existingSessionId || undefined,
    title,
    scopes: ['diary:read', 'entity:read', 'diary:rewrite'],
    user,
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
  onLog?: (line: string) => void
): Promise<RewriteResult> {
  const plainOriginal = stripHtml(originalHtml).trim();

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Verbessere einen bereits umgeschriebenen deutschen Tagebucheintrag basierend auf einem Benutzerbefehl.',
    ...personaLines(user.activePerson),
    '',
    'Verfügbare Tools:',
    `- set_diary_rewrite(entryId=${entryId}, html): Speichert das bearbeitete HTML. MUSST du am Ende genau ein einziges Mal aufrufen.`,
    '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
    `- get_previous_diary_entries(entryId=${entryId}): Liefert vorherige Tagebucheinträge desselben Autors.`,
    '',
    'Wichtig:',
    '- Halte die Ausgabe im HTML-Format. Bewahre alle bestehenden HTML-Tags und Strukturen (Absätze, Überschriften, Listen, Tabellen, fett, kursiv, Links, Farben, Zitate, Code-Blöcke etc.).',
    '- Der Editor unterstützt folgende Rich-Text-Formate: h1-h3, p, ul/ol/li (auch verschachtelt), table/thead/tbody/tr/th/td, a, strong/b, em/i, u, s, blockquote, pre, code, span (Farben/Hintergrund) und br. Nutze sie sinnvoll, um den Inhalt übersichtlich zu strukturieren, aber füge keine unnötige Formatierung hinzu.',
    '- Gliedere den Text optisch klar: Ein Thema oder Schauplatz pro Absatz. Vermeide riesige Textwände.',
    '- Wenn du viele gleichartige Fakten, Personen, Orte, Ereignisse oder Verhörpunkte aufzählst, verwende HTML-Aufzählungslisten (<ul><li>...</li></ul>) anstelle eines durch Kommas oder "und" verbundenen Satzes.',
    '- Nutze kurze Zwischenüberschriften (<h2> oder <h3>), um größere Abschnitte (z. B. Orte, Personen, Verhöre, Ereignisse) optisch voneinander zu trennen, falls der Inhalt das hergibt.',
    '- Lüfte den Text: Setze zwischen thematisch unterschiedliche Abschnitte Absatzumbrüche, damit der Eintrag Luft bekommt und nicht zusammengequetscht wirkt.',
    '- Ändere nur den Textinhalt wie gewünscht. Wickele die Ausgabe nicht in Markdown-Code-Blöcke.',
    '- Gib nach dem Tool-Aufruf nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
    '- DU MUSST die Tools nutzen, um fehlenden Kontext abzufragen, BEVOR du set_diary_rewrite aufrufst.',
    '- Wenn der Text oder der Befehl Personen, Organisationen oder Orte erwähnt, rufe get_entity für jede davon auf – bei Namensgleichheit mit dem Qualifier der im Kontext bzw. Befehl gemeinten Entität (siehe list_entities).',
    '- Für zeitlichen Kontext rufe get_previous_diary_entries auf.',
    '- Wenn keine Entitäten erwähnt werden oder keine vorherigen Einträge existieren, speichere das Ergebnis trotzdem direkt.',
    '',
    'Benutzerbefehl:',
    command,
    '',
    'Aktuelles Rewrite (bearbeite dieses):',
    existingRewrittenContent,
    ...(plainOriginal ? ['', 'Originaler Tagebucheintrag zur Referenz:', originalHtml] : []),
  ].join('\n');

  log.info(`Applying rewrite command for entry ${entryId}: ${command}`);
  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    sessionId,
    scopes: ['diary:read', 'entity:read', 'diary:rewrite'],
    user,
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
  onLog?: (line: string) => void
): Promise<string | null> {
  const plainText = stripHtml(text);
  if (!plainText) {
    log.warn('summarizeTextWithAi called with empty content');
    return null;
  }

  log.info(`Starting summarize for entry ${entryId} with model ${model ?? 'default'}`);

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Erstelle eine sehr grobe Zusammenfassung des folgenden deutschen Tagebucheintrags.',
    ...personaLines(user.activePerson),
    '',
    'Verfügbare Tools:',
    `- set_diary_summary(entryId=${entryId}, summary): Speichert die Zusammenfassung. MUSST du am Ende genau einmal aufrufen.`,
    '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
    `- get_previous_diary_entries(entryId=${entryId}): Liefert vorherige Tagebucheinträge desselben Autors.`,
    '',
    'Wichtig:',
    '- Die gespeicherte Zusammenfassung darf maximal 500 Zeichen lang sein. Überschreite dieses Limit auf keinen Fall.',
    '- Nenne nur die gröbsten Ereignisse, Orte und Handlungsstränge, z. B. "Kampf mit Drachen", "Aufenthalt in Goldenfields", "Verhandlung in Waterdeep".',
    '- Lass Details, Namen, Vermutungen und Gefühle weg, sofern sie nicht absolut zentral für das gröbste Ereignis sind.',
    '- Schreibe keine zusammenhängende Erzählung, sondern eine kurze Liste von knappen Stichpunkten.',
    '- Halte dich strikt an den vorliegenden Text und erfinke keine Details, die darin nicht stehen.',
    '- Gib maximal 3–5 Punkte aus, jeder Punkt in einer eigenen Zeile.',
    '- Gib nach dem Tool-Aufruf nur eine kurze Bestätigung aus, nicht die Zusammenfassung selbst.',
    '- DU MUSST die Tools nutzen, um Hintergrundinformationen abzufragen, BEVOR du set_diary_summary aufrufst.',
    '- Wenn der Text Personen, Organisationen oder Orte enthält, rufe get_entity für jede davon auf.',
    '- Für zeitlichen Kontext rufe get_previous_diary_entries auf.',
    '- Wenn keine Entitäten erwähnt werden oder keine vorherigen Einträge existieren, speichere die Zusammenfassung trotzdem direkt.',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-diary-summarize-${entryId}-${Date.now()}`,
    scopes: ['diary:read', 'entity:read', 'diary:summarize'],
    user,
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
}

export async function extractEntitiesFromDiary(
  entryId: number,
  text: string,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
): Promise<DiaryEntities> {
  const plainText = stripHtml(text);
  if (!plainText) {
    return { persons: [], organizations: [], locations: [] };
  }

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    'Aufgabe: Extrahiere alle eindeutigen Personen/Charaktere, Organisationen/Fraktionen und Orte aus dem folgenden deutschen Tagebucheintrag.',
    '',
    'Verfügbare Tools:',
    `- link_diary_entity(entryId=${entryId}, type, name, qualifier?): Verknüpft eine Entität mit diesem Tagebucheintrag. MUSST du für jede gefundene Entität aufrufen.`,
    '- list_entities(type?): Listet alle bereits bekannten Entitäten inklusive Qualifier (Unterscheidung bei Namensgleichheit) und Mini-Zusammenfassung auf.',
    '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität.',
    '',
    'Regeln:',
    '- persons: Lebende Wesen, Charaktere, Tiere mit eigenem Namen oder eindeutiger Bezeichnung. Keine allgemeinen Begriffe wie "Wachen", "Aufständische" oder "Leute".',
    '- organizations: Gruppen, Gilden, Fraktionen, Clans, Häuser, Orden, Reiche, Familien, militärische Einheiten, Firmen oder andere Kollektive mit eigenem Namen. Keine allgemeinen Gruppenbezeichnungen.',
    '- locations: Städte, Dörfer, Länder, Regionen, Kontinente, Landmarken, Gebäude, Dungeons, Festungen, Wälder, Berge, Flüsse oder andere Orte mit eigenem Namen. Keine unbestimmten Orte wie "ein Wald" oder "der Markt".',
    '',
    'DU MUSST die verfügbaren Tools nutzen, um bekannte Entitäten zu ermitteln, BEVOR du link_diary_entity aufrufst:',
    '- Rufe list_entities auf, um alle bereits bekannten Entitäten zu sehen.',
    '- Wenn du unsicher bei einer Schreibweise bist, rufe get_entity(type, name) auf, um den korrekten Namen zu ermitteln.',
    '- Verwende die exakte Schreibweise, die bereits in der Datenbank existiert, um Dubletten zu vermeiden.',
    '- Gibt es mehrere Entitäten mit demselben Namen (list_entities zeigt sie mit unterschiedlichem Qualifier), lies den Kontext sorgfältig, entscheide, welche gemeint ist, und übergib bei link_diary_entity deren Qualifier.',
    '- Existiert eine Entität noch nicht, übernimm den Namen so, wie er im Text genannt wird.',
    '- Extrahiere nur Entitäten, die im Text tatsächlich vorkommen. Erfinke keine Details.',
    '- Wenn keine Entitäten im Text vorkommen, beende die Aufgabe ohne weitere Tool-Aufrufe.',
    '',
    'Tagebucheintrag:',
    plainText,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-diary-entities-${entryId}-${Date.now()}`,
    scopes: ['entity:read', 'entity:extract'],
    user,
    onLog,
  });

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  if (!result.success) {
    return { persons: [], organizations: [], locations: [] };
  }

  return getEntryEntities(entryId);
}

export async function processDiaryEntryAi(
  entryId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
): Promise<boolean> {
  const entry = getDiaryEntryById(entryId);
  if (!entry) {
    log.warn(`processDiaryEntryAi called with unknown entry ${entryId}`);
    return false;
  }

  log.info(`Processing AI for diary entry ${entryId}`);
  const [summary, entities] = await Promise.all([
    summarizeTextWithAi(entryId, entry.content, user, model, onLog),
    extractEntitiesFromDiary(entryId, entry.content, user, model, onLog),
  ]);

  // Linked entities are qualified labels ("Name (Qualifier)") - parse them
  // back so the dirty flag lands on the exact homonym.
  const markDirty = (type: 'persons' | 'organizations' | 'locations', labels: string[]) => {
    for (const label of labels) {
      const { name, qualifier } = splitEntityLabel(label);
      markEntitySummaryDirty(type, name, qualifier);
    }
  };
  markDirty('persons', entities.persons);
  markDirty('organizations', entities.organizations);
  markDirty('locations', entities.locations);

  if (entities.persons.length + entities.organizations.length + entities.locations.length > 0) {
    log.info(
      `Marked ${entities.persons.length + entities.organizations.length + entities.locations.length} entity summaries as dirty for entry ${entryId}`
    );
  }

  try {
    const { distributeKnowledgeFromText } = await import('./knowledge.js');
    await distributeKnowledgeFromText(entry.content, {
      model,
      onLog,
      user,
      origin: { type: 'diary', id: entryId },
    });
  } catch (err) {
    log.warn(`Knowledge distribution failed for entry ${entryId}: ${err}`);
  }

  clearDiaryEntryDirty(entryId);
  log.info(`Finished AI processing for diary entry ${entryId}, summary=${summary ? 'ok' : 'none'}`);
  return summary !== null;
}
