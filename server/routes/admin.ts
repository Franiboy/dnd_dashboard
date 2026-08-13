import { Router, type Response } from 'express';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { getRecentLogs, getLogsPaginated, subscribeLogs } from '../logger.js';
import type { LogEntry, LogLevel } from '../../shared/types.js';
import {
  clearModelCache,
  getCheapModel,
  getNormalModel,
  isValidModel,
  listAvailableModels,
} from '../ai/modelConfig.js';
import { getAiModelSettings, setAiModelSettings } from '../repositories/aiSettings.js';
import {
  deleteUser,
  findUserById,
  getAllUsers,
  isInitialAdmin,
  setUserAdmin,
  setUserApproved,
  setUserDisabledApps,
} from '../users.js';
import { SseBroadcaster, writeSse } from '../utils/sse.js';
import { runNightlyJobNow } from '../scheduler/summaryScheduler.js';
import { runTranscriptionJobsNow } from '../discord/scheduler.js';
import { runBingoSuggestionRefillNow } from '../ai/bingoSuggestions.js';

const userEvents = new SseBroadcaster();
const logEvents = new SseBroadcaster();

function notifyUserUpdate() {
  try {
    userEvents.broadcast('users', JSON.stringify(getAllUsers()));
  } catch {
    // ignore broadcast errors
  }
}

function notifyLogUpdate(entry: LogEntry) {
  try {
    logEvents.broadcast('log', JSON.stringify(entry));
  } catch {
    // ignore broadcast errors
  }
}

subscribeLogs(notifyLogUpdate);

function checkAdminAction(
  req: AuthRequest,
  targetId: string
): { ok: true } | { ok: false; error: string } {
  const target = findUserById(targetId);
  if (!target) return { ok: false, error: 'User nicht gefunden' };
  if (isInitialAdmin(target))
    return { ok: false, error: 'Der Ursprungsadmin kann nicht verändert werden' };
  if (target.id === req.user!.id)
    return { ok: false, error: 'Du kannst deinen eigenen Account nicht verändern' };
  return { ok: true };
}

function attachSseCleanup(req: AuthRequest, res: Response, cleanup: () => void) {
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

const router = Router();

router.get('/users', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  res.json(getAllUsers());
});

router.get('/users/events', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial list
  if (!writeSse(res, 'users', JSON.stringify(getAllUsers()))) {
    return;
  }

  const cleanup = userEvents.add(res);
  attachSseCleanup(req, res, cleanup);
});

router.get('/logs/events', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send recent logs
  if (!writeSse(res, 'logs', JSON.stringify(getRecentLogs()))) {
    return;
  }

  const cleanup = logEvents.add(res);
  attachSseCleanup(req, res, cleanup);
});

const VALID_LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

router.get('/logs', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const rawLevel = req.query.level;
  const level =
    typeof rawLevel === 'string' && VALID_LOG_LEVELS.includes(rawLevel as LogLevel)
      ? (rawLevel as LogLevel)
      : undefined;

  if (rawLevel !== undefined && rawLevel !== '' && !level) {
    return res.status(400).json({ error: 'Ungültiger level-Wert' });
  }

  const before = typeof req.query.before === 'string' ? parseInt(req.query.before, 10) : undefined;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;

  if (before !== undefined && (!Number.isFinite(before) || before < 0)) {
    return res.status(400).json({ error: 'Ungültiger before-Wert' });
  }

  res.json(getLogsPaginated({ level, before, limit }));
});

router.post('/users/:id/approve', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const user = setUserApproved(targetId, true);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/reject', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const user = setUserApproved(targetId, false);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/admin', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const { isAdmin } = req.body;
  const user = setUserAdmin(targetId, isAdmin);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/disabled-apps', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const { disabledApps } = req.body;
  if (!Array.isArray(disabledApps) || disabledApps.some((app) => typeof app !== 'string')) {
    return res.status(400).json({ error: 'disabledApps muss ein Array von Strings sein' });
  }
  const user = setUserDisabledApps(targetId, disabledApps as string[]);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.delete('/users/:id', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const success = deleteUser(targetId);
  if (!success) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json({ ok: true });
});

router.get('/ai/models', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const models = await listAvailableModels();
    const settings = getAiModelSettings();
    res.json({
      models,
      normalModel: getNormalModel(),
      cheapModel: getCheapModel(),
      normalModelOverridden: isValidModel(settings.normalModel),
      cheapModelOverridden: isValidModel(settings.cheapModel),
    });
  } catch {
    res.status(500).json({ error: 'Modelle konnten nicht geladen werden' });
  }
});

router.post('/ai/models/refresh', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  try {
    clearModelCache();
    const models = await listAvailableModels(true);
    res.json({ models });
  } catch {
    res.status(500).json({ error: 'Modelle konnten nicht aktualisiert werden' });
  }
});

router.post('/nightly-job', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const started = runNightlyJobNow();
  if (started) {
    res.json({ started: true, message: 'Nightly-Job wurde gestartet.' });
  } else {
    res.status(409).json({ started: false, message: 'Nightly-Job läuft bereits.' });
  }
});

router.post('/transcription-jobs', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const started = runTranscriptionJobsNow();
  if (started) {
    res.json({ started: true, message: 'Transkription-Jobs wurden gestartet.' });
  } else {
    res.status(409).json({
      started: false,
      message: 'Transkription-Jobs laufen bereits oder sind deaktiviert.',
    });
  }
});

router.post('/bingo-suggestion-refill', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const started = runBingoSuggestionRefillNow();
  if (started) {
    res.json({ started: true, message: 'Bingo-Vorschlags-Nachfüllung wurde gestartet.' });
  } else {
    res.status(409).json({
      started: false,
      message: 'Bingo-Vorschlags-Nachfüllung läuft bereits oder KI ist deaktiviert.',
    });
  }
});

router.put('/ai/models', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const { normalModel, cheapModel } = req.body;
  const normalize = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  const normal = normalize(normalModel);
  const cheap = normalize(cheapModel);

  if (normal && !isValidModel(normal)) {
    res.status(400).json({ error: 'Ungültiges Modell' });
    return;
  }
  if (cheap && !isValidModel(cheap)) {
    res.status(400).json({ error: 'Ungültiges Modell' });
    return;
  }

  const settings = setAiModelSettings(normal, cheap);
  res.json({
    normalModel: getNormalModel(),
    cheapModel: getCheapModel(),
    normalModelOverridden: isValidModel(settings.normalModel),
    cheapModelOverridden: isValidModel(settings.cheapModel),
  });
});

export default router;
