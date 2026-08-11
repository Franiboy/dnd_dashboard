import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { getDiaryEntryBySessionDraftFor } from '../repositories/diary.js';
import { getSessionById } from '../repositories/recordings.js';
import type { DiaryEntry } from '../../shared/types.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getNormalModel } from './modelConfig.js';
import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getSessionWorkDir } from './sessionWorkdir.js';

const log = createLogger('sessionToDiary');

function getSessionDiarySourceFile(sessionId: number): string {
  return join(getSessionWorkDir(sessionId), 'diary_draft_source.txt');
}

function getSessionDiaryTranscriptFile(sessionId: number): string {
  return join(getSessionWorkDir(sessionId), 'session_diary_transcript.txt');
}

function playerPerspectiveLines(user: McpSessionUser): string[] {
  const lines: string[] = ['Persönliche Perspektive:'];
  if (user.activePerson) {
    lines.push(`- Schreibe den Tagebucheintrag aus der Ich-Perspektive des Charakters "${user.activePerson}".`);
    lines.push(`- Nutze Ton, Wortwahl und Wissen, die zu "${user.activePerson}" passen.`);
  } else {
    lines.push('- Schreibe den Tagebucheintrag aus der Ich-Perspektive des Spielers.');
  }
  if (user.displayName) {
    lines.push(`- Der Spieler ist im Transkript an seinem Discord-Namen "${user.displayName}" erkennbar.`);
    lines.push('- Leite aus dem Transkript heraus, was der Charakter aktiv mitbekommen hat: welche Dialoge er führt, welche Aktionen er selbst ausführt und was er direkt hört oder sieht.');
  }
  lines.push('- Beschränke den Inhalt auf das, was der Charakter selbst erlebt. Vermeide Meta-Wissen oder Szenen, an denen der Charakter nicht beteiligt war.');
  lines.push('- Wenn der Charakter etwas nur aus Erzählungen oder Berichten anderer erfährt, kennzeichne das als Hör-Sage (z. B. "Ich erfuhr, dass...", "Man erzählte mir...").');
  return lines;
}

export async function generateSessionDiaryDraft(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
): Promise<DiaryEntry | null> {
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`generateSessionDiaryDraft called without transcript for session ${sessionId}`);
    return null;
  }

  const source = session.longSummary && session.longSummary.trim()
    ? session.longSummary
    : session.transcript;
  if (!source.trim()) {
    log.warn(`No source text available for session ${sessionId}`);
    return null;
  }

  const sourceFile = getSessionDiarySourceFile(sessionId);
  const transcriptFile = getSessionDiaryTranscriptFile(sessionId);
  mkdirSync(getSessionWorkDir(sessionId), { recursive: true });
  writeFileSync(sourceFile, source, 'utf-8');
  writeFileSync(transcriptFile, session.transcript, 'utf-8');

  log.info(`Starting session-to-diary draft for session ${sessionId} (${source.length} bytes)`);

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Überführe die Session ${session.id} (${session.name}, ${session.startedAt}) in einen persönlichen Tagebucheintrag.`,
    'Du hast zwei Möglichkeiten:',
    '1. Einen passenden vorhandenen Tagebucheintrag erweitern (targetEntryId angeben).',
    '2. Einen komplett neuen Tagebucheintrag erstellen (targetEntryId weglassen).',
    ...playerPerspectiveLines(user),
    '',
    'Entscheidungshilfe für neu vs. bestehend:',
    '- Erstelle einen NEUEN Eintrag, wenn keine passende vorhandene Notiz existiert (anderer Spieltag, andere Abenteuerlinie, kein inhaltlicher Anschluss).',
    '- Erweitere einen BESTEHENDEN Eintrag, wenn ein Tagebucheintrag des Spielers inhaltlich direkt zu dieser Session passt (gleicher Spieltag, gleiche Abenteuerlinie, passender Titel, direkter inhaltlicher Anschluss).',
    '- Wenn du erweiterst, soll der neue Text nahtlos an den bestehenden Eintrag anknüpfen und die neuen Session-Ereignisse integrieren. Der alte Inhalt muss erhalten bleiben.',
    '',
    'Verfügbare Tools:',
    `- get_session_summary(sessionId=${session.id}): Liefert Kurz- und Lang-Zusammenfassung der Session.`,
    `- Lies die Datei ${sourceFile} mit dem read-Tool. Sie enthält den ausführlichen Ausgangstext (Lang-Zusammenfassung oder, falls nicht vorhanden, das Transkript) der Session.`,
    `- Lies die Datei ${transcriptFile} mit dem read-Tool. Sie enthält das vollständige Roh-Transkript. Nutze sie als Referenz, um herzuleiten, was der Spieler aktiv mitbekommen hat.`,
    '- list_user_diary_entries(limit?): Listet die Tagebucheinträge des Spielers auf.',
    '- get_diary_entry(entryId): Liefert den vollständigen Inhalt eines bestimmten Eintrags.',
    '- get_entity(type, name): Liefert Wissen und Zusammenfassungen zu einer Entität.',
    '- list_entities(type?): Listet alle bekannten Entitäten auf.',
    `- set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?): Speichert den Entwurf. Wenn targetEntryId angegeben ist, wird der Entwurf an diesen bestehenden Eintrag angehängt (als KI-Version). Sonst wird ein neuer Eintrag erstellt.`,
    '',
    'Vorgehen:',
    `1. Rufe get_session_summary(sessionId=${session.id}) auf und lies ${sourceFile}, um den Session-Inhalt zu kennen.`,
    `2. Lies ${transcriptFile}, um zu ermitteln, welche Szenen, Dialoge und Ereignisse direkt den Spieler betreffen.`,
    '3. Rufe list_user_diary_entries auf, um bestehende Tagebucheinträge des Spielers zu sehen.',
    '4. Wähle 1-3 vielversprechende Kandidaten aus und prüfe mit get_diary_entry, ob sie zur Session passen (gleicher Spieltag, gleiche Abenteuerlinie, inhaltlicher Anschluss, passender Titel).',
    '5. Entscheide bewusst: Wenn ein passender Eintrag existiert, notiere dessen ID als targetEntryId und erweitere ihn. Wenn kein passender Eintrag existiert, erstelle einen neuen Eintrag (targetEntryId weglassen).',
    '6. Erstelle einen HTML-Tagebucheintrag. Bei bestehendem Eintrag: integriere die vorhandenen Inhalte sinnvoll, erhalte den alten Text und füge die neuen Session-Ereignisse an passender Stelle an. Bei neuem Eintrag: schreibe einen vollständigen Eintrag.',
    '7. Wenn Personen, Organisationen oder Orte vorkommen, prüfe ihre Schreibweise mit list_entities und get_entity.',
    `8. Rufe am Ende genau einmal set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?) auf. Für targetEntryId verwende die ID eines bestehenden Eintrags (Option 1) oder lasse das Feld weg, um einen neuen Eintrag anzulegen (Option 2).`,
    '9. Gib danach nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
    '',
    'Wichtig:',
    '- Halte dich strikt an den vorliegenden Text und erfinke keine Details.',
    '- Verwende die exakte Schreibweise von Entitäten aus der Datenbank.',
    '- Nutze HTML, aber keine Markdown-Code-Blöcke.',
    '- Verwende sinnvolle HTML-Strukturen wie <h2>, <h3>, <p>, <ul>/<li> und <strong>/<em>.',
    '- Verwende kein <h1> als Titel; der Titel wird separat im title-Parameter gespeichert.',
    '- Der Entwurf wird als KI-Version gespeichert. Der ursprüngliche Eintrag bleibt erhalten, bis der Benutzer die KI-Version akzeptiert.',
    '- Bei einem neuen Eintrag wird der Inhalt zunächst leer sein und nur die KI-Version enthält den Text.',
    '- targetEntryId weglassen = NEUER Eintrag. targetEntryId mit ID setzen = BESTEHENDEN Eintrag erweitern.',
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getNormalModel(),
    title: `dnd-session-to-diary-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'diary:read', 'diary:draft', 'entity:read'],
    user,
    onLog,
  });

  if (!result.success) {
    log.error(`OpenCode failed for session-to-diary ${sessionId}: exitCode=${result.exitCode}`);
    if (result.sessionId) {
      deleteOpenCodeSession(result.sessionId);
    }
    return null;
  }

  if (result.sessionId) {
    deleteOpenCodeSession(result.sessionId);
  }

  const entry = getDiaryEntryBySessionDraftFor(sessionId, user.id);
  if (!entry) {
    log.warn(`No diary draft found after session-to-diary for session ${sessionId}`);
    return null;
  }

  log.info(`Session-to-diary draft saved for session ${sessionId} as entry ${entry.id}`);
  return entry;
}
