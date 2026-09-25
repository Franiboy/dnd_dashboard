import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import type { ServerMessageParams, ServerMessagePayload } from '../shared/types.js';
import { createLogger } from './logger.js';

const log = createLogger('errorHandler');

export type ServerErrorParams = ServerMessageParams;

export interface AppErrorOptions {
  isOperational?: boolean;
  cause?: unknown;
  /** Stable client translation key, preferably a path under `errors.*`. */
  messageKey?: string;
  /** Alias for messageKey for producers that use machine-code terminology. */
  errorCode?: string;
  params?: ServerErrorParams;
}

export interface ErrorResponse {
  error: string;
  errorCode?: string;
  messageKey?: string;
  params?: ServerErrorParams;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;
  readonly messageKey: string | undefined;
  readonly errorCode: string | undefined;
  readonly params: ServerErrorParams | undefined;

  constructor(statusCode: number, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = options.isOperational ?? true;
    const inferredCode = messageCodeFor(message);
    this.messageKey = options.messageKey ?? options.errorCode ?? inferredCode;
    this.errorCode = options.errorCode ?? options.messageKey ?? inferredCode;
    this.params = options.params;
  }
}

/**
 * Exact legacy-message lookup used only while old producers are migrated.
 * New code should pass `messageKey`/`errorCode` explicitly; this table is
 * deliberately exact-match so arbitrary user content is never translated.
 */
const legacyMessageCodes: Readonly<Record<string, string>> = {
  // Generic/auth/rate-limit responses.
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

  // Bingo and socket/domain validation.
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

  // AI and diary/timeline routes.
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
  'KI-Zusammenfassung fehlgeschlagen': 'errors.entities.summaryFailed',
  'Aktualisierung der Zeitleiste ist fehlgeschlagen': 'errors.timeline.updateFailed',
  'Die Zeitleiste wird bereits aktualisiert': 'errors.timeline.alreadyUpdating',

  // Common resource/domain messages.
  'Eintrag nicht gefunden': 'errors.diary.entryNotFound',
  'Story Arc nicht gefunden': 'errors.storyArc.notFound',
  'Entität nicht gefunden': 'errors.entities.notFound',
  'User nicht gefunden': 'errors.admin.userNotFound',
  'Person existiert nicht': 'errors.admin.personNotFound',
  'Kein Transkript vorhanden': 'errors.recordings.noTranscript',
  'Aufnahme nicht gefunden': 'errors.recordings.notFound',
  'Start muss vor Ende liegen': 'errors.recordings.trimOrder',
  'Session kann aktuell nicht transkribiert werden': 'errors.recordings.cannotTranscribe',
  'Keine Audio-Dateien für diese Session vorhanden': 'errors.recordings.noAudioFiles',
  'Audiodateien können während der Verarbeitung nicht gelöscht werden':
    'errors.recordings.deleteWhileProcessing',
  'Aufnahmen älter als 14 Tage können nicht gelöscht werden': 'errors.recordings.deleteTooOld',
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
  'Kapitelnummer muss eine positive ganze Zahl sein': 'errors.validation.chapterNumber',
  'Kapitelnummer muss eine ganze Zahl sein': 'errors.validation.chapterInteger',
  'Kapitelnummer muss positiv sein': 'errors.validation.chapterPositive',
  'Kapitelnummer muss eine positive Zahl sein': 'errors.validation.chapterNumber',
  'Zeitleiste konnte nicht geladen werden': 'errors.timeline.loadFailed',
  'Spieltag konnte nicht angelegt werden': 'errors.campaign.createDayFailed',
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
  'Zusammenfassung darf maximal 500 Zeichen haben': 'errors.diary.summaryTooLong',
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
  'Vorschlag nicht gefunden': 'errors.bingo.suggestionNotFound',
  'Nur Dungeon Master können DM-Vorschläge annehmen.': 'errors.bingo.dmSuggestionDenied',
  'Nur Dungeon Master können DM-Vorschläge ablehnen.': 'errors.bingo.dmSuggestionDenied',
  'Nur Dungeon Master können DM-Vorschläge aktualisieren.': 'errors.bingo.dmSuggestionDenied',
  'Vorschläge können nur während des Setups annehmen werden': 'errors.bingo.suggestionSetupOnly',
  'Vorschläge können nur während des Setups ablehnen werden': 'errors.bingo.suggestionSetupOnly',
  'Vorschläge können nur während des Setups aktualisieren werden':
    'errors.bingo.suggestionSetupOnly',
  'isAdmin muss ein Boolean sein': 'errors.validation.boolean',
  'disabledApps muss ein Array von Strings sein': 'errors.validation.stringArray',
  'Gültiger Typ ist erforderlich': 'errors.validation.entityType',
  'Gültiger Typ und Name sind erforderlich': 'errors.validation.entityTypeName',
  'Gültige Typen sind erforderlich': 'errors.validation.entityTypes',
  'Alias und Zielname sind erforderlich': 'errors.validation.aliasTarget',
  'Gültige Daten sind erforderlich': 'errors.validation.invalidData',
  'Gültiger "until" (Spieltag) ist erforderlich': 'errors.validation.untilRequired',
  'Text ist erforderlich': 'errors.validation.textRequired',
  'Nur aktive Einträge können beendet werden': 'errors.entities.activeOnlyEnd',
  'Ungültige Farbe': 'errors.validation.color',
  'Benutzername und Passwort sind erforderlich': 'auth.credentialsRequired',
  'Ein Account mit diesem Username existiert bereits': 'auth.usernameTaken',
  'Benutzer konnte nicht erstellt werden': 'auth.userCreateFailed',
  'Admin-Konto fehlt': 'auth.adminMissing',
  'Kanal-ID muss ein String oder null sein': 'errors.validation.channelId',
  'channelId muss ein String oder null sein': 'errors.validation.channelId',
  'Kein Aufnahmeverzeichnis hinterlegt': 'errors.recordings.directoryMissing',
  'Keine Audio-Daten aufgezeichnet': 'errors.recordings.noAudioData',
  'Diese Session ist nicht aktiv': 'errors.recordings.sessionInactive',
  'Transkript konnte nicht gespeichert werden': 'errors.recordings.transcriptSaveFailed',
  'Gültig-bis-Spieltag muss eine positive ganze Zahl sein': 'errors.validation.gameDayEnd',
  'Gültig-bis-Spieltag darf nicht vor Gültig-ab-Spieltag liegen':
    'errors.validation.endBeforeStart',
  'Account ist gesperrt bis': 'auth.accountLocked',
  'Nightly-Job wurde gestartet.': 'errors.status.nightlyStarted',
  'Nightly-Job läuft bereits.': 'errors.status.nightlyAlreadyRunning',
  'Transkription-Jobs wurden gestartet.': 'errors.status.transcriptionStarted',
  'Transkription-Jobs laufen bereits oder sind deaktiviert.':
    'errors.status.transcriptionAlreadyRunning',
  'Bingo-Vorschlags-Nachfüllung wurde gestartet.': 'errors.status.bingoRefillStarted',
  'Bingo-Vorschlags-Nachfüllung läuft bereits oder KI ist deaktiviert.':
    'errors.status.bingoRefillAlreadyRunning',

  // English fallbacks from compatible/proxied servers.
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
};

export function messageCodeFor(message: string): string | undefined {
  return legacyMessageCodes[message.trim()];
}

export function errorPayload(
  error: unknown,
  options: { fallbackMessage?: string; fallbackCode?: string } = {}
): ErrorResponse {
  let message: string;
  let code: string | undefined;
  let params: ServerMessageParams | undefined;

  if (error instanceof AppError) {
    message = error.message;
    code = error.errorCode ?? error.messageKey;
    params = error.params;
  } else if (typeof error === 'string') {
    message = error;
    code = messageCodeFor(error);
  } else if (error instanceof Error) {
    message = error.message;
    code = messageCodeFor(error.message);
  } else {
    message = options.fallbackMessage ?? 'Internal Server Error';
    code = options.fallbackCode;
  }

  if (!message) message = options.fallbackMessage ?? 'Internal Server Error';
  if (!code) code = options.fallbackCode;

  const response: ErrorResponse = { error: message };
  if (code) {
    response.errorCode = code;
    response.messageKey = code;
  }
  if (params) response.params = params;
  return response;
}

export function messagePayload(
  input: string | AppError | ServerMessagePayload,
  options: { statusCode?: string; technical?: boolean; fallbackCode?: string } = {}
): ServerMessagePayload {
  if (typeof input !== 'string' && !(input instanceof AppError)) {
    const payload: ServerMessagePayload = { ...input };
    if (!payload.errorCode && payload.messageKey) payload.errorCode = payload.messageKey;
    if (!payload.messageKey && payload.errorCode) payload.messageKey = payload.errorCode;
    if (options.statusCode && !payload.statusCode) payload.statusCode = options.statusCode;
    if (options.technical) payload.technical = true;
    if (!payload.errorCode && options.fallbackCode) {
      payload.errorCode = options.fallbackCode;
      payload.messageKey = options.fallbackCode;
    }
    return payload;
  }

  const response = errorPayload(input);
  const payload: ServerMessagePayload = { message: response.error };
  if (response.errorCode) payload.errorCode = response.errorCode;
  if (response.messageKey) payload.messageKey = response.messageKey;
  if (response.params) payload.params = response.params;
  if (options.statusCode) payload.statusCode = options.statusCode;
  if (options.technical) payload.technical = true;
  if (!payload.errorCode && options.fallbackCode) {
    payload.errorCode = options.fallbackCode;
    payload.messageKey = options.fallbackCode;
  }
  return payload;
}

export interface ParseWithOptions {
  messageKey?: string;
  params?: ServerErrorParams;
}

/**
 * Validates `data` against a zod schema and returns the parsed value. The
 * original issue text remains the compatibility fallback; a stable key and
 * field parameter are emitted whenever a producer supplies one.
 */
export function parseWith<T>(schema: ZodType<T>, data: unknown, options: ParseWithOptions = {}): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    throw new AppError(400, issue?.message ?? 'Ungültige Daten', {
      messageKey:
        options.messageKey ?? (issue?.message ? messageCodeFor(issue.message) : undefined),
      params: {
        ...options.params,
        ...(field ? { field } : {}),
      },
    });
  }
  return result.data;
}

export interface OrFailOptions extends AppErrorOptions {
  messageKey?: string;
}

/** Maps an unexpected synchronous failure to a safe, localizable 500 error. */
export function orFail<T>(message: string, fn: () => T, options: OrFailOptions = {}): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, message, {
      ...options,
      messageKey: options.messageKey ?? options.errorCode ?? messageCodeFor(message),
      cause: err,
    });
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(errorPayload('Not Found', { fallbackCode: 'errors.notFound' }));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      if (err.cause !== undefined) {
        log.error(`${err.statusCode} ${err.message}:`, err.cause);
      } else {
        log.error(`${err.statusCode} ${err.message}`, err.stack);
      }
    }
    res.status(err.statusCode).json(errorPayload(err));
    return;
  }

  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status?: number }).status === 400
  ) {
    res
      .status(400)
      .json(errorPayload('Invalid JSON payload', { fallbackCode: 'errors.invalidJson' }));
    return;
  }

  log.error('Unhandled error:', err);
  res.status(500).json(errorPayload('Internal Server Error', { fallbackCode: 'errors.internal' }));
}
