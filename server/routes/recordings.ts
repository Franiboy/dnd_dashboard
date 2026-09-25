import { Router } from 'express';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, errorPayload, messagePayload, parseWith } from '../errors.js';
import { aiRateLimit } from '../utils/rateLimits.js';
import {
  authMiddleware,
  requireAdmin,
  requireApproved,
  resolveViewAsUser,
  type AuthRequest,
} from '../auth.js';
import {
  getBotStatus,
  getAllVoiceChannels,
  finishRecording,
  getActiveRecording,
  getMonitoredChannel,
} from '../discord/bot.js';
import { runTranscription, getTranscriptionProgress } from '../discord/transcriber.js';
import { deleteSessionAudioFiles } from '../discord/files.js';
import { isRecordingFeatureEnabled } from '../discord/config.js';
import { isAiEnabled } from '../ai/config.js';
import { improveSessionTranscriptWithAi } from '../ai/sessionRewrite.js';
import { processSessionSummaryEntities } from '../ai/sessionSummary.js';
import { generateSessionDiaryDraft } from '../ai/sessionToDiary.js';
import { detectSessionGameDay } from '../ai/sessionGameDay.js';
import {
  annotateTranscriptSpeakers,
  resolveTranscriptDisplayLanguage,
} from '../ai/transcriptSpeakers.js';
import { getAllUsers } from '../repositories/users.js';
import {
  onSessionsUpdated,
  onStatusUpdated,
  onProgressUpdated,
  emitSessionsUpdated,
} from '../discord/recordingsEvents.js';
import {
  getSessionById,
  listSessions,
  getFilesBySessionId,
  getRecordingConfig,
  setRecordingConfig,
  deleteSession,
  updateSession,
  getSessionToDiaryTransfer,
  listSessionToDiaryTransfers,
  recordSessionToDiaryTransfer,
  listAllSessionDiaryEntryLinks,
} from '../repositories/recordings.js';
import { assignSessionToArc } from '../repositories/storyArcs.js';
import { createLogger } from '../logger.js';
import { SseBroadcaster, writeSse } from '../utils/sse.js';
import type { RecordingSession, ServerMessagePayload } from '../../shared/types.js';

const log = createLogger('recordings-routes');
const SESSION_DELETE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const router = Router();
const sseClients = new SseBroadcaster();

const idParamSchema = z.coerce.number().int().positive({ error: 'Ungültige ID' });

const optionalSeconds = (message: string) =>
  z.preprocess(
    (v) => (v === undefined ? undefined : v),
    z.union([z.null(), z.number({ error: message })], { error: message }).optional()
  );

const nullableInt = (message: string) =>
  z.preprocess(
    (v) => (v === null || v === undefined ? null : Number(v)),
    z.number({ error: message }).int(message).positive(message)
  );

type TranscriptRequest = Pick<AuthRequest, 'headers' | 'user' | 'viewAsUser'>;

function withAnnotatedTranscript(
  session: RecordingSession,
  req: TranscriptRequest
): RecordingSession {
  if (!session.transcript) return session;
  try {
    const users = getAllUsers();
    const displayUser = req.viewAsUser ?? req.user;
    const language = resolveTranscriptDisplayLanguage(
      displayUser?.uiLanguage,
      req.headers['accept-language']
    );
    const annotated = annotateTranscriptSpeakers(
      session.transcript,
      users,
      displayUser?.id,
      language
    );
    return { ...session, transcript: annotated.transcript };
  } catch (err) {
    log.warn('Failed to annotate transcript for display:', err);
    return session;
  }
}

function getStatusData(): string {
  return JSON.stringify({ bot: getBotStatus(), active: getActiveRecording() });
}

function getSessionsData(): string {
  return JSON.stringify({ sessions: listSessions() });
}

function broadcastStatus(): void {
  sseClients.broadcast('status', getStatusData());
}

function broadcastSessions(): void {
  sseClients.broadcast('sessions', getSessionsData());
}

function broadcastProgress(sessionId: number, progress: unknown): void {
  sseClients.broadcast('progress', JSON.stringify({ sessionId, progress }));
}

function broadcastAiLog(input: string | ServerMessagePayload): void {
  // Keep structured metadata intact; older string producers still get a safe
  // messagePayload fallback with a progress status marker.
  const payload = messagePayload(input, { statusCode: 'progress' });
  sseClients.broadcast('aiLog', JSON.stringify(payload));
}

function progressPayload(message: string, messageKey: string): ServerMessagePayload {
  return { message, messageKey, errorCode: messageKey };
}

function mapOpencodeStatus(line: string): ServerMessagePayload | null {
  const [action] = line.split('·').map((s) => s.trim());
  switch (action.toLowerCase()) {
    case 'build':
      return messagePayload({
        message: 'KI-Modell wird geladen...',
        messageKey: 'errors.ai.modelLoading',
        errorCode: 'errors.ai.modelLoading',
      });
    case 'run':
      return messagePayload({
        message: 'KI-Anfrage wird ausgeführt...',
        messageKey: 'errors.ai.requestRunning',
        errorCode: 'errors.ai.requestRunning',
      });
    default:
      return messagePayload({
        message: `KI arbeitet: ${action}`,
        messageKey: 'errors.ai.workingAction',
        errorCode: 'errors.ai.workingAction',
        params: { action },
      });
  }
}

function notifyAiLog(raw: string): void {
  const messages = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line)
    .flatMap((line) => {
      const statusMatch = line.match(/^>\s*(.+)$/);
      if (statusMatch) {
        const mapped = mapOpencodeStatus(statusMatch[1]);
        return mapped ? [mapped] : [];
      }
      if (/^(error|fehler|warn|warning|opencode|spawn)/i.test(line)) {
        // Preserve provider/Python diagnostics as explicitly technical data.
        return [messagePayload(line, { statusCode: 'diagnostic', technical: true })];
      }
      return [];
    });

  for (const message of messages) {
    broadcastAiLog(message);
  }
}

function startProgressMessages(
  initialMessage: string | ServerMessagePayload,
  messages?: Array<string | ServerMessagePayload>
): () => void {
  const defaultMessages: ServerMessagePayload[] = [
    progressPayload('KI prüft Entitäten und Tagebücher...', 'errors.ai.working'),
    progressPayload('KI verbessert das Transkript...', 'errors.status.transcriptImproving'),
    progressPayload('KI arbeitet noch...', 'errors.ai.working'),
    progressPayload('Fast fertig...', 'errors.ai.almostDone'),
  ];
  const cycle = messages ?? defaultMessages;
  let index = 0;
  broadcastAiLog(initialMessage);
  const interval = setInterval(() => {
    broadcastAiLog(cycle[index % cycle.length]);
    index++;
  }, 3000);
  return () => clearInterval(interval);
}

onStatusUpdated(() => broadcastStatus());
onSessionsUpdated(() => broadcastSessions());
onProgressUpdated((sessionId, progress) => broadcastProgress(sessionId, progress));

function requireRecordingFeature(
  _req: AuthRequest,
  res: import('express').Response,
  next: import('express').NextFunction
): void {
  if (!isRecordingFeatureEnabled()) {
    res.status(503).json(
      errorPayload('Aufnahme-Feature ist nicht konfiguriert', {
        fallbackCode: 'errors.recordings.featureDisabled',
      })
    );
    return;
  }
  next();
}

router.use(authMiddleware, requireApproved, resolveViewAsUser, requireRecordingFeature);

function requireSession(id: number) {
  const session = getSessionById(id);
  if (!session) {
    throw new AppError(404, 'Aufnahme nicht gefunden', {
      messageKey: 'errors.recordings.notFound',
    });
  }
  return session;
}

/** Sessions must be fully transcribed before any AI post-processing runs. */
function requireCompletedTranscript(id: number) {
  const session = requireSession(id);
  if (session.status !== 'completed' || !session.transcript) {
    throw new AppError(400, 'Kein Transkript vorhanden', {
      messageKey: 'errors.recordings.noTranscript',
    });
  }
  return session;
}

function requireAiEnabled(): void {
  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert', {
      messageKey: 'errors.ai.disabled',
    });
  }
}

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);
  res.flushHeaders();

  if (!writeSse(res, 'status', getStatusData()) || !writeSse(res, 'sessions', getSessionsData())) {
    return;
  }

  const cleanup = sseClients.add(res);

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

router.get('/status', (_req, res) => {
  res.json({
    bot: getBotStatus(),
    active: getActiveRecording(),
    monitoredChannel: getMonitoredChannel(),
  });
});

router.get('/channels', requireAdmin, async (_req, res) => {
  try {
    const channels = await getAllVoiceChannels();
    res.json({ channels });
  } catch (err) {
    throw new AppError(500, 'Aufnahme-Kanäle konnten nicht geladen werden', {
      messageKey: 'errors.recordings.channelsLoadFailed',
      cause: err,
    });
  }
});

router.get('/', (_req, res) => {
  const sessions = listSessions();
  res.json({ sessions });
});

router.get('/diary-transfers', (req: AuthRequest, res) => {
  const transfers = listSessionToDiaryTransfers(req.user!.id);
  res.json({ transfers });
});

router.get('/session-diary-entries', (req: AuthRequest, res) => {
  const entries = listAllSessionDiaryEntryLinks(req.user!.id, req.user!.isAdmin);
  res.json({ entries });
});

router.get('/:id/diary-transfer', (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const transfer = getSessionToDiaryTransfer(id, req.user!.id);
  res.json({ transfer });
});

router.get('/config', requireAdmin, (_req, res) => {
  res.json(getRecordingConfig());
});

const configSchema = z.object({
  channelId: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? null : v),
    z.union([z.null(), z.string()], { error: 'channelId muss ein String oder null sein' })
  ),
});

router.post('/config', requireAdmin, (req: AuthRequest, res) => {
  const { channelId } = parseWith(configSchema, req.body);
  setRecordingConfig(channelId || null);
  res.json(getRecordingConfig());
});

router.get('/:id', (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const session = requireSession(id);
  const files = getFilesBySessionId(id);
  const wantRaw = req.query.raw === 'true' || req.query.raw === '1';
  const outSession = wantRaw ? session : withAnnotatedTranscript(session, req);
  res.json({ session: { ...outSession, files } });
});

router.post('/:id/stop', requireAdmin, async (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  try {
    const session = await finishRecording(id);
    res.json({ session: withAnnotatedTranscript(session, req) });
  } catch (err) {
    throw new AppError(500, 'Aufnahme konnte nicht beendet werden', {
      messageKey: 'errors.recordings.finishFailed',
      cause: err,
    });
  }
});

const trimSchema = z.object({
  trimStartSeconds: optionalSeconds('Trim-Werte müssen Zahlen oder null sein'),
  trimEndSeconds: optionalSeconds('Trim-Werte müssen Zahlen oder null sein'),
});

router.put('/:id/trim', requireAdmin, (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  requireSession(id);

  const { trimStartSeconds, trimEndSeconds } = parseWith(trimSchema, req.body);
  if (trimStartSeconds != null && trimEndSeconds != null && trimStartSeconds >= trimEndSeconds) {
    throw new AppError(400, 'Start muss vor Ende liegen', {
      messageKey: 'errors.recordings.trimOrder',
    });
  }

  updateSession(id, {
    trimStartSeconds: trimStartSeconds === null ? null : Number(trimStartSeconds) || 0,
    trimEndSeconds: trimEndSeconds === null ? null : Number(trimEndSeconds) || null,
  });

  emitSessionsUpdated();
  const updated = getSessionById(id);
  res.json({
    session: updated ? withAnnotatedTranscript(updated, req) : updated,
  });
});

function parseTimestamp(ts: string): number | null {
  const match = ts.match(/\[(\d{2}):(\d{2})(?::(\d{2}))?\]/);
  if (!match) return null;
  const [, a, b, c] = match;
  if (c) {
    return parseInt(a, 10) * 3600 + parseInt(b, 10) * 60 + parseInt(c, 10);
  }
  return parseInt(a, 10) * 60 + parseInt(b, 10);
}

const trimTranscriptSchema = z.object({
  startSeconds: optionalSeconds('Werte müssen Zahlen oder null sein'),
  endSeconds: optionalSeconds('Werte müssen Zahlen oder null sein'),
});

router.post('/:id/trim-transcript', requireAdmin, async (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const session = requireSession(id);

  const { startSeconds, endSeconds } = parseWith(trimTranscriptSchema, req.body);
  if (!session.transcript) {
    throw new AppError(400, 'Kein Transkript vorhanden', {
      messageKey: 'errors.recordings.noTranscript',
    });
  }

  const lines = session.transcript.split('\n');
  const trimmed = lines.filter((line) => {
    const ts = parseTimestamp(line);
    if (ts === null) return true;
    if (startSeconds != null && ts < startSeconds) return false;
    if (endSeconds != null && ts > endSeconds) return false;
    return true;
  });

  const newTranscript = trimmed.join('\n');
  const transcriptPath = join(session.directory, 'transcript.txt');
  try {
    await writeFile(transcriptPath, newTranscript);
  } catch (err) {
    throw new AppError(500, 'Transkript konnte nicht gespeichert werden', {
      messageKey: 'errors.recordings.transcriptSaveFailed',
      cause: err,
    });
  }

  updateSession(id, {
    transcript: newTranscript,
    trimStartSeconds: startSeconds !== undefined ? startSeconds : session.trimStartSeconds,
    trimEndSeconds: endSeconds !== undefined ? endSeconds : session.trimEndSeconds,
    transcribedTrimStartSeconds:
      startSeconds !== undefined ? startSeconds : session.transcribedTrimStartSeconds,
    transcribedTrimEndSeconds:
      endSeconds !== undefined ? endSeconds : session.transcribedTrimEndSeconds,
  });
  emitSessionsUpdated();

  const updated = getSessionById(id);
  res.json({
    session: updated ? withAnnotatedTranscript(updated, req) : updated,
  });
});

router.post('/:id/transcribe', requireAdmin, aiRateLimit, (req, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const session = requireSession(id);
  if (
    session.status !== 'pending_transcription' &&
    session.status !== 'error' &&
    session.status !== 'completed'
  ) {
    throw new AppError(400, 'Session kann aktuell nicht transkribiert werden', {
      messageKey: 'errors.recordings.cannotTranscribe',
    });
  }

  const files = getFilesBySessionId(id).filter((f) => f.wavPath);
  if (files.length === 0) {
    throw new AppError(400, 'Keine Audio-Dateien für diese Session vorhanden', {
      messageKey: 'errors.recordings.noAudioFiles',
    });
  }

  runTranscription(id, files, { force: true }).catch((err) => {
    log.error(`Manual transcription failed for session ${id}:`, err);
  });

  res.json({
    message: 'Transkription wird im Hintergrund gestartet',
    messageKey: 'errors.status.transcriptionStarted',
    errorCode: 'errors.status.transcriptionStarted',
  });
});

router.post('/:id/delete-audio', requireAdmin, async (req, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const session = requireSession(id);
  if (session.status === 'recording' || session.status === 'processing') {
    throw new AppError(409, 'Audiodateien können während der Verarbeitung nicht gelöscht werden', {
      messageKey: 'errors.recordings.deleteWhileProcessing',
    });
  }

  const deleted = await deleteSessionAudioFiles(id);
  res.json({
    message: `${deleted} Audiodatei(en) gelöscht`,
    messageKey: 'errors.status.audioFilesDeleted',
    errorCode: 'errors.status.audioFilesDeleted',
    params: { count: deleted },
    deleted,
  });
});

router.post('/:id/improve-transcript', requireAdmin, aiRateLimit, async (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  requireCompletedTranscript(id);
  requireAiEnabled();

  const stopProgress = startProgressMessages(
    progressPayload('KI verbessert das Transkript...', 'errors.status.transcriptImproving')
  );
  try {
    const result = await improveSessionTranscriptWithAi(id, req.user!, undefined, notifyAiLog);
    if (result.transcript === null) {
      log.error(`improveSessionTranscriptWithAi returned null for session ${id}`);
      throw new AppError(500, 'KI-Verbesserung ist fehlgeschlagen', {
        messageKey: 'errors.recordings.transcriptImprovementFailed',
      });
    }
    broadcastAiLog({
      message: 'Transkript verbessert.',
      messageKey: 'errors.status.transcriptImproved',
      errorCode: 'errors.status.transcriptImproved',
    });
    emitSessionsUpdated();
    const updated = getSessionById(id);
    res.json({ session: updated ? withAnnotatedTranscript(updated, req) : updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(`Unexpected error during transcript improvement of session ${id}:`, err);
    throw new AppError(500, 'KI-Verbesserung ist fehlgeschlagen', {
      messageKey: 'errors.recordings.transcriptImprovementFailed',
      cause: err,
    });
  } finally {
    stopProgress();
  }
});

router.post('/:id/summary', requireAdmin, aiRateLimit, async (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  requireCompletedTranscript(id);
  requireAiEnabled();

  const stopProgress = startProgressMessages(
    progressPayload('KI erstellt die Zusammenfassung...', 'errors.status.summaryCreating'),
    [
      progressPayload(
        'KI prüft vorherige Sessions, Entitäten und Tagebücher...',
        'errors.ai.working'
      ),
      progressPayload(
        'KI erstellt die ausführliche Zusammenfassung...',
        'errors.status.summaryCreating'
      ),
      progressPayload('KI erstellt die Kurz-Zusammenfassung...', 'errors.status.summaryCreating'),
      progressPayload('Fast fertig...', 'errors.ai.almostDone'),
    ]
  );
  try {
    // Ensure game days are known before summarizing – the scheduler normally
    // does this automatically after transcription, but a manual summary call
    // should also fill a missing day so knowledge/distribution sees the right
    // campaign day.
    const fresh = getSessionById(id);
    if (fresh && fresh.gameDay === null) {
      broadcastAiLog(
        progressPayload('KI ermittelt fehlende Spieltage...', 'errors.status.gameDayDetecting')
      );
      try {
        await detectSessionGameDay(id, req.user!, undefined, notifyAiLog);
      } catch (err) {
        log.warn(`Auto game day detection before summary failed for session ${id}:`, err);
      }
    }
    const result = await processSessionSummaryEntities(id, req.user!, undefined, notifyAiLog);
    if (!result.longSummary || !result.summary) {
      log.error(`processSessionSummaryEntities returned incomplete result for session ${id}`);
      throw new AppError(500, 'KI-Zusammenfassung ist fehlgeschlagen', {
        messageKey: 'errors.recordings.summaryFailed',
      });
    }

    broadcastAiLog({
      message: 'Zusammenfassung erstellt.',
      messageKey: 'errors.status.summaryCreated',
      errorCode: 'errors.status.summaryCreated',
    });
    emitSessionsUpdated();
    const updated = getSessionById(id);
    res.json({ session: updated ? withAnnotatedTranscript(updated, req) : updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(`Unexpected error during session summary of session ${id}:`, err);
    throw new AppError(500, 'KI-Zusammenfassung ist fehlgeschlagen', {
      messageKey: 'errors.recordings.summaryFailed',
      cause: err,
    });
  } finally {
    stopProgress();
  }
});

router.post('/:id/diary-draft', aiRateLimit, async (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  requireCompletedTranscript(id);
  requireAiEnabled();

  const stopProgress = startProgressMessages(
    progressPayload('KI überführt Session ins Tagebuch...', 'errors.status.diaryDraftCreating'),
    [
      progressPayload('KI prüft Session und bestehende Tagebucheinträge...', 'errors.ai.working'),
      progressPayload('KI schreibt den Tagebucheintrag...', 'errors.status.diaryDraftCreating'),
      progressPayload('KI arbeitet noch...', 'errors.ai.working'),
      progressPayload('Fast fertig...', 'errors.ai.almostDone'),
    ]
  );
  try {
    const entry = await generateSessionDiaryDraft(id, req.user!, undefined, notifyAiLog);
    if (!entry) {
      log.error(`generateSessionDiaryDraft returned null for session ${id}`);
      throw new AppError(500, 'KI-Überführung ins Tagebuch ist fehlgeschlagen', {
        messageKey: 'errors.recordings.diaryTransferFailed',
      });
    }

    broadcastAiLog({
      message: 'Tagebucheintrag-Entwurf erstellt.',
      messageKey: 'errors.status.diaryDraftCreated',
      errorCode: 'errors.status.diaryDraftCreated',
    });
    recordSessionToDiaryTransfer(id, req.user!.id, entry.id, false);
    const transfer = getSessionToDiaryTransfer(id, req.user!.id);
    res.json({ entry, transfer });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(`Unexpected error during session-to-diary draft of session ${id}:`, err);
    throw new AppError(500, 'KI-Überführung ins Tagebuch ist fehlgeschlagen', {
      messageKey: 'errors.recordings.diaryTransferFailed',
      cause: err,
    });
  } finally {
    stopProgress();
  }
});

router.post('/:id/detect-game-day', requireAdmin, aiRateLimit, async (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const session = requireCompletedTranscript(id);
  requireAiEnabled();

  const force =
    req.query.force === 'true' ||
    req.query.force === '1' ||
    (req.body && (req.body as { force?: boolean }).force === true);

  if (session.gameDay !== null && !force) {
    const existing = getSessionById(id);
    res.status(409).json({
      ...errorPayload('Spieltag bereits gesetzt. Mit ?force=true überschreiben.', {
        fallbackCode: 'errors.recordings.gameDayAlreadySet',
      }),
      session: existing ? withAnnotatedTranscript(existing, req) : existing,
    });
    return;
  }

  const stopProgress = startProgressMessages(
    progressPayload('KI ermittelt Spieltage...', 'errors.status.gameDayDetecting'),
    [
      progressPayload('KI prüft Transkript und vorherige Sessions...', 'errors.ai.working'),
      progressPayload('KI bestimmt Spieltag-Bereich...', 'errors.status.gameDayDetecting'),
      progressPayload('Fast fertig...', 'errors.ai.almostDone'),
    ]
  );
  try {
    const result = await detectSessionGameDay(id, req.user!, undefined, notifyAiLog, {
      force: !!force,
    });
    if (result.gameDay === null) {
      log.error(`detectSessionGameDay returned null for session ${id}`);
      throw new AppError(500, 'KI-Ermittlung des Spieltags ist fehlgeschlagen', {
        messageKey: 'errors.recordings.gameDayDetectionFailed',
      });
    }
    broadcastAiLog({
      message: `Spieltag ermittelt: ${result.gameDay}–${result.gameDayEnd ?? result.gameDay}.`,
      messageKey: 'errors.status.gameDayDetected',
      errorCode: 'errors.status.gameDayDetected',
      params: { start: result.gameDay, end: result.gameDayEnd ?? result.gameDay },
    });
    emitSessionsUpdated();
    const updated = getSessionById(id);
    res.json({ session: updated ? withAnnotatedTranscript(updated, req) : updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(`Unexpected error during game day detection of session ${id}:`, err);
    throw new AppError(500, 'KI-Ermittlung des Spieltags ist fehlgeschlagen', {
      messageKey: 'errors.recordings.gameDayDetectionFailed',
      cause: err,
    });
  } finally {
    stopProgress();
  }
});

router.get('/:id/progress', (req, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const session = requireSession(id);

  const progress = getTranscriptionProgress(id);
  res.json({ sessionId: id, status: session.status, progress });
});

const gameDaySchema = z.object({
  gameDay: nullableInt('Spieltag muss eine positive ganze Zahl oder null sein'),
  gameDayEnd: nullableInt('Spieltag-Ende muss eine positive ganze Zahl oder null sein'),
});

router.put('/:id/game-day', requireAdmin, (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  requireSession(id);

  const { gameDay, gameDayEnd } = parseWith(gameDaySchema, req.body);
  const end = gameDay === null ? null : (gameDayEnd ?? gameDay);
  if (end !== null && (!Number.isInteger(end) || end <= 0)) {
    throw new AppError(400, 'Spieltag-Ende muss eine positive ganze Zahl oder null sein', {
      messageKey: 'errors.validation.gameDayEnd',
    });
  }
  if (gameDay !== null && end !== null && end < gameDay) {
    throw new AppError(400, 'Endtag darf nicht vor Starttag liegen', {
      messageKey: 'errors.validation.endBeforeStart',
    });
  }
  if (gameDay !== null && end !== null && end - gameDay > 30) {
    throw new AppError(400, 'Zeitraum zu groß (max 30 Tage)', {
      messageKey: 'errors.validation.rangeTooLarge',
    });
  }

  updateSession(id, { gameDay, gameDayEnd: end });
  emitSessionsUpdated();
  const updated = getSessionById(id);
  res.json({
    session: updated ? withAnnotatedTranscript(updated, req) : updated,
  });
});

const arcSchema = z.object({
  arcId: z.preprocess(
    (v) => (v === null || v === undefined ? null : Number(v)),
    z.union([z.null(), z.number().int().positive()], {
      error: 'arcId muss eine positive ganze Zahl oder null sein',
    })
  ),
});

router.put('/:id/arc', requireAdmin, (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  requireSession(id);

  const { arcId } = parseWith(arcSchema, req.body);
  // assignSessionToArc throws an AppError for unknown arcs.
  assignSessionToArc(id, arcId);
  emitSessionsUpdated();
  const updated = getSessionById(id);
  res.json({
    session: updated ? withAnnotatedTranscript(updated, req) : updated,
  });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const session = requireSession(id);
  if (Date.now() - new Date(session.startedAt).getTime() >= SESSION_DELETE_WINDOW_MS) {
    throw new AppError(403, 'Aufnahmen älter als 14 Tage können nicht gelöscht werden', {
      messageKey: 'errors.recordings.deleteTooOld',
    });
  }

  const { directory } = deleteSession(id);
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (err) {
      log.error(`Failed to delete recording directory ${directory}:`, err);
    }
  }

  emitSessionsUpdated();
  res.json({
    message: 'Aufnahme gelöscht',
    messageKey: 'errors.status.recordingDeleted',
    errorCode: 'errors.status.recordingDeleted',
  });
});

export default router;
