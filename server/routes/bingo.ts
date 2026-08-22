import { Router } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Server } from 'socket.io';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import { broadcastGameState } from '../socket.js';
import { addTask, canManageDmTasks, getGame } from '../game.js';
import {
  getPendingSuggestions,
  getSuggestionById,
  markSuggestionAccepted,
  markSuggestionRejected,
} from '../repositories/bingoSuggestions.js';
import { ensureSuggestionPool } from '../ai/bingoSuggestions.js';
import { getTargetPoolSize } from '../bingoConfig.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  TaskAudience,
} from '../../shared/types.js';

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

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

function getIo(req: AuthRequest): IoServer | undefined {
  return (req.app.get('io') as IoServer | undefined) ?? undefined;
}

// Dungeon masters default to their own pool; everyone else sees the player
// pool. Admins may request either pool explicitly via ?audience=.
function resolveAudience(req: AuthRequest): TaskAudience {
  const requested = req.query.audience;
  if (
    (requested === 'dm' || requested === 'players') &&
    canManageDmTasks((req as AuthRequest).user?.role, (req as AuthRequest).user?.isAdmin)
  ) {
    return requested;
  }
  return (req as AuthRequest).user?.role === 'dungeon_master' ? 'dm' : 'players';
}

function canAccessAudience(req: AuthRequest, audience: TaskAudience): boolean {
  return (
    audience === 'players' ||
    canManageDmTasks((req as AuthRequest).user?.role, (req as AuthRequest).user?.isAdmin)
  );
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
  if (getGame().status !== 'setup') {
    res.status(400).json({ error: 'Suggestions can only be accepted during setup' });
    return;
  }

  const suggestionId = Number(req.params.id);
  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    res.status(400).json({ error: 'Invalid suggestion id' });
    return;
  }

  const suggestion = getSuggestionById(suggestionId);
  if (!suggestion) {
    res.status(404).json({ error: 'Suggestion not found' });
    return;
  }

  if (!canAccessAudience(req, suggestion.audience ?? 'players')) {
    res.status(403).json({ error: 'Nur Dungeon Master können DM-Vorschläge annehmen.' });
    return;
  }

  const task = addTask(suggestion.text, { audience: suggestion.audience ?? 'players' });
  markSuggestionAccepted(suggestionId);

  const io = getIo(req);
  if (io) {
    broadcastGameState(io);
  }

  ensureSuggestionPool({ audience: suggestion.audience ?? 'players' }).catch(() => {
    // Background refill after accepting a suggestion.
  });

  res.json({ task });
});

router.post('/suggestions/:id/reject', (req: AuthRequest, res) => {
  if (getGame().status !== 'setup') {
    res.status(400).json({ error: 'Suggestions can only be rejected during setup' });
    return;
  }

  const suggestionId = Number(req.params.id);
  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    res.status(400).json({ error: 'Invalid suggestion id' });
    return;
  }

  const suggestion = getSuggestionById(suggestionId);
  if (!suggestion) {
    res.status(404).json({ error: 'Suggestion not found' });
    return;
  }

  if (!canAccessAudience(req, suggestion.audience ?? 'players')) {
    res.status(403).json({ error: 'Nur Dungeon Master können DM-Vorschläge ablehnen.' });
    return;
  }

  markSuggestionRejected(suggestionId);

  ensureSuggestionPool({ audience: suggestion.audience ?? 'players' }).catch(() => {
    // Background refill after rejecting a suggestion.
  });

  res.json({ ok: true });
});

router.post('/suggestions/refresh', bingoRefreshRateLimit, (req: AuthRequest, res) => {
  if (getGame().status !== 'setup') {
    res.status(400).json({ error: 'Suggestions can only be refreshed during setup' });
    return;
  }

  if (!isAiEnabled()) {
    res.status(503).json({ error: 'AI not enabled' });
    return;
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
