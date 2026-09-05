import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { getDiaryEntryBySessionDraftFor } from '../repositories/diary.js';
import { getSessionById } from '../repositories/recordings.js';
import type { DiaryEntry } from '../../shared/types.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getAllUsers } from '../users.js';
import { annotateTranscriptSpeakers } from './transcriptSpeakers.js';
import { getModel } from './modelConfig.js';
import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getSessionWorkDir } from './sessionWorkdir.js';
import { resolveSessionArcContext } from './arcContext.js';

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
    lines.push(
      `- Schreibe den Tagebucheintrag aus der Ich-Perspektive des Charakters "${user.activePerson}".`
    );
    lines.push(`- Nutze Ton, Wortwahl und Wissen, die zu "${user.activePerson}" passen.`);
  } else {
    lines.push('- Schreibe den Tagebucheintrag aus der Ich-Perspektive des Spielers.');
  }
  if (user.displayName) {
    lines.push(
      `- Der Spieler ist im Transkript an seinem Discord-Namen "${user.displayName}" erkennbar.`
    );
    lines.push(
      '- Leite aus dem Transkript heraus, was der Charakter aktiv mitbekommen hat: welche Dialoge er führt, welche Aktionen er selbst ausführt und was er direkt hört oder sieht.'
    );
  }
  lines.push(
    '- Beschränke den Inhalt auf das, was der Charakter selbst erlebt. Vermeide Meta-Wissen oder Szenen, an denen der Charakter nicht beteiligt war.'
  );
  lines.push(
    '- Wenn der Charakter etwas nur aus Erzählungen oder Berichten anderer erfährt, kennzeichne das als Hör-Sage (z. B. "Ich erfuhr, dass...", "Man erzählte mir...").'
  );
  return lines;
}

function perspectiveGuardLines(): string[] {
  return [
    'Perspektiv-Regeln (strikt einhalten):',
    '- Stelle für jede Szene zuerst fest, wo sich dein Charakter befindet, und folge einer durchgängigen Zeitleiste seiner eigenen Position.',
    '- Nur Handlungen unter dem Discord-Namen deines Spielers sind Handlungen deines Charakters. Handlungen anderer Charaktere (z. B. "Vimak betritt die Arena") niemals in der Ich-Form übernehmen.',
    '- Szenen, an denen dein Charakter nicht beteiligt ist, gehören NICHT in den Eintrag – auch wenn die Zusammenfassung sie beschreibt. Höchstens als Hör-Sage, wenn dein Charakter davon erfährt.',
    '- Achtung bei getrennten Gruppen (Split-Party): Dein Charakter kann nicht gleichzeitig an zwei Orten sein. Hat er die Gruppe verlassen, erlebt er spätere Szenen der anderen nicht mit.',
    '- Kommentare deines Spielers im Transkript (Spott, Regel- oder Wettdiskussionen, Meta-Gerede) sind Out-of-Character-Gerede und bedeuten weder Anwesenheit noch Handlung des Charakters.',
    '- Der Spielleiter (DM) hat keinen Charakter; er beschreibt nur die Welt und die NPCs.',
  ];
}

function formatOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function sessionBoundaryLines(session: {
  gameBoundaryDetectedAt: string | null;
  gameStartSeconds: number | null;
  gameEndSeconds: number | null;
}): string[] {
  if (
    !session.gameBoundaryDetectedAt ||
    session.gameStartSeconds === null ||
    session.gameEndSeconds === null
  ) {
    return [
      '',
      'Achte darauf, dass die Aufnahme vor und nach der eigentlichen Spiel-Session Vorbesprechung/Teambesprechung und Small Talk enthält. Beziehe dich im Tagebucheintrag nur auf die tatsächliche Spiel-Session, nicht auf organisatorisches Vorgeplänkel oder Verabschiedungen.',
    ];
  }
  return [
    '',
    `Die eigentliche Spiel-Session beginnt im Transkript bei Offset ${session.gameStartSeconds} Sekunden (${formatOffset(session.gameStartSeconds)}) und endet bei Offset ${session.gameEndSeconds} Sekunden (${formatOffset(session.gameEndSeconds)}).`,
    'Alles davor (Vorbesprechung, Small Talk) und danach (Small Talk, Verabschiedung) gehört NICHT zur Spiel-Session und darf nicht in den Tagebucheintrag einfließen.',
  ];
}

export async function generateSessionDiaryDraft(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void
): Promise<DiaryEntry | null> {
  const session = getSessionById(sessionId);
  if (!session || !session.transcript || !session.transcript.trim()) {
    log.warn(`generateSessionDiaryDraft called without transcript for session ${sessionId}`);
    return null;
  }

  const longSummary = session.longSummary && session.longSummary.trim();
  const source = longSummary ? longSummary : session.transcript;
  if (!source.trim()) {
    log.warn(`No source text available for session ${sessionId}`);
    return null;
  }

  const users = getAllUsers();
  const annotatedTranscript = annotateTranscriptSpeakers(session.transcript, users, user.id);

  const sourceFile = getSessionDiarySourceFile(sessionId);
  const transcriptFile = getSessionDiaryTranscriptFile(sessionId);
  mkdirSync(getSessionWorkDir(sessionId), { recursive: true });
  writeFileSync(sourceFile, longSummary ? source : annotatedTranscript.transcript, 'utf-8');
  writeFileSync(transcriptFile, annotatedTranscript.transcript, 'utf-8');

  log.info(`Starting session-to-diary draft for session ${sessionId} (${source.length} bytes)`);
  const arcContext = resolveSessionArcContext(sessionId);

  const prompt = [
    'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
    '',
    `Aufgabe: Überführe die Session ${session.id} (${session.name}, ${session.startedAt}) in einen persönlichen Tagebucheintrag.`,
    ...(arcContext?.promptLines ?? []),
    'Grundregel für neu vs. bestehend:',
    '- Ein Tagebucheintrag entspricht einem Spieltag (in-game Tag).',
    '- Prüfe zuerst, ob wir uns an einem laufenden Spieltag befinden.',
    '- Wenn ein bestehender Tagebucheintrag des Spielers zum aktuellen, laufenden Spieltag gehört, erweitere diesen Eintrag (targetEntryId = ID des Eintrags).',
    '- Wenn mit dieser Session ein neuer Spieltag anbricht, erstelle einen neuen Tagebucheintrag (targetEntryId weglassen).',
    ...playerPerspectiveLines(user),
    '',
    'Zuordnung der Sprecher im Transkript:',
    ...(annotatedTranscript.mappingLines.length > 0
      ? annotatedTranscript.mappingLines
      : ['- (keine Sprechernamen im Transkript erkannt)']),
    '',
    ...perspectiveGuardLines(),
    '',
    ...sessionBoundaryLines(session),
    '',
    'Verfügbare Tools:',
    `- get_session_summary(sessionId=${session.id}): Liefert Kurz- und Lang-Zusammenfassung der Session.`,
    `- Lies die Datei ${sourceFile} mit dem read-Tool. Sie enthält den ausführlichen Ausgangstext (Lang-Zusammenfassung oder, falls nicht vorhanden, das Transkript) der Session.`,
    `- Lies die Datei ${transcriptFile} mit dem read-Tool. Sie enthält das vollständige Transkript; die Sprecher sind mit "Charakter (Discord-Name)" bzw. "Spielleiter (Name)" gekennzeichnet, dein Charakter zusätzlich mit "(du)". Nutze sie als Referenz, um herzuleiten, was der Spieler aktiv mitbekommen hat.`,
    '- list_user_diary_entries(limit?): Listet die Tagebucheinträge des Spielers auf.',
    '- get_diary_entry(entryId): Liefert den vollständigen Inhalt eines bestimmten Eintrags.',
    '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
    '- list_entities(type?): Listet alle bekannten Entitäten auf.',
    `- set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?): Speichert den Entwurf. Wenn targetEntryId angegeben ist, wird der Entwurf an diesen bestehenden Eintrag angehängt (als KI-Version). Sonst wird ein neuer Eintrag erstellt.`,
    '',
    'Vorgehen:',
    `1. Rufe get_session_summary(sessionId=${session.id}) auf und lies ${sourceFile}, um den Session-Inhalt zu kennen.`,
    `2. Lies ${transcriptFile}, um zu ermitteln, welche Szenen, Dialoge und Ereignisse direkt den Spieler betreffen (Sprecher mit "(du)").`,
    '3. Rufe list_user_diary_entries auf, um die aktuellsten Tagebucheinträge des Spielers zu sehen.',
    '4. Prüfe mit get_diary_entry die neuesten Einträge und bestimme den laufenden Spieltag (Titel, Inhalt, Datums-/Tageshinweise).',
    '5. Vergleiche den laufenden Spieltag mit der aktuellen Session. Befinden wir uns am selben, laufenden Spieltag? Dann erweitere den passenden Eintrag (targetEntryId = ID). Beginnt mit dieser Session ein neuer Spieltag? Dann erstelle einen neuen Eintrag (targetEntryId weglassen).',
    '6. Erstelle einen HTML-Tagebucheintrag ausschließlich aus der Perspektive deines Charakters. Bei bestehendem Eintrag: integriere die vorhandenen Inhalte sinnvoll, erhalte den alten Text und füge die neuen Session-Ereignisse an passender Stelle an. Bei neuem Eintrag: schreibe einen vollständigen Eintrag.',
    '7. Wenn Personen, Organisationen, Orte oder namenhafte Gegenstände vorkommen, prüfe ihre Schreibweise mit list_entities und get_entity. Gibt es mehrere Entitäten mit demselben Namen, verwende durchgehend die mit dem zur Szene passenden Qualifier (Anzeigeform „Name (Qualifier)“).',
    '8. Prüfe den Entwurf auf Perspektiv-Widersprüche: Befindet sich dein Charakter in jeder Szene? Kann er sich dort aufhalten (keine zwei Orte gleichzeitig, keine Szenen nach seiner Abreise)? Stehen Handlungen anderer Charaktere in der Ich-Form? Korrigiere solche Stellen, bevor du speicherst.',
    `9. Rufe am Ende genau einmal set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?) auf. targetEntryId nur setzen, wenn ein Eintrag zum laufenden Spieltag erweitert wird; sonst weglassen, um einen neuen Eintrag anzulegen.`,
    '10. Gib danach nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
    '',
    'Wichtig:',
    '- Halte dich strikt an den vorliegenden Text und erfinke keine Details.',
    '- Die Lang-Zusammenfassung ist die Faktenquelle und nennt Handlungen mit dem Namen des Handelnden (z. B. "Vimak betritt die Arena"). Übernimm diese Zuordnungen exakt und schreibe Handlungen anderer Charaktere niemals in der Ich-Form.',
    '- Verwende die exakte Schreibweise von Entitäten aus der Datenbank.',
    '- Nutze HTML, aber keine Markdown-Code-Blöcke.',
    '- Verwende sinnvolle HTML-Strukturen wie <h2>, <h3>, <p>, <ul>/<li> und <strong>/<em>.',
    '- Verwende kein <h1> als Titel; der Titel wird separat im title-Parameter gespeichert.',
    '- Der Entwurf wird als KI-Version gespeichert. Der ursprüngliche Eintrag bleibt erhalten, bis der Benutzer die KI-Version akzeptiert.',
    '- Bei einem neuen Eintrag wird der Inhalt zunächst leer sein und nur die KI-Version enthält den Text.',
    '- targetEntryId weglassen = neuer Eintrag für einen neuen Spieltag. targetEntryId mit ID setzen = Eintrag zum laufenden Spieltag erweitern.',
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-to-diary-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'diary:read', 'diary:draft', 'entity:read'],
    user,
    arcId: arcContext?.arcId,
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
