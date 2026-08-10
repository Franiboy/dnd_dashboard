import { Router, type Response, type NextFunction } from 'express';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authMiddleware, requireAdmin, requireApproved, type AuthRequest } from '../auth.js';
import { getBotStatus, getAllVoiceChannels, finishRecording, getActiveRecording, getMonitoredChannel } from '../discord/bot.js';
import { runTranscription, getTranscriptionProgress } from '../discord/transcriber.js';
import { isRecordingFeatureEnabled } from '../discord/config.js';
import { isAiEnabled } from '../ai/config.js';
import { improveSessionTranscriptWithAi } from '../ai/sessionRewrite.js';
import { onSessionsUpdated, onStatusUpdated, onProgressUpdated, emitSessionsUpdated } from '../discord/recordingsEvents.js';
import { getSessionById, listSessions, getFilesBySessionId, getRecordingConfig, setRecordingConfig, deleteSession, updateSession } from '../repositories/recordings.js';
import { createLogger } from '../logger.js';
import { SseBroadcaster, writeSse } from '../utils/sse.js';

const log = createLogger('recordings-routes');

const router = Router();
const sseClients = new SseBroadcaster();

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

function broadcastAiLog(message: string): void {
  sseClients.broadcast('aiLog', JSON.stringify({ message }));
}

function mapOpencodeStatus(line: string): string | null {
  const [action] = line.split('·').map((s) => s.trim());
  switch (action.toLowerCase()) {
    case 'build':
      return 'KI-Modell wird geladen...';
    case 'run':
      return 'KI-Anfrage wird ausgeführt...';
    default:
      return `KI arbeitet: ${action}`;
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
        return [line];
      }
      return [];
    });

  for (const message of messages) {
    broadcastAiLog(message);
  }
}

function startProgressMessages(initialMessage: string): () => void {
  const messages = [
    'KI prüft Entitäten und Tagebücher...',
    'KI verbessert das Transkript...',
    'KI arbeitet noch...',
    'Fast fertig...',
  ];
  let index = 0;
  broadcastAiLog(initialMessage);
  const interval = setInterval(() => {
    broadcastAiLog(messages[index % messages.length]);
    index++;
  }, 3000);
  return () => clearInterval(interval);
}

onStatusUpdated(() => broadcastStatus());
onSessionsUpdated(() => broadcastSessions());
onProgressUpdated((sessionId, progress) => broadcastProgress(sessionId, progress));

function requireRecordingFeature(_req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isRecordingFeatureEnabled()) {
    res.status(503).json({ error: 'Aufnahme-Feature ist nicht konfiguriert' });
    return;
  }
  next();
}

router.use(authMiddleware, requireApproved, requireRecordingFeature);

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
  res.json({ bot: getBotStatus(), active: getActiveRecording(), monitoredChannel: getMonitoredChannel() });
});

router.get('/channels', requireAdmin, async (_req, res) => {
  try {
    const channels = await getAllVoiceChannels();
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/', (_req, res) => {
  const sessions = listSessions();
  res.json({ sessions });
});

router.get('/config', requireAdmin, (_req, res) => {
  res.json(getRecordingConfig());
});

router.post('/config', requireAdmin, (req: AuthRequest, res) => {
  const { channelId } = req.body;
  if (channelId !== undefined && channelId !== null && typeof channelId !== 'string') {
    res.status(400).json({ error: 'channelId muss ein String oder null sein' });
    return;
  }
  setRecordingConfig(channelId || null);
  res.json(getRecordingConfig());
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }
  const files = getFilesBySessionId(id);
  res.json({ session: { ...session, files } });
});

router.post('/:id/stop', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const session = await finishRecording(id);
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put('/:id/trim', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }

  const { trimStartSeconds, trimEndSeconds } = req.body;
  if (
    (trimStartSeconds !== undefined && trimStartSeconds !== null && typeof trimStartSeconds !== 'number') ||
    (trimEndSeconds !== undefined && trimEndSeconds !== null && typeof trimEndSeconds !== 'number')
  ) {
    res.status(400).json({ error: 'Trim-Werte müssen Zahlen oder null sein' });
    return;
  }

  if (trimStartSeconds !== undefined && trimEndSeconds !== undefined && trimStartSeconds !== null && trimEndSeconds !== null && trimStartSeconds >= trimEndSeconds) {
    res.status(400).json({ error: 'Start muss vor Ende liegen' });
    return;
  }

  updateSession(id, {
    trimStartSeconds: trimStartSeconds === null ? null : Number(trimStartSeconds) || 0,
    trimEndSeconds: trimEndSeconds === null ? null : Number(trimEndSeconds) || null,
  });

  emitSessionsUpdated();
  res.json({ session: getSessionById(id) });
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

router.post('/:id/trim-transcript', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }

  const { startSeconds, endSeconds } = req.body;
  if (
    (startSeconds !== undefined && startSeconds !== null && typeof startSeconds !== 'number') ||
    (endSeconds !== undefined && endSeconds !== null && typeof endSeconds !== 'number')
  ) {
    res.status(400).json({ error: 'Werte müssen Zahlen oder null sein' });
    return;
  }

  if (!session.transcript) {
    res.status(400).json({ error: 'Kein Transkript vorhanden' });
    return;
  }

  const lines = session.transcript.split('\n');
  const trimmed = lines.filter((line) => {
    const ts = parseTimestamp(line);
    if (ts === null) return true;
    if (startSeconds !== undefined && startSeconds !== null && ts < startSeconds) return false;
    if (endSeconds !== undefined && endSeconds !== null && ts > endSeconds) return false;
    return true;
  });

  const newTranscript = trimmed.join('\n');
  const transcriptPath = join(session.directory, 'transcript.txt');
  await writeFile(transcriptPath, newTranscript);

  updateSession(id, {
    transcript: newTranscript,
    trimStartSeconds: startSeconds !== undefined ? startSeconds : session.trimStartSeconds,
    trimEndSeconds: endSeconds !== undefined ? endSeconds : session.trimEndSeconds,
    transcribedTrimStartSeconds: startSeconds !== undefined ? startSeconds : session.transcribedTrimStartSeconds,
    transcribedTrimEndSeconds: endSeconds !== undefined ? endSeconds : session.transcribedTrimEndSeconds,
  });
  emitSessionsUpdated();

  res.json({ session: getSessionById(id) });
});

router.post('/:id/transcribe', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }
  if (session.status !== 'pending_transcription' && session.status !== 'error' && session.status !== 'completed') {
    res.status(400).json({ error: 'Session kann aktuell nicht transkribiert werden' });
    return;
  }

  const files = getFilesBySessionId(id).filter((f) => f.wavPath);
  if (files.length === 0) {
    res.status(400).json({ error: 'Keine Audio-Dateien für diese Session vorhanden' });
    return;
  }

  runTranscription(id, files, { force: true }).catch((err) => {
    log.error(`Manual transcription failed for session ${id}:`, err);
  });

  res.json({ message: 'Transkription wird im Hintergrund gestartet' });
});

router.post('/:id/improve-transcript', requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }
  if (session.status !== 'completed' || !session.transcript) {
    res.status(400).json({ error: 'Kein Transkript vorhanden' });
    return;
  }
  if (!isAiEnabled()) {
    res.status(503).json({ error: 'KI-Feature ist nicht konfiguriert' });
    return;
  }

  const stopProgress = startProgressMessages('KI verbessert das Transkript...');
  try {
    const result = await improveSessionTranscriptWithAi(id, req.user!, undefined, notifyAiLog);
    if (result.transcript === null) {
      log.error(`improveSessionTranscriptWithAi returned null for session ${id}`);
      res.status(500).json({ error: 'KI-Verbesserung ist fehlgeschlagen' });
      return;
    }
    const transcriptPath = join(session.directory, 'transcript.txt');
    await writeFile(transcriptPath, result.transcript);
    updateSession(id, {
      transcript: result.transcript,
      transcriptImprovedAt: new Date().toISOString(),
    });
    broadcastAiLog('Transkript verbessert.');
    emitSessionsUpdated();
    res.json({ session: getSessionById(id) });
  } catch (err) {
    log.error(`Unexpected error during transcript improvement of session ${id}:`, err);
    res.status(500).json({ error: 'KI-Verbesserung ist fehlgeschlagen' });
  } finally {
    stopProgress();
  }
});

router.get('/:id/progress', (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }

  const progress = getTranscriptionProgress(id);
  res.json({ sessionId: id, status: session.status, progress });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
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
  res.json({ message: 'Aufnahme gelöscht' });
});

export default router;
