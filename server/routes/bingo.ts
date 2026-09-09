import { Router } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { AppError, parseWith } from '../errors.js';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import { broadcastGameState, getIoServer } from '../socket.js';
import { addTask, canManageDmTasks, getGame } from '../game.js';
import {
  getPendingSuggestions,
  getSuggestionById,
  markSuggestionAccepted,
  markSuggestionRejected,
} from '../repositories/bingoSuggestions.js';
import { ensureSuggestionPool } from '../ai/bingoSuggestions.js';
import { getTargetPoolSize } from '../bingoConfig.js';
import type { TaskAudience } from '../../shared/types.js';

const router = Router();

const bingoRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  // App runs behind nginx on a loopback-bound socket; nginx appends the real
  // client IP as the last X-Forwarded-For entry, so trusting proxies is safe.
  validate: { trustProxy: false },
});

const bingoRefreshRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

router.use(authMiddleware, requireApproved, bingoRateLimit);

const suggestionIdSchema = z.coerce.number().int().positive({ error: 'Ungültige Vorschlags-ID' });

// Dungeon masters default to their own pool; everyone else sees the player
// pool. Admins may request either pool explicitly via ?audience=.
function resolveAudience(req: AuthRequest): TaskAudience {
  const requested = req.query.audience;
  if (
    (requested === 'dm' || requested === 'players') &&
    canManageDmTasks(req.user?.role, req.user?.isAdmin)
  ) {
    return requested;
  }
  return req.user?.role === 'dungeon_master' ? 'dm' : 'players';
}

function canAccessAudience(req: AuthRequest, audience: TaskAudience): boolean {
  return audience === 'players' || canManageDmTasks(req.user?.role, req.user?.isAdmin);
}

function requireSetupPhase(action: 'annehmen' | 'ablehnen' | 'aktualisieren'): void {
  if (getGame().status !== 'setup') {
    throw new AppError(400, `Vorschläge können nur während des Setups ${action} werden`);
  }
}

function requireAccessibleSuggestion(req: AuthRequest, suggestionId: number, action: string) {
  const suggestion = getSuggestionById(suggestionId);
  if (!suggestion) {
    throw new AppError(404, 'Vorschlag nicht gefunden');
  }
  if (!canAccessAudience(req, suggestion.audience ?? 'players')) {
    throw new AppError(403, `Nur Dungeon Master können DM-Vorschläge ${action}.`);
  }
  return suggestion;
}

router.get('/suggestions', (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    res.json({ suggestions: [] });
    return;
  }

  const audience = resolveAudience(req);
  ensureSuggestionPool({ audience }).catch(() => {
    // Refill runs in the background; the current request returns whatever is already available.
  });

  const suggestions = getPendingSuggestions(getTargetPoolSize(), audience);
  res.json({ suggestions });
});

router.post('/suggestions/:id/accept', (req: AuthRequest, res) => {
  requireSetupPhase('annehmen');

  const suggestionId = parseWith(suggestionIdSchema, req.params.id);
  const suggestion = requireAccessibleSuggestion(req, suggestionId, 'annehmen');

  const task = addTask(suggestion.text, { audience: suggestion.audience ?? 'players' });
  markSuggestionAccepted(suggestionId);

  const io = getIoServer();
  if (io) {
    broadcastGameState(io);
  }

  ensureSuggestionPool({ audience: suggestion.audience ?? 'players' }).catch(() => {
    // Background refill after accepting a suggestion.
  });

  res.json({ task });
});

router.post('/suggestions/:id/reject', (req: AuthRequest, res) => {
  requireSetupPhase('ablehnen');

  const suggestionId = parseWith(suggestionIdSchema, req.params.id);
  const suggestion = requireAccessibleSuggestion(req, suggestionId, 'ablehnen');

  markSuggestionRejected(suggestionId);

  ensureSuggestionPool({ audience: suggestion.audience ?? 'players' }).catch(() => {
    // Background refill after rejecting a suggestion.
  });

  res.json({ ok: true });
});

router.post('/suggestions/refresh', bingoRefreshRateLimit, (req: AuthRequest, res) => {
  requireSetupPhase('aktualisieren');

  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert');
  }

  const audience = resolveAudience(req);

  // Reject the current pending suggestions of this pool so the AI can
  // generate a fresh set, while still remembering the old texts to avoid
  // duplicates.
  ensureSuggestionPool({ force: true, clear: true, audience }).catch(() => {
    // Refill runs in the background.
  });

  res.json({ ok: true });
});

export default router;
