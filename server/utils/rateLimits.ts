import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { AuthRequest } from '../auth.js';

/**
 * Guard for AI-triggering endpoints (rewrites, summaries, knowledge runs):
 * each model call is expensive, so requests are capped per user.
 * Mounted inside routers after authMiddleware, the user id is available.
 */
export const aiRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  // App runs behind nginx on a loopback-bound socket; nginx appends the real
  // client IP as the last X-Forwarded-For entry, so trusting proxies is safe.
  validate: { trustProxy: false },
  message: { error: 'Zu viele KI-Anfragen. Bitte in wenigen Minuten erneut versuchen.' },
});
