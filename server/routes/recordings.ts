import { Router } from 'express';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { getBotStatus, getVoiceChannels, beginRecording, finishRecording, getActiveRecording } from '../discord/bot.js';
import { getSessionById, listSessions, getFilesBySessionId } from '../repositories/recordings.js';

const router = Router();

router.get('/status', authMiddleware, requireAdmin, (_req, res) => {
  res.json({ bot: getBotStatus(), active: getActiveRecording() });
});

router.get('/channels', authMiddleware, requireAdmin, async (_req, res) => {
  try {
    const channels = await getVoiceChannels();
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/', authMiddleware, requireAdmin, (_req, res) => {
  const sessions = listSessions();
  res.json({ sessions });
});

router.get('/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const session = getSessionById(id);
  if (!session) {
    res.status(404).json({ error: 'Aufnahme nicht gefunden' });
    return;
  }
  const files = getFilesBySessionId(id);
  res.json({ session: { ...session, files } });
});

router.post('/start', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
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

router.post('/:id/stop', authMiddleware, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const session = await finishRecording(id);
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
