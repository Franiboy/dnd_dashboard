import { Router, type Response } from 'express';
import { z } from 'zod';
import { AppError, parseWith } from '../errors.js';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { getRecentLogs, getLogsPaginated, subscribeLogs } from '../logger.js';
import type { LogEntry, LogLevel, UserRole } from '../../shared/types.js';
import { USER_ROLES } from '../../shared/types.js';
import { getModel, isValidModel, listAvailableModels } from '../ai/modelConfig.js';
import { getAiModelSettings, setAiModelSettings } from '../repositories/aiSettings.js';
import {
  deleteUser,
  findUserById,
  getAllUsers,
  isInitialAdmin,
  setUserAdmin,
  setUserApproved,
  setUserDisabledApps,
  setUserRole,
} from '../users.js';
import { SseBroadcaster, writeSse } from '../utils/sse.js';
import { syncPlayersFromUsers } from '../game.js';
import { isNightlyJobRunning, runNightlyJobNow } from '../scheduler/summaryScheduler.js';
import { isTranscriptionJobRunning, runTranscriptionJobsNow } from '../discord/scheduler.js';
import {
  isBingoSuggestionRefillRunning,
  runBingoSuggestionRefillNow,
} from '../ai/bingoSuggestions.js';

const userEvents = new SseBroadcaster();
const logEvents = new SseBroadcaster();
const jobEvents = new SseBroadcaster();

interface JobStatus {
  nightly: boolean;
  transcription: boolean;
  bingoSuggestion: boolean;
}

function getJobStatus(): JobStatus {
  return {
    nightly: isNightlyJobRunning(),
    transcription: isTranscriptionJobRunning(),
    bingoSuggestion: isBingoSuggestionRefillRunning(),
  };
}

function notifyJobUpdate() {
  try {
    jobEvents.broadcast('jobs', JSON.stringify(getJobStatus()));
  } catch {
    // ignore broadcast errors
  }
}

// Jobs flip their running flag inside the scheduler modules, so scheduled
// (non-API) starts and finishes are picked up by this short poll.
let lastJobStatusJson = JSON.stringify(getJobStatus());
setInterval(() => {
  const json = JSON.stringify(getJobStatus());
  if (json !== lastJobStatusJson) {
    lastJobStatusJson = json;
    notifyJobUpdate();
  }
}, 1000).unref();

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

/** Guards destructive admin actions against self-modification and the initial admin. */
function requireAdminActionTarget(req: AuthRequest, targetId: string) {
  const target = findUserById(targetId);
  if (!target) throw new AppError(403, 'User nicht gefunden');
  if (isInitialAdmin(target)) {
    throw new AppError(403, 'Der Ursprungsadmin kann nicht verändert werden');
  }
  if (target.id === req.user!.id) {
    throw new AppError(403, 'Du kannst deinen eigenen Account nicht verändern');
  }
  return target;
}

function requireExistingUser(targetId: string) {
  const user = findUserById(targetId);
  if (!user) throw new AppError(404, 'User nicht gefunden');
  return user;
}

function attachSseCleanup(req: AuthRequest, res: Response, cleanup: () => void) {
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

function startSse(res: Response, event: string, payload: unknown): boolean {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  return writeSse(res, event, JSON.stringify(payload));
}

const router = Router();

const logsQuerySchema = z.object({
  level: z.preprocess(
    (v) => (typeof v === 'string' && v ? v : undefined),
    z
      .enum(['debug', 'info', 'warn', 'error'] as const, { error: 'Ungültiger level-Wert' })
      .optional()
  ),
  before: z.preprocess(
    (v) => (typeof v === 'string' ? Number.parseInt(v, 10) : undefined),
    z.number({ error: 'Ungültiger before-Wert' }).int().min(0, 'Ungültiger before-Wert').optional()
  ),
  limit: z.preprocess(
    (v) => (typeof v === 'string' ? Number.parseInt(v, 10) : undefined),
    z.number({ error: 'Ungültiger limit-Wert' }).int().optional()
  ),
});

const roleSchema = z.object({
  role: z.enum(USER_ROLES as readonly [UserRole, ...UserRole[]], { error: 'Ungültige Rolle' }),
});

const adminFlagSchema = z.object({
  isAdmin: z.boolean({ error: 'isAdmin muss ein Boolean sein' }),
});

const disabledAppsSchema = z.object({
  disabledApps: z.array(z.string(), { error: 'disabledApps muss ein Array von Strings sein' }),
});

const modelSchema = z.object({
  model: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
    z.string().nullable()
  ),
});

router.get('/users', authMiddleware, requireAdmin, (_req: AuthRequest, res) => {
  res.json(getAllUsers());
});

router.get('/users/events', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  // Send initial list
  if (!startSse(res, 'users', getAllUsers())) {
    return;
  }
  attachSseCleanup(req, res, userEvents.add(res));
});

router.get('/logs/events', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  // Send recent logs
  if (!startSse(res, 'logs', getRecentLogs())) {
    return;
  }
  attachSseCleanup(req, res, logEvents.add(res));
});

router.get('/logs', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const { level, before, limit } = parseWith(logsQuerySchema, req.query);
  res.json(getLogsPaginated({ level, before, limit }));
});

router.post('/users/:id/approve', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  requireAdminActionTarget(req, targetId);
  const user = setUserApproved(targetId, true);
  if (!user) throw new AppError(404, 'User nicht gefunden');
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/reject', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  requireAdminActionTarget(req, targetId);
  const user = setUserApproved(targetId, false);
  if (!user) throw new AppError(404, 'User nicht gefunden');
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/admin', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  requireAdminActionTarget(req, targetId);
  const { isAdmin } = parseWith(adminFlagSchema, req.body);
  const user = setUserAdmin(targetId, isAdmin);
  if (!user) throw new AppError(404, 'User nicht gefunden');
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/role', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const { role } = parseWith(roleSchema, req.body);
  // Unlike other admin actions, the role may also be changed on the own
  // account and the initial admin - it does not affect admin permissions.
  requireExistingUser(targetId);
  const user = setUserRole(targetId, role);
  if (!user) throw new AppError(404, 'User nicht gefunden');
  // Players and dungeon masters are permanent bingo participants; reflect the
  // role change in the bingo player list immediately.
  syncPlayersFromUsers();
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/disabled-apps', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  requireAdminActionTarget(req, targetId);
  const { disabledApps } = parseWith(disabledAppsSchema, req.body);
  const user = setUserDisabledApps(targetId, disabledApps);
  if (!user) throw new AppError(404, 'User nicht gefunden');
  notifyUserUpdate();
  res.json(user);
});

router.delete('/users/:id', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  requireAdminActionTarget(req, targetId);
  if (!deleteUser(targetId)) throw new AppError(404, 'User nicht gefunden');
  notifyUserUpdate();
  res.json({ ok: true });
});

router.get('/ai/models', authMiddleware, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const models = await listAvailableModels();
    const settings = getAiModelSettings();
    res.json({
      models,
      model: getModel(),
      modelOverridden: isValidModel(settings.model),
    });
  } catch (err) {
    throw new AppError(500, 'Modelle konnten nicht geladen werden', { cause: err });
  }
});

router.get('/jobs/status', authMiddleware, requireAdmin, (_req: AuthRequest, res) => {
  res.json(getJobStatus());
});

router.get('/jobs/events', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  // Send initial status
  if (!startSse(res, 'jobs', getJobStatus())) {
    return;
  }
  attachSseCleanup(req, res, jobEvents.add(res));
});

router.post('/nightly-job', authMiddleware, requireAdmin, (_req: AuthRequest, res) => {
  const started = runNightlyJobNow();
  if (started) {
    notifyJobUpdate();
    res.json({ started: true, message: 'Nightly-Job wurde gestartet.' });
  } else {
    res.status(409).json({
      started: false,
      message: 'Nightly-Job läuft bereits.',
      error: 'Nightly-Job läuft bereits.',
    });
  }
});

router.post('/transcription-jobs', authMiddleware, requireAdmin, (_req: AuthRequest, res) => {
  const started = runTranscriptionJobsNow();
  if (started) {
    notifyJobUpdate();
    res.json({ started: true, message: 'Transkription-Jobs wurden gestartet.' });
  } else {
    const message = 'Transkription-Jobs laufen bereits oder sind deaktiviert.';
    res.status(409).json({
      started: false,
      message,
      error: message,
    });
  }
});

router.post('/bingo-suggestion-refill', authMiddleware, requireAdmin, (_req: AuthRequest, res) => {
  const started = runBingoSuggestionRefillNow();
  if (started) {
    notifyJobUpdate();
    res.json({ started: true, message: 'Bingo-Vorschlags-Nachfüllung wurde gestartet.' });
  } else {
    const message = 'Bingo-Vorschlags-Nachfüllung läuft bereits oder KI ist deaktiviert.';
    res.status(409).json({
      started: false,
      message,
      error: message,
    });
  }
});

router.put('/ai/models', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const { model } = parseWith(modelSchema, req.body);
  if (model && !isValidModel(model)) {
    throw new AppError(400, 'Ungültiges Modell');
  }
  const settings = setAiModelSettings(model);
  res.json({
    model: getModel(),
    modelOverridden: isValidModel(settings.model),
  });
});

export default router;
