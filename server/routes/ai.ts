import { Router } from 'express';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import { startFeatureRequest, continueFeatureRequest, mergeAndPushFeatureRequest, cleanupFeatureRequest } from '../ai/worker.js';
import {
  createFeatureRequest,
  getFeatureRequestById,
  listFeatureRequests,
} from '../repositories/featureRequests.js';

const router = Router();

// Only admins can submit a feature request
router.post('/feature-requests', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }

  const { title, description } = req.body;
  if (!title || typeof title !== 'string' || !description || typeof description !== 'string') {
    return res.status(400).json({ error: 'Titel und Beschreibung sind erforderlich' });
  }

  if (!req.user) {
    return res.status(403).json({ error: 'Nicht autorisiert' });
  }

  const request = createFeatureRequest(req.user.id, title.trim(), description.trim());

  // Start AI worker in background
  const protocol = req.protocol;
  const hostname = req.hostname;
  startFeatureRequest(request.id, protocol, hostname);

  res.status(201).json({ ok: true, request });
});

// Admin: list all feature requests
router.get('/feature-requests', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  res.json({ requests: listFeatureRequests() });
});

// Admin: get a single feature request
router.get('/feature-requests/:id', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  const id = Number(req.params.id);
  const request = getFeatureRequestById(id);
  if (!request) return res.status(404).json({ error: 'Feature Request nicht gefunden' });
  res.json({ request });
});

// Admin: continue an existing OpenCode session for the feature request
router.post('/feature-requests/:id/continue', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  const id = Number(req.params.id);
  const request = getFeatureRequestById(id);
  if (!request) return res.status(404).json({ error: 'Feature Request nicht gefunden' });
  if (!request.sessionId && !request.sessionTitle) {
    return res.status(400).json({ error: 'Keine zwischengespeicherte Session vorhanden' });
  }

  const { prompt } = req.body;
  const continuePrompt =
    typeof prompt === 'string' && prompt.trim()
      ? prompt.trim()
      : 'Continue implementing the feature. Run "npm run build" when done.';

  continueFeatureRequest(id, continuePrompt, req.protocol, req.hostname);
  res.json({ ok: true });
});

// Admin: delete a feature request and clean up worktree, branch and remote branch
router.delete('/feature-requests/:id', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  const id = Number(req.params.id);
  const request = getFeatureRequestById(id);
  if (!request) return res.status(404).json({ error: 'Feature Request nicht gefunden' });

  const result = cleanupFeatureRequest(id);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: result.error || 'Löschen fehlgeschlagen' });
  }
});

// Admin: merge and push the feature request
router.post('/feature-requests/:id/merge', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  const id = Number(req.params.id);
  const request = getFeatureRequestById(id);
  if (!request) return res.status(404).json({ error: 'Feature Request nicht gefunden' });
  if (request.status !== 'preview_ready') {
    return res.status(400).json({ error: 'Feature Request ist nicht bereit zum Mergen' });
  }

  const result = mergeAndPushFeatureRequest(id);
  if (result.success) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: result.error || 'Merge fehlgeschlagen' });
  }
});

export default router;
