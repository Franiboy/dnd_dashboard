import { Router, type Response, type NextFunction } from 'express';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { getBotStatus, getVoiceChannels, beginRecording, finishRecording, getActiveRecording } from '../discord/bot.js';
import { runTranscription } from '../discord/transcriber.js';
import { isRecordingFeatureEnabled } from '../discord/config.js';
import { onSessionsUpdated, onStatusUpdated } from '../discord/recordingsEvents.js';
import { getSessionById, listSessions, getFilesBySessionId } from '../repositories/recordings.js';

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

onStatusUpdated(() => broadcastStatus());
onSessionsUpdated(() => broadcastSessions());

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
  res.json({ bot: getBotStatus(), active: getActiveRecording() });
});

router.get('/channels', async (_req, res) => {
  try {
    const channels = await getVoiceChannels();
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/', (_req, res) => {
  const sessions = listSessions();
  res.json({ sessions });
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

router.post('/start', async (req: AuthRequest, res) => {
  const { channelId, name } = req.body;
  if (!channelId || typeof channelId !== 'string') {
    res.status(400).json({ error: 'channelId ist erforderlich' });
    return;
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Name ist erforderlich' });
    return;
  }
  if (!req.user) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  try {
    const session = await beginRecording(channelId, name.trim(), req.user.id);
    res.status(201).json({ session });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
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

router.post('/:id/transcribe', (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }
  if (session.status !== 'pending_transcription' && session.status !== 'error') {
    res.status(400).json({ error: 'Session kann aktuell nicht transkribiert werden' });
    return;
  }

  const files = getFilesBySessionId(id).filter((f) => f.wavPath);
  if (files.length === 0) {
    res.status(400).json({ error: 'Keine Audio-Dateien für diese Session vorhanden' });
    return;
  }

  runTranscription(id, files).catch((err) => {
    console.error(`Manual transcription failed for session ${id}:`, err);
  });

  res.json({ message: 'Transkription wird im Hintergrund gestartet' });
});

export default router;
