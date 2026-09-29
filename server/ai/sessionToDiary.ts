import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { getDiaryEntryBySessionDraftFor } from '../repositories/diary.js';
import { getSessionById } from '../repositories/recordings.js';
import type { DiaryEntry, Language } from '../../shared/types.js';
import type { McpSessionUser } from '../mcp/tokens.js';
import { getAllUsers } from '../repositories/users.js';
import { annotateTranscriptSpeakers } from './transcriptSpeakers.js';
import { getModel } from './modelConfig.js';
import { deleteOpenCodeSession, runOpenCode } from './opencode.js';
import { getSessionWorkDir } from './sessionWorkdir.js';
import { resolveSessionArcContext } from './arcContext.js';
import { getAiLanguage } from './languageConfig.js';
import { localize, outputLanguageInstruction } from './promptLanguage.js';

const log = createLogger('sessionToDiary');

function getSessionDiarySourceFile(sessionId: number): string {
  return join(getSessionWorkDir(sessionId), 'diary_draft_source.txt');
}

function getSessionDiaryTranscriptFile(sessionId: number): string {
  return join(getSessionWorkDir(sessionId), 'session_diary_transcript.txt');
}

export function playerPerspectiveLines(user: McpSessionUser, language: Language): string[] {
  const t = (german: string, english: string) => localize(language, german, english);
  const lines: string[] = [t('Persönliche Perspektive:', 'Personal perspective:')];
  if (user.activePerson) {
    lines.push(
      t(
        `- Schreibe den Tagebucheintrag aus der Ich-Perspektive des Charakters "${user.activePerson}".`,
        `- Write the diary entry from the first-person perspective of the character "${user.activePerson}".`
      )
    );
    lines.push(
      t(
        `- Nutze Ton, Wortwahl und Wissen, die zu "${user.activePerson}" passen.`,
        `- Use the tone, vocabulary, and knowledge that fit "${user.activePerson}".`
      )
    );
  } else {
    lines.push(
      t(
        '- Schreibe den Tagebucheintrag aus der Ich-Perspektive des Spielers.',
        "- Write the diary entry from the player's first-person perspective."
      )
    );
  }
  if (user.displayName) {
    lines.push(
      t(
        `- Der Spieler ist im Transkript an seinem Discord-Namen "${user.displayName}" erkennbar.`,
        `- The player is identifiable in the transcript by the Discord name "${user.displayName}".`
      )
    );
    lines.push(
      t(
        '- Leite aus dem Transkript heraus, was der Charakter aktiv mitbekommen hat: welche Dialoge er führt, welche Aktionen er selbst ausführt und was er direkt hört oder sieht.',
        '- Infer from the transcript what the character actively experienced: which dialogues they conduct, which actions they perform themselves, and what they directly hear or see.'
      )
    );
  }
  lines.push(
    t(
      '- Beschränke den Inhalt auf das, was der Charakter selbst erlebt. Vermeide Meta-Wissen oder Szenen, an denen der Charakter nicht beteiligt war.',
      '- Limit the content to what the character experienced personally. Avoid meta-knowledge or scenes in which the character was not involved.'
    )
  );
  lines.push(
    t(
      '- Wenn der Charakter etwas nur aus Erzählungen oder Berichten anderer erfährt, kennzeichne das als Hör-Sage (z. B. "Ich erfuhr, dass...", "Man erzählte mir...").',
      '- If the character learns something only from another person\'s account or report, mark it as hearsay (for example, "I learned that...", "Someone told me...").'
    )
  );
  return lines;
}

export function perspectiveGuardLines(language: Language): string[] {
  const t = (german: string, english: string) => localize(language, german, english);
  return [
    t('Perspektiv-Regeln (strikt einhalten):', 'Perspective rules (strictly follow):'),
    t(
      '- Stelle für jede Szene zuerst fest, wo sich dein Charakter befindet, und folge einer durchgängigen Zeitleiste seiner eigenen Position.',
      '- First establish where your character is in each scene, and follow a consistent timeline of their own location.'
    ),
    t(
      '- Nur Handlungen unter dem Discord-Namen deines Spielers sind Handlungen deines Charakters. Handlungen anderer Charaktere (z. B. "Ruvan betritt die Arena") niemals in der Ich-Form übernehmen.',
      "- Only actions under your player's Discord name are your character's actions. Never rewrite another character's actions (for example, \"Ruvan enters the arena\") in the first person."
    ),
    t(
      '- Szenen, an denen dein Charakter nicht beteiligt ist, gehören NICHT in den Eintrag – auch wenn die Zusammenfassung sie beschreibt. Höchstens als Hör-Sage, wenn dein Charakter davon erfährt.',
      '- Scenes in which your character is not involved do NOT belong in the entry, even if the summary describes them. Include them only as hearsay if your character learns about them.'
    ),
    t(
      '- Achtung bei getrennten Gruppen (Split-Party): Dein Charakter kann nicht gleichzeitig an zwei Orten sein. Hat er die Gruppe verlassen, erlebt er spätere Szenen der anderen nicht mit.',
      '- Be careful with split parties: your character cannot be in two places at once. If the character left the group, they do not experience later scenes involving the others.'
    ),
    t(
      '- Kommentare deines Spielers im Transkript (Spott, Regel- oder Wettdiskussionen, Meta-Gerede) sind Out-of-Character-Gerede und bedeuten weder Anwesenheit noch Handlung des Charakters.',
      "- Your player's comments in the transcript (mockery, rules or wager discussions, and meta-talk) are out-of-character speech and imply neither presence nor action by the character."
    ),
    t(
      '- Der Spielleiter (DM) hat keinen Charakter; er beschreibt nur die Welt und die NPCs.',
      '- The Dungeon Master (DM) has no character; the DM only describes the world and NPCs.'
    ),
  ];
}

function formatOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function sessionBoundaryLines(
  session: {
    gameBoundaryDetectedAt: string | null;
    gameStartSeconds: number | null;
    gameEndSeconds: number | null;
  },
  language: Language
): string[] {
  const t = (german: string, english: string) => localize(language, german, english);
  if (
    !session.gameBoundaryDetectedAt ||
    session.gameStartSeconds === null ||
    session.gameEndSeconds === null
  ) {
    return [
      '',
      t(
        'Achte darauf, dass die Aufnahme vor und nach der eigentlichen Spiel-Session Vorbesprechung/Teambesprechung und Small Talk enthält. Beziehe dich im Tagebucheintrag nur auf die tatsächliche Spiel-Session, nicht auf organisatorisches Vorgeplänkel oder Verabschiedungen.',
        'Note that the recording contains pre-session or team discussion and small talk before and after the actual game session. Base the diary entry only on the actual game session, not on organizational planning or goodbyes.'
      ),
    ];
  }
  return [
    '',
    t(
      `Die eigentliche Spiel-Session beginnt im Transkript bei Offset ${session.gameStartSeconds} Sekunden (${formatOffset(session.gameStartSeconds)}) und endet bei Offset ${session.gameEndSeconds} Sekunden (${formatOffset(session.gameEndSeconds)}).`,
      `The actual game session begins in the transcript at offset ${session.gameStartSeconds} seconds (${formatOffset(session.gameStartSeconds)}) and ends at offset ${session.gameEndSeconds} seconds (${formatOffset(session.gameEndSeconds)}).`
    ),
    t(
      'Alles davor (Vorbesprechung, Small Talk) und danach (Small Talk, Verabschiedung) gehört NICHT zur Spiel-Session und darf nicht in den Tagebucheintrag einfließen.',
      'Everything before it (pre-session discussion, small talk) and afterward (small talk, goodbyes) does NOT belong to the game session and must not influence the diary entry.'
    ),
  ];
}

export async function generateSessionDiaryDraft(
  sessionId: number,
  user: McpSessionUser,
  model?: string,
  onLog?: (line: string) => void,
  language?: Language
): Promise<DiaryEntry | null> {
  const runLanguage = language ?? getAiLanguage();
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
  const annotatedTranscript = annotateTranscriptSpeakers(
    session.transcript,
    users,
    user.id,
    runLanguage
  );

  const sourceFile = getSessionDiarySourceFile(sessionId);
  const transcriptFile = getSessionDiaryTranscriptFile(sessionId);
  mkdirSync(getSessionWorkDir(sessionId), { recursive: true });
  writeFileSync(sourceFile, longSummary ? source : annotatedTranscript.transcript, 'utf-8');
  writeFileSync(transcriptFile, annotatedTranscript.transcript, 'utf-8');

  log.info(`Starting session-to-diary draft for session ${sessionId} (${source.length} bytes)`);
  const arcContext = resolveSessionArcContext(sessionId, runLanguage);

  const t = (german: string, english: string) => localize(runLanguage, german, english);
  const prompt = [
    t(
      'Du bist ein Assistent für ein D&D-Tagebuch-System. Du arbeitest ausschließlich über die bereitgestellten Tools und antwortest prägnant auf Deutsch.',
      'You are an assistant for a D&D diary system. You work exclusively through the provided tools and respond concisely in English.'
    ),
    outputLanguageInstruction(runLanguage),
    '',
    t(
      `Aufgabe: Überführe die Session ${session.id} (${session.name}, ${session.startedAt}) in einen persönlichen Tagebucheintrag.`,
      `Task: Turn session ${session.id} (${session.name}, ${session.startedAt}) into a personal diary entry.`
    ),
    ...(arcContext?.promptLines ?? []),
    t('Grundregel für neu vs. bestehend:', 'Basic rule for new versus existing entries:'),
    t(
      '- Ein Tagebucheintrag entspricht einem Spieltag (in-game Tag).',
      '- One diary entry corresponds to one game day (in-game day).'
    ),
    t(
      '- Prüfe zuerst, ob wir uns an einem laufenden Spieltag befinden.',
      '- First check whether we are on an ongoing game day.'
    ),
    t(
      '- Wenn ein bestehender Tagebucheintrag des Spielers zum aktuellen, laufenden Spieltag gehört, erweitere diesen Eintrag (targetEntryId = ID des Eintrags).',
      '- If an existing diary entry belongs to the current ongoing game day, extend that entry (targetEntryId = the entry ID).'
    ),
    t(
      '- Wenn mit dieser Session ein neuer Spieltag anbricht, erstelle einen neuen Tagebucheintrag (targetEntryId weglassen).',
      '- If this session starts a new game day, create a new diary entry (omit targetEntryId).'
    ),
    ...playerPerspectiveLines(user, runLanguage),
    '',
    t('Zuordnung der Sprecher im Transkript:', 'Speaker mapping in the transcript:'),
    ...(annotatedTranscript.mappingLines.length > 0
      ? annotatedTranscript.mappingLines
      : [
          t(
            '- (keine Sprechernamen im Transkript erkannt)',
            '- (no speaker names recognized in the transcript)'
          ),
        ]),
    '',
    ...perspectiveGuardLines(runLanguage),
    '',
    ...sessionBoundaryLines(session, runLanguage),
    '',
    t('Verfügbare Tools:', 'Available tools:'),
    t(
      `- get_session_summary(sessionId=${session.id}): Liefert Kurz- und Lang-Zusammenfassung der Session.`,
      `- get_session_summary(sessionId=${session.id}): Returns the short and long summary of the session.`
    ),
    t(
      `- Lies die Datei ${sourceFile} mit dem read-Tool. Sie enthält den ausführlichen Ausgangstext (Lang-Zusammenfassung oder, falls nicht vorhanden, das Transkript) der Session.`,
      `- Read the file ${sourceFile} with the read tool. It contains the detailed source text for the session (the long summary or, if unavailable, the transcript).`
    ),
    t(
      `- Lies die Datei ${transcriptFile} mit dem read-Tool. Sie enthält das vollständige Transkript; die Sprecher sind mit "Charakter (Discord-Name)" bzw. "Spielleiter (Name)" gekennzeichnet, dein Charakter zusätzlich mit "(du)". Nutze sie als Referenz, um herzuleiten, was der Spieler aktiv mitbekommen hat.`,
      `- Read the file ${transcriptFile} with the read tool. It contains the complete transcript; speakers are labeled "Character (Discord name)" or "Dungeon Master (name)", and your character is additionally marked "(you)". Use it as a reference to infer what the player actively experienced.`
    ),
    t(
      '- list_user_diary_entries(limit?): Listet die Tagebucheinträge des Spielers auf.',
      "- list_user_diary_entries(limit?): Lists the player's diary entries."
    ),
    t(
      '- get_diary_entry(entryId): Liefert den vollständigen Inhalt eines bestimmten Eintrags.',
      '- get_diary_entry(entryId): Returns the complete content of a specific entry.'
    ),
    t(
      '- get_entity(type, name, qualifier?): Liefert Wissen und Zusammenfassungen zu einer Entität. Gibt es mehrere Entitäten mit demselben Namen (siehe list_entities), gib den Qualifier der gemeinten Entität an.',
      '- get_entity(type, name, qualifier?): Returns knowledge and summaries for an entity. If several entities have the same name (see list_entities), provide the qualifier of the intended entity.'
    ),
    t(
      '- list_entities(type?): Listet alle bekannten Entitäten auf.',
      '- list_entities(type?): Lists all known entities.'
    ),
    t(
      `- set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?): Speichert den Entwurf. Wenn targetEntryId angegeben ist, wird der Entwurf an diesen bestehenden Eintrag angehängt (als KI-Version). Sonst wird ein neuer Eintrag erstellt.`,
      `- set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?): Saves the draft. If targetEntryId is provided, the draft is appended to that existing entry as an AI version; otherwise, a new entry is created.`
    ),
    '',
    t('Vorgehen:', 'Procedure:'),
    t(
      `1. Rufe get_session_summary(sessionId=${session.id}) auf und lies ${sourceFile}, um den Session-Inhalt zu kennen.`,
      `1. Call get_session_summary(sessionId=${session.id}) and read ${sourceFile} to learn the session content.`
    ),
    t(
      `2. Lies ${transcriptFile}, um zu ermitteln, welche Szenen, Dialoge und Ereignisse direkt den Spieler betreffen (Sprecher mit "(du)").`,
      `2. Read ${transcriptFile} to determine which scenes, dialogues, and events directly involve the player (speakers marked "(you)").`
    ),
    t(
      '3. Rufe list_user_diary_entries auf, um die aktuellsten Tagebucheinträge des Spielers zu sehen.',
      "3. Call list_user_diary_entries to see the player's latest diary entries."
    ),
    t(
      '4. Prüfe mit get_diary_entry die neuesten Einträge und bestimme den laufenden Spieltag (Titel, Inhalt, Datums-/Tageshinweise).',
      '4. Use get_diary_entry to inspect the latest entries and determine the ongoing game day (title, content, and date/day clues).'
    ),
    t(
      '5. Vergleiche den laufenden Spieltag mit der aktuellen Session. Befinden wir uns am selben, laufenden Spieltag? Dann erweitere den passenden Eintrag (targetEntryId = ID). Beginnt mit dieser Session ein neuer Spieltag? Dann erstelle einen neuen Eintrag (targetEntryId weglassen).',
      '5. Compare the ongoing game day with the current session. Are we on the same ongoing game day? Then extend the matching entry (targetEntryId = ID). Does this session start a new game day? Then create a new entry (omit targetEntryId).'
    ),
    t(
      '6. Erstelle einen HTML-Tagebucheintrag ausschließlich aus der Perspektive deines Charakters. Bei bestehendem Eintrag: integriere die vorhandenen Inhalte sinnvoll, erhalte den alten Text und füge die neuen Session-Ereignisse an passender Stelle an. Bei neuem Eintrag: schreibe einen vollständigen Eintrag.',
      "6. Create an HTML diary entry exclusively from your character's perspective. For an existing entry, integrate the existing content sensibly, preserve the old text, and add the new session events in appropriate places. For a new entry, write a complete entry."
    ),
    t(
      '7. Wenn Personen, Organisationen, Orte oder namenhafte Gegenstände vorkommen, prüfe ihre Schreibweise mit list_entities und get_entity. Gibt es mehrere Entitäten mit demselben Namen, verwende durchgehend die mit dem zur Szene passenden Qualifier (Anzeigeform „Name (Qualifier)“).',
      '7. When people, organizations, locations, or named items appear, check their spellings with list_entities and get_entity. If several entities have the same name, consistently use the qualifier that fits the scene (display form "Name (Qualifier)").'
    ),
    t(
      '8. Prüfe den Entwurf auf Perspektiv-Widersprüche: Befindet sich dein Charakter in jeder Szene? Kann er sich dort aufhalten (keine zwei Orte gleichzeitig, keine Szenen nach seiner Abreise)? Stehen Handlungen anderer Charaktere in der Ich-Form? Korrigiere solche Stellen, bevor du speicherst.',
      "8. Check the draft for perspective contradictions: Is your character present in every scene? Could they be there (not in two places at once and not in scenes after leaving)? Are other characters' actions written in the first person? Correct such passages before saving."
    ),
    t(
      `9. Rufe am Ende genau einmal set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?) auf. targetEntryId nur setzen, wenn ein Eintrag zum laufenden Spieltag erweitert wird; sonst weglassen, um einen neuen Eintrag anzulegen.`,
      `9. At the end, call set_session_diary_draft(sessionId=${session.id}, title, html, targetEntryId?) exactly once. Set targetEntryId only when extending an entry for the ongoing game day; otherwise omit it to create a new entry.`
    ),
    t(
      '10. Gib danach nur eine kurze Bestätigung aus, nicht den HTML-Text selbst.',
      '10. Then output only a short confirmation, not the HTML text itself.'
    ),
    '',
    t('Wichtig:', 'Important:'),
    t(
      '- Halte dich strikt an den vorliegenden Text und erfinke keine Details.',
      '- Follow the supplied text strictly and do not invent details.'
    ),
    t(
      '- Die Lang-Zusammenfassung ist die Faktenquelle und nennt Handlungen mit dem Namen des Handelnden (z. B. "Ruvan betritt die Arena"). Übernimm diese Zuordnungen exakt und schreibe Handlungen anderer Charaktere niemals in der Ich-Form.',
      '- The long summary is the source of facts and identifies actions by the acting character (for example, "Ruvan enters the arena"). Preserve these attributions exactly and never write another character\'s actions in the first person.'
    ),
    t(
      '- Verwende die exakte Schreibweise von Entitäten aus der Datenbank.',
      '- Use the exact database spelling for entities.'
    ),
    t('- Nutze HTML, aber keine Markdown-Code-Blöcke.', '- Use HTML, but no Markdown code blocks.'),
    t(
      '- Verwende sinnvolle HTML-Strukturen wie <h2>, <h3>, <p>, <ul>/<li> und <strong>/<em>.',
      '- Use suitable HTML structures such as <h2>, <h3>, <p>, <ul>/<li>, and <strong>/<em>.'
    ),
    t(
      '- Verwende kein <h1> als Titel; der Titel wird separat im title-Parameter gespeichert.',
      '- Do not use <h1> as the title; the title is stored separately in the title parameter.'
    ),
    t(
      '- Der Entwurf wird als KI-Version gespeichert. Der ursprüngliche Eintrag bleibt erhalten, bis der Benutzer die KI-Version akzeptiert.',
      '- The draft is stored as an AI version. The original entry remains until the user accepts the AI version.'
    ),
    t(
      '- Bei einem neuen Eintrag wird der Inhalt zunächst leer sein und nur die KI-Version enthält den Text.',
      '- For a new entry, the content starts empty and only the AI version contains the text.'
    ),
    t(
      '- targetEntryId weglassen = neuer Eintrag für einen neuen Spieltag. targetEntryId mit ID setzen = Eintrag zum laufenden Spieltag erweitern.',
      '- Omit targetEntryId = create a new entry for a new game day. Set targetEntryId to an ID = extend the entry for the ongoing game day.'
    ),
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath: process.cwd(),
    model: model || getModel(),
    title: `dnd-session-to-diary-${sessionId}-${Date.now()}`,
    scopes: ['recording:read', 'diary:read', 'diary:draft', 'entity:read'],
    user,
    arcId: arcContext?.arcId,
    language: runLanguage,
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
