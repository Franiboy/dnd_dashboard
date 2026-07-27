import { Router, type Response, type NextFunction } from 'express';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { getBotStatus, getAllVoiceChannels, finishRecording, getActiveRecording, getMonitoredChannel } from '../discord/bot.js';
import { runTranscription, getTranscriptionProgress } from '../discord/transcriber.js';
import { isRecordingFeatureEnabled } from '../discord/config.js';
import { onSessionsUpdated, onStatusUpdated, onProgressUpdated, emitSessionsUpdated } from '../discord/recordingsEvents.js';
import { getSessionById, listSessions, getFilesBySessionId, getRecordingConfig, setRecordingConfig, deleteSession, updateSession } from '../repositories/recordings.js';

const router = Router();
const sseClients = new Set<Response>();

function sendStatusToClient(client: Response): void {
  const data = JSON.stringify({ bot: getBotStatus(), active: getActiveRecording() });
  client.write(`event: status\ndata: ${data}\n\n`);
}

function sendSessionsToClient(client: Response): void {
  const data = JSON.stringify({ sessions: listSessions() });
  client.write(`event: sessions\ndata: ${data}\n\n`);
}

function broadcastStatus(): void {
  const data = JSON.stringify({ bot: getBotStatus(), active: getActiveRecording() });
  sseClients.forEach((client) => {
    client.write(`event: status\ndata: ${data}\n\n`);
  });
}

function broadcastSessions(): void {
  const data = JSON.stringify({ sessions: listSessions() });
  sseClients.forEach((client) => {
    client.write(`event: sessions\ndata: ${data}\n\n`);
  });
}

function broadcastProgress(sessionId: number, progress: unknown): void {
  const data = JSON.stringify({ sessionId, progress });
  sseClients.forEach((client) => {
    client.write(`event: progress\ndata: ${data}\n\n`);
  });
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

router.use(authMiddleware, requireAdmin, requireRecordingFeature);

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);
  res.flushHeaders();

  sendStatusToClient(res);
  sendSessionsToClient(res);

  sseClients.add(res);

  const cleanup = () => {
    sseClients.delete(res);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

router.get('/status', (_req, res) => {
  res.json({ bot: getBotStatus(), active: getActiveRecording(), monitoredChannel: getMonitoredChannel() });
});

router.get('/channels', async (_req, res) => {
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

router.get('/config', (_req, res) => {
  res.json(getRecordingConfig());
});

router.post('/config', (req: AuthRequest, res) => {
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

router.post('/:id/stop', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const session = await finishRecording(id);
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put('/:id/trim', (req, res) => {
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

router.post('/:id/trim-transcript', async (req, res) => {
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
  });
  emitSessionsUpdated();

  res.json({ session: getSessionById(id) });
});

router.post('/:id/transcribe', (req, res) => {
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

  updateSession(id, { trimStartSeconds: null, trimEndSeconds: null });
  emitSessionsUpdated();

  runTranscription(id, files).catch((err) => {
    console.error(`Manual transcription failed for session ${id}:`, err);
  });

  res.json({ message: 'Transkription wird im Hintergrund gestartet' });
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

router.delete('/:id', async (req, res) => {
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
      console.error(`Failed to delete recording directory ${directory}:`, err);
    }
  }

  emitSessionsUpdated();
  res.json({ message: 'Aufnahme gelöscht' });
});

export default router;
