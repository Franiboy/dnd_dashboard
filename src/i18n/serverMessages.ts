import type { ServerMessageParams } from '../../shared/types';
import { formatDateTimeValue } from './format';
import { locales } from './messages';
import type { TFunction, TranslationKey } from './messages';

/** A payload accepted from HTTP, Socket.io or an SSE event. */
export interface ServerMessageLike {
  message?: string | null;
  error?: string | null;
  errorCode?: string | null;
  messageKey?: string | null;
  params?: ServerMessageParams;
  statusCode?: string | null;
  technical?: boolean;
}

export interface LocalizeServerMessageOptions {
  /** Used when a machine-readable code is present but unknown to this client. */
  fallbackKey?: TranslationKey;
  /** Used when no code/key or legacy text is available. */
  fallback?: string;
}

/**
 * Compatibility map for responses from older servers. It intentionally uses
 * exact strings only: names, diary text, AI output and other user content
 * must never be mistaken for an error merely because they contain a German
 * word.
 */
const legacyMessageKeys: Readonly<Record<string, TranslationKey>> = {
  // Generic/auth/rate-limit.
  Unauthorized: 'errors.unauthorized',
  Forbidden: 'errors.forbidden',
  'Forbidden: Account not approved': 'errors.accountNotApproved',
  'Forbidden: Kein Charakter zugewiesen': 'errors.activePersonRequired',
  'Not Found': 'errors.notFound',
  'Internal Server Error': 'errors.internal',
  'Invalid JSON payload': 'errors.invalidJson',
  'Nicht autorisiert': 'errors.unauthorized',
  'Nicht verfügbar': 'errors.devUnavailable',
  'Interner Fehler': 'common.internalError',
  'Account wurde noch nicht freigegeben': 'auth.accountPending',
  'Falsche Anmeldedaten': 'auth.invalidCredentials',
  'Login fehlgeschlagen': 'auth.loginFailed',
  'Discord OAuth ist nicht konfiguriert': 'auth.discordNotConfigured',
  'Discord Authentifizierung fehlgeschlagen': 'auth.discordAuthenticationFailed',
  'Ungültiger OAuth State': 'auth.invalidOAuthState',
  'Code oder State fehlt': 'auth.codeOrStateMissing',
  'Discord Login fehlgeschlagen': 'auth.discordLoginFailed',
  'Discord Login nicht verfügbar': 'auth.discordLoginUnavailable',
  'Server nicht erreichbar': 'common.serverUnavailable',
  'Ein unbekannter Fehler ist aufgetreten': 'common.unknownError',
  'Speichern fehlgeschlagen': 'common.saveFailed',
  'Speichern fehlgeschlagen.': 'common.saveFailed',

  // Bingo/socket.
  'Name fehlt.': 'errors.bingo.nameMissing',
  'Text fehlt.': 'errors.bingo.textMissing',
  'Nicht beigetreten.': 'errors.bingo.notJoined',
  'Element nicht gefunden.': 'errors.whiteboard.elementNotFound',
  'Ungültige Feldgröße.': 'errors.bingo.invalidGridSize',
  'Aufgabe nicht gefunden.': 'errors.bingo.taskNotFound',
  'Spieler nicht gefunden.': 'errors.bingo.playerNotFound',
  'Ungültiges Board.': 'errors.bingo.invalidBoard',
  'Board ist ungültig.': 'errors.bingo.invalidBoard',
  'Text darf nicht leer sein.': 'errors.bingo.textMissing',
  'Private Aufgaben müssen mindestens einer Person zugewiesen werden.':
    'errors.bingo.privateAssignment',
  'Nur Spieler und Dungeon Master können am Bingo teilnehmen.': 'errors.bingo.participantOnly',
  'Nur Dungeon Master können DM-Aufgaben hinzufügen.': 'errors.bingo.dmAddDenied',
  'Nur Dungeon Master können DM-Aufgaben entfernen.': 'errors.bingo.dmRemoveDenied',
  'Nur Dungeon Master können DM-Aufgaben bearbeiten.': 'errors.bingo.dmEditDenied',
  'Nur Dungeon Master können DM-Aufgaben bestätigen.': 'errors.bingo.dmConfirmDenied',
  'Nur Dungeon Master können DM-Aufgaben zurücknehmen.': 'errors.bingo.dmUnconfirmDenied',
  'Nur Admins können die Feldgröße ändern.': 'errors.bingo.gridSizeDenied',
  'Nur Admins können das Spiel starten.': 'errors.bingo.startDenied',
  'Nur Admins können das Spiel zurücksetzen.': 'errors.bingo.resetDenied',
  'Feldgröße kann nur in der Setup-Phase geändert werden.': 'errors.bingo.gridSizeSetupOnly',
  'Spiel kann nur aus der Setup-Phase gestartet werden.': 'errors.bingo.startSetupOnly',
  'Aufgaben können nur vor Spielstart hinzugefügt werden.': 'errors.bingo.addTaskSetupOnly',
  'Aufgaben können nur vor Spielstart bearbeitet werden.': 'errors.bingo.editTaskSetupOnly',
  'Aufgaben können nur vor Spielstart entfernt werden.': 'errors.bingo.removeTaskSetupOnly',
  'Board ist gesperrt. Entsperre es, um Änderungen vorzunehmen.': 'errors.bingo.boardLocked',
  'Board kann nur vor oder während des Spiels bearbeitet werden.': 'errors.bingo.boardPhase',
  'Board kann nur vor oder während des Spiels eingelockt werden.': 'errors.bingo.lockPhase',
  'Board muss vollständig ausgefüllt sein, bevor es eingelockt wird.':
    'errors.bingo.boardIncomplete',
  'Board kann nur vor Spielstart entsperrt werden.': 'errors.bingo.unlockSetupOnly',
  'Vorschlag nicht gefunden': 'errors.bingo.suggestionNotFound',

  // AI/domain errors.
  'KI-Feature ist nicht konfiguriert': 'errors.ai.disabled',
  'KI-Umschreiben ist fehlgeschlagen': 'errors.diary.rewriteFailed',
  'KI-Befehl ist fehlgeschlagen': 'errors.diary.commandFailed',
  'KI-Verarbeitung ist fehlgeschlagen': 'errors.diary.processingFailed',
  'KI-Verbesserung ist fehlgeschlagen': 'errors.recordings.transcriptImprovementFailed',
  'KI-Zusammenfassung ist fehlgeschlagen': 'errors.recordings.summaryFailed',
  'KI-Überführung ins Tagebuch ist fehlgeschlagen': 'errors.recordings.diaryTransferFailed',
  'KI-Ermittlung des Spieltags ist fehlgeschlagen': 'errors.recordings.gameDayDetectionFailed',
  'KI-Einordnung fehlgeschlagen': 'errors.entities.classificationFailed',
  'KI-Berichtigung fehlgeschlagen': 'errors.entities.correctionFailed',
  'KI-Prüfung fehlgeschlagen': 'errors.entities.reviewFailed',
  'Aktualisierung der Zeitleiste ist fehlgeschlagen': 'errors.timeline.updateFailed',
  'Die Zeitleiste wird bereits aktualisiert': 'errors.timeline.alreadyUpdating',
  'Eintrag nicht gefunden': 'errors.diary.entryNotFound',
  'Story Arc nicht gefunden': 'errors.storyArc.notFound',
  'Entität nicht gefunden': 'errors.entities.notFound',
  'User nicht gefunden': 'errors.admin.userNotFound',
  'Person existiert nicht': 'errors.admin.personNotFound',
  'Kein Transkript vorhanden': 'errors.recordings.noTranscript',
  'Aufnahme nicht gefunden': 'errors.recordings.notFound',
  'Aufnahme nicht gefunden.': 'errors.recordings.notFound',
  'Start muss vor Ende liegen': 'errors.recordings.trimOrder',
  'Session kann aktuell nicht transkribiert werden': 'errors.recordings.cannotTranscribe',
  'Keine Audio-Dateien für diese Session vorhanden': 'errors.recordings.noAudioFiles',
  'Audiodateien können während der Verarbeitung nicht gelöscht werden':
    'errors.recordings.deleteWhileProcessing',
  'Aufnahmen älter als 14 Tage können nicht gelöscht werden': 'errors.recordings.deleteTooOld',
  'Spieltag bereits gesetzt. Mit ?force=true überschreiben.': 'errors.recordings.gameDayAlreadySet',
  'Kein Aufnahmeverzeichnis hinterlegt': 'errors.recordings.directoryMissing',
  'Kein Aufnahmeverzeichnis hinterlegt.': 'errors.recordings.directoryMissing',
  'Diese Session ist nicht aktiv': 'errors.recordings.sessionInactive',
  'Diese Session ist nicht aktiv.': 'errors.recordings.sessionInactive',
  'Es läuft bereits eine Aufnahme': 'errors.recordings.alreadyRunning',
  'Discord-Server nicht gefunden; überprüfe DISCORD_GUILD_ID':
    'errors.recordings.discordServerNotFound',
  'Voice-Channel nicht gefunden': 'errors.recordings.voiceChannelNotFound',
  'Aufnahme wurde unterbrochen; keine Audio-Daten gefunden.':
    'errors.recordings.interruptedNoAudio',
  'Keine Audio-Daten aufgezeichnet.': 'errors.recordings.noAudioData',
  'Keine Audio-Daten aufgezeichnet': 'errors.recordings.noAudioData',
  'Transkription lieferte keine Ergebnisse': 'errors.recordings.noTranscriptionResults',
  'Inhalt ist erforderlich': 'errors.validation.contentRequired',
  'Inhalt darf nicht leer sein': 'errors.validation.contentRequired',
  'Ungültige ID': 'errors.validation.invalidId',
  'Ungültige Daten': 'errors.validation.invalidData',
  'Ungültige Sprache': 'errors.validation.invalidLanguage',
  'Ungültige Rolle': 'errors.validation.invalidRole',
  'Ungültiges Modell': 'errors.validation.invalidModel',
  'Ungültiger level-Wert': 'errors.validation.invalidLevel',
  'Ungültiger before-Wert': 'errors.validation.invalidBefore',
  'Ungültiger Vorschlag': 'errors.validation.invalidSuggestion',
  'Ungültige Vorschlags-ID': 'errors.validation.invalidSuggestionId',
  'Ungültige Session-ID': 'errors.validation.invalidSessionId',
  'Aktionen-Array ist erforderlich': 'errors.validation.actionsArray',
  'Ungültiger limit-Wert': 'errors.validation.invalidLimit',
  'Name ist erforderlich': 'errors.validation.nameRequired',
  'Name darf nicht leer sein': 'errors.validation.nameRequired',
  'Beschreibung muss ein Text sein': 'errors.validation.descriptionRequired',
  'Suchbegriff ist erforderlich': 'errors.validation.searchRequired',
  'Suchbegriff muss mindestens 2 Zeichen lang sein': 'errors.validation.searchTooShort',
  'Suchbegriff darf maximal 200 Zeichen lang sein': 'errors.validation.searchTooLong',
  'limit muss eine Zahl sein': 'errors.validation.limitNumber',
  'limit muss eine ganze Zahl sein': 'errors.validation.limitInteger',
  'limit muss mindestens 1 sein': 'errors.validation.limitMinimum',
  'limit darf höchstens 20 sein': 'errors.validation.limitMaximum',
  'Ungültiger Dateiname.': 'errors.whiteboard.invalidFilename',
  'Nur PNG, JPEG, GIF oder WebP werden unterstützt.': 'errors.whiteboard.unsupportedType',
  'Bild ist leer oder größer als 8 MB.': 'errors.whiteboard.invalidSize',
  'Links müssen mit http(s) beginnen.': 'errors.whiteboard.invalidUrl',
  'Ungültiges Whiteboard-Element.': 'errors.whiteboard.invalidElement',
  'Unbekannter Element-Typ.': 'errors.whiteboard.unknownType',
  'Keine Berechtigung.': 'errors.whiteboard.permissionDenied',
  'Story Arc konnte nicht angelegt werden': 'errors.storyArc.createFailed',
  'Story Arc konnte nicht gespeichert werden': 'errors.storyArc.saveFailed',
  'Story Arc konnte nicht aktiviert werden': 'errors.storyArc.activateFailed',
  'Story Arcs konnten nicht geladen werden': 'errors.storyArc.loadFailed',
  'Abgeschlossene Story Arcs können nicht gelöscht werden': 'errors.storyArc.completedDelete',
  'Der aktive Story Arc kann nicht gelöscht werden – aktiviere zuerst einen anderen Arc':
    'errors.storyArc.activeDelete',
  'Zeitleiste konnte nicht geladen werden': 'errors.timeline.loadFailed',
  'Suche ist fehlgeschlagen': 'errors.search.failed',
  'Mappings konnten nicht geladen werden': 'errors.entities.mappingsLoadFailed',
  'Entitäten konnten nicht geladen werden': 'errors.entities.loadFailed',
  'Blacklist konnte nicht geladen werden': 'errors.entities.blacklistLoadFailed',
  'Blacklisten fehlgeschlagen': 'errors.entities.blacklistFailed',
  'Entfernen fehlgeschlagen': 'errors.entities.removeFailed',
  'Reklassifizierung fehlgeschlagen': 'errors.entities.reclassifyFailed',
  'Verknüpfen fehlgeschlagen': 'errors.entities.linkFailed',
  'Laden fehlgeschlagen': 'errors.entities.loadFailed',
  'Aktualisieren fehlgeschlagen': 'errors.entities.updateFailed',
  'Löschen fehlgeschlagen': 'errors.entities.deleteFailed',
  'Beenden fehlgeschlagen': 'errors.entities.endFailed',
  'Zuordnen fehlgeschlagen': 'errors.entities.assignFailed',
  'Lösen fehlgeschlagen': 'errors.entities.unlinkFailed',
  'Zusammenfassung konnte nicht geladen werden': 'errors.entities.summaryLoadFailed',
  'Mini-Zusammenfassung konnte nicht gespeichert werden': 'errors.entities.miniSummarySaveFailed',
  'Modelle konnten nicht geladen werden': 'errors.admin.modelsLoadFailed',
  'Befehl ist erforderlich': 'errors.diary.commandRequired',
  'Keine aktive KI-Session vorhanden': 'errors.diary.noActiveAiSession',
  'Keine KI-Version vorhanden': 'errors.diary.noAiVersion',
  'Spieltag muss eine positive ganze Zahl sein': 'errors.validation.gameDay',
  'arcId muss eine positive ganze Zahl oder null sein': 'errors.validation.arcId',
  'arcId muss eine positive ganze Zahl oder "none" sein': 'errors.validation.arcIdOrNone',
  'arcId muss eine positive ganze Zahl sein': 'errors.validation.arcIdPositive',
  'Gültige arcId ist erforderlich': 'errors.validation.arcIdRequired',
  'Spieltag-Ende muss eine positive ganze Zahl oder null sein': 'errors.validation.gameDayEnd',
  'Trim-Werte müssen Zahlen oder null sein': 'errors.validation.trimValues',
  'Werte müssen Zahlen oder null sein': 'errors.validation.numericValues',
  'Endtag darf nicht vor Starttag liegen': 'errors.validation.endBeforeStart',
  'Zeitraum zu groß (max 30 Tage)': 'errors.validation.rangeTooLarge',
  'Ungültige Farbe': 'errors.validation.color',
  'Benutzername und Passwort sind erforderlich': 'auth.credentialsRequired',
  'Ein Account mit diesem Username existiert bereits': 'auth.usernameTaken',
  'Benutzer konnte nicht erstellt werden': 'auth.userCreateFailed',
  'Admin-Konto fehlt': 'auth.adminMissing',
  'Kanal-ID muss ein String oder null sein': 'errors.validation.channelId',
  'channelId muss ein String oder null sein': 'errors.validation.channelId',

  // AI/SSE status strings retained for older servers.
  'KI-Modell wird geladen...': 'errors.ai.modelLoading',
  'KI-Anfrage wird vorbereitet...': 'errors.ai.requestPreparing',
  'KI-Anfrage wird ausgeführt...': 'errors.ai.requestRunning',
  'KI generiert Zusammenfassung und Personen...': 'errors.ai.generatingSummaryPeople',
  'KI arbeitet noch...': 'errors.ai.working',
  'Fast fertig...': 'errors.ai.almostDone',
  'KI schreibt den Text um...': 'errors.status.rewriteStarted',
  'KI bearbeitet den Text...': 'errors.status.commandStarted',
  'KI analysiert den Tagebucheintrag...': 'errors.status.processingStarted',
  'Ergebnis wird gespeichert...': 'errors.status.savingResult',
  'Ergebnisse werden gespeichert...': 'errors.status.savingResults',
  'Zeitleiste ist bereits aktuell.': 'errors.status.upToDate',
  'Aktualisierung der Zeitleiste abgeschlossen.': 'errors.status.completed',
  'KI arbeitet an der Zeitleiste...': 'errors.status.timelineWorking',
  'Ereignisse werden extrahiert...': 'errors.status.extractingEvents',
  'Transkript verbessert.': 'errors.status.transcriptImproved',
  'Zusammenfassung erstellt.': 'errors.status.summaryCreated',
  'Tagebucheintrag-Entwurf erstellt.': 'errors.status.diaryDraftCreated',
  'Transkription wird im Hintergrund gestartet': 'errors.status.transcriptionQueued',
  'Aufnahme gelöscht': 'errors.status.recordingDeleted',
  'Nightly-Job wurde gestartet.': 'errors.status.nightlyStarted',
  'Nightly-Job läuft bereits.': 'errors.status.nightlyAlreadyRunning',
  'Transkription-Jobs wurden gestartet.': 'errors.status.transcriptionStarted',
  'Transkription-Jobs laufen bereits oder sind deaktiviert.':
    'errors.status.transcriptionAlreadyRunning',
  'Bingo-Vorschlags-Nachfüllung wurde gestartet.': 'errors.status.bingoRefillStarted',
  'Bingo-Vorschlags-Nachfüllung läuft bereits oder KI ist deaktiviert.':
    'errors.status.bingoRefillAlreadyRunning',

  // English fallbacks used by API implementations that already localize.
  'Login failed': 'auth.loginFailed',
  'Discord login failed': 'auth.discordLoginFailed',
  'Discord login is unavailable': 'auth.discordLoginUnavailable',
  'Account has not been approved yet': 'auth.accountPending',
  'Server unavailable': 'common.serverUnavailable',
  'Invalid credentials': 'auth.invalidCredentials',
  'Discord OAuth is not configured': 'auth.discordNotConfigured',
  'Discord authentication failed': 'auth.discordAuthenticationFailed',
  'Invalid OAuth state': 'auth.invalidOAuthState',
  'Code or state is missing': 'auth.codeOrStateMissing',
  'Internal error': 'common.internalError',
  'Saving failed': 'common.saveFailed',
  'Not authorized': 'errors.unauthorized',
  'Access denied': 'errors.forbidden',
  'Not found': 'errors.notFound',
  'Internal server error': 'errors.internal',
  'AI feature is not configured': 'errors.ai.disabled',
  'AI rewrite failed': 'errors.diary.rewriteFailed',
  'AI command failed': 'errors.diary.commandFailed',
  'AI processing failed': 'errors.diary.processingFailed',
  'Timeline update failed': 'errors.timeline.updateFailed',
  'The timeline is already being updated': 'errors.timeline.alreadyUpdating',
  'Loading AI model...': 'errors.ai.modelLoading',
  'Running AI request...': 'errors.ai.requestRunning',
  'AI is still working...': 'errors.ai.working',
  'Almost done...': 'errors.ai.almostDone',
  'The timeline is already up to date.': 'errors.status.upToDate',
  'Timeline update completed.': 'errors.status.completed',
};

/** Aliases for non-path machine codes used by older/external producers. */
const codeAliases: Readonly<Record<string, TranslationKey>> = {
  AUTH_INVALID_CREDENTIALS: 'auth.invalidCredentials',
  AUTH_ACCOUNT_PENDING: 'auth.accountPending',
  AUTH_UNAUTHORIZED: 'errors.unauthorized',
  AUTH_FORBIDDEN: 'errors.forbidden',
  RATE_LIMITED: 'errors.rateLimit.ai',
  NOT_FOUND: 'errors.notFound',
  INTERNAL_ERROR: 'errors.internal',
  VALIDATION_ERROR: 'errors.validation.invalidData',
};

function hasTranslationKey(key: string): key is TranslationKey {
  let current: unknown = locales.de;
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return (
    typeof current === 'string' ||
    (typeof current === 'object' && current !== null && 'other' in current)
  );
}

function getMessageText(input: ServerMessageLike | string | null | undefined): string | null {
  if (typeof input === 'string') return input;
  if (!input) return null;
  if (typeof input.message === 'string') return input.message;
  if (typeof input.error === 'string') return input.error;
  return null;
}

function getCodes(input: ServerMessageLike | string | null | undefined): string[] {
  if (typeof input === 'string' || !input) return [];
  return [input.messageKey, input.errorCode]
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
    .map((value) => value.trim());
}

function getCode(input: ServerMessageLike | string | null | undefined): string | null {
  return getCodes(input)[0] ?? null;
}

/** Returns a translation key from a structured code or an exact legacy text. */
export function getServerMessageKey(
  input: string | ServerMessageLike | null | undefined
): TranslationKey | null {
  for (const code of getCodes(input)) {
    if (hasTranslationKey(code)) return code;
    const alias = codeAliases[code];
    if (alias) return alias;
  }
  const message = getMessageText(input);
  if (!message) return null;
  const exact = legacyMessageKeys[message.trim()];
  if (exact) return exact;
  // A few old producers already sent a translation path as the text.
  const text = message.trim();
  return hasTranslationKey(text) ? text : null;
}

export function getServerMessageParams(
  input: string | ServerMessageLike | null | undefined
): ServerMessageParams | undefined {
  return typeof input === 'string' ? undefined : input?.params;
}

export function getServerMessageCode(
  input: string | ServerMessageLike | null | undefined
): string | undefined {
  return getCode(input) ?? undefined;
}

/** True for the server's explicit lifecycle marker; translated text is never inspected. */
export function isCompletedServerMessage(
  input: ServerMessageLike | string | null | undefined
): boolean {
  const statusCode = typeof input === 'string' ? null : input?.statusCode?.toLowerCase();
  if (statusCode === 'completed' || statusCode === 'complete' || statusCode === 'done') {
    return true;
  }
  const key = getServerMessageKey(input);
  return key === 'errors.status.completed' || key === 'errors.status.upToDate';
}

export function isTechnicalServerMessage(
  input: string | ServerMessageLike | null | undefined
): boolean {
  return typeof input !== 'string' && input?.technical === true;
}

export function localizeServerMessage(
  input: string,
  t: TFunction,
  options?: LocalizeServerMessageOptions
): string;
export function localizeServerMessage(
  input: ServerMessageLike | null | undefined,
  t: TFunction,
  options?: LocalizeServerMessageOptions
): string | null;
export function localizeServerMessage(
  input: string | ServerMessageLike,
  t: TFunction,
  options?: LocalizeServerMessageOptions
): string | null;
export function localizeServerMessage(
  input: string | ServerMessageLike | null | undefined,
  t: TFunction,
  options: LocalizeServerMessageOptions = {}
): string | null {
  if (input === null || input === undefined) return options.fallback ?? null;
  if (isTechnicalServerMessage(input)) return getMessageText(input);
  const key = getServerMessageKey(input);
  if (key) {
    let params = getServerMessageParams(input);
    if (key === 'auth.accountLocked' && typeof params?.until === 'string') {
      const formattedUntil = formatDateTimeValue(t.language ?? 'de', params.until);
      if (formattedUntil) params = { ...params, until: formattedUntil };
    }
    return t(key, params);
  }
  // An unknown machine code must not leak an arbitrary server fallback into an
  // English UI. Prefer a safe generic message when the producer supplied one.
  if (getCode(input)) return t(options.fallbackKey ?? 'errors.internal');
  return getMessageText(input) ?? options.fallback ?? null;
}

/** Convenience alias for SSE consumers, where the payload is called a status. */
export const localizeServerStatus = localizeServerMessage;

/** Extracts a safe, stable descriptor for API consumers that need the raw code. */
export function getServerMessagePayload(payload: unknown): ServerMessageLike | null {
  if (typeof payload === 'string') return { message: payload };
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = payload as ServerMessageLike;
  if (
    typeof candidate.message === 'string' ||
    typeof candidate.error === 'string' ||
    typeof candidate.errorCode === 'string' ||
    typeof candidate.messageKey === 'string'
  ) {
    return candidate;
  }
  return null;
}
