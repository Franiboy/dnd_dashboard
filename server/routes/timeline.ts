import { Router } from 'express';
import { z } from 'zod';
import { AppError, parseWith } from '../errors.js';
import {
  authMiddleware,
  requireAdmin,
  requireApproved,
  requireUser,
  type AuthRequest,
} from '../auth.js';
import { aiRateLimit } from '../utils/rateLimits.js';
import { createLogger } from '../logger.js';
import { writeSse } from '../utils/sse.js';
import { isAiEnabled } from '../ai/config.js';
import { generateTimelineForSession } from '../ai/timeline.js';
import { listSessionsPendingTimeline, listTimelineEvents } from '../repositories/timeline.js';
import {
  acquireTimelineRun,
  isTimelineRunRunning,
  runTimelineGenerationNow,
} from '../scheduler/timeline.js';
import { getTimelineBroadcaster, sendTimelineStatus } from '../timelineAiEvents.js';

const log = createLogger('timelineRoutes');

const router = Router();

const generateSchema = z
  .object({
    sessionId: z.coerce.number().int().positive({ error: 'Ungültige Session-ID' }).optional(),
  })
  .partial();

router.use(authMiddleware, requireApproved);

router.get('/', (req: AuthRequest, res) => {
  const user = requireUser(req);
  res.json({
    events: listTimelineEvents({ userId: user.id, isAdmin: user.isAdmin }),
    pendingCount: listSessionsPendingTimeline().length,
    running: isTimelineRunRunning(),
    aiEnabled: isAiEnabled(),
  });
});

router.get('/ai-events', (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const broadcaster = getTimelineBroadcaster();
  const removeFromBroadcaster = broadcaster.add(res);
  const cleanup = () => {
    removeFromBroadcaster();
  };

  if (!writeSse(res, 'connected', JSON.stringify({ ok: true }))) {
    cleanup();
    return;
  }

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

router.post('/generate', requireAdmin, aiRateLimit, async (req: AuthRequest, res) => {
  requireAiEnabled();
  const { sessionId } = parseWith(generateSchema, req.body ?? {});

  if (sessionId === undefined) {
    // Campaign-wide refresh of every pending session, fire-and-forget with
    // SSE progress so the request stays responsive for long runs. The run
    // slot is reserved atomically inside runTimelineGenerationNow.
    const pendingCount = listSessionsPendingTimeline().length;
    const started = runTimelineGenerationNow((progress) => sendTimelineStatus(progress.status));
    if (!started) {
      throw new AppError(409, 'Die Zeitleiste wird bereits aktualisiert');
    }
    log.info(`Manual timeline generation started (${pendingCount} pending sessions)`);
    res.json({ started: true, pendingCount });
    return;
  }

  // Targeted regeneration for one session, awaited like the diary AI routes.
  // The shared generation slot is reserved atomically for the full operation,
  // so a campaign-wide run (manual or nightly) can never write the same
  // session's events concurrently.
  const releaseTimelineRun = acquireTimelineRun();
  if (!releaseTimelineRun) {
    throw new AppError(409, 'Die Zeitleiste wird bereits aktualisiert');
  }
  try {
    const ok = await generateTimelineForSession(sessionId, req.user!, undefined, (line) => {
      log.info(`Timeline AI: ${line.trim()}`);
    });
    if (!ok) {
      throw new AppError(500, 'Aktualisierung der Zeitleiste ist fehlgeschlagen');
    }
  } finally {
    releaseTimelineRun();
  }
  res.json({
    ok: true,
    pendingCount: listSessionsPendingTimeline().length,
  });
});

function requireAiEnabled(): void {
  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert');
  }
}

export default router;
