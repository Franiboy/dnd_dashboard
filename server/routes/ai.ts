import { Router, type Response } from 'express';
import { authMiddleware, requireAdmin, requirePreviewAccess, type AuthRequest } from '../auth.js';
import { isAiEnabled } from '../ai/config.js';
import { startFeatureRequest, continueFeatureRequest, mergeAndPushFeatureRequest, mergeFromMainForFeatureRequest, getFeatureRequestBehind, cleanupFeatureRequest } from '../ai/worker.js';
import { onFeatureRequestsUpdated, notifyFeatureRequestsUpdated } from '../ai/events.js';
import {
  createFeatureRequest,
  getFeatureRequestById,
  listFeatureRequests,
} from '../repositories/featureRequests.js';

const router = Router();
const sseClients = new Set<Response>();

onFeatureRequestsUpdated(() => {
  const requests = listFeatureRequests().map((r) => ({
    ...r,
    behind: getFeatureRequestBehind(r.worktreePath, r.branch),
  }));
  const data = JSON.stringify({ requests });
  sseClients.forEach((client) => {
    client.write(`event: requests\n`);
    client.write(`data: ${data}\n\n`);
  });
});

function buildFeatureRequestsResponse() {
  return listFeatureRequests().map((r) => ({
    ...r,
    behind: getFeatureRequestBehind(r.worktreePath, r.branch),
  }));
}

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
  const mainServerHost = req.get('host') || hostname;
  const mainServerUrl = `${protocol}://${mainServerHost}`;
  startFeatureRequest(request.id, protocol, hostname, mainServerUrl);
  notifyFeatureRequestsUpdated();

  res.status(201).json({ ok: true, request });
});

// Preview users: list all preview_ready feature requests with URLs
router.get('/previews', authMiddleware, requirePreviewAccess, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  const previews = listFeatureRequests()
    .filter((r) => r.status === 'preview_ready' && r.previewUrl)
    .map((r) => ({ id: r.id, title: r.title, previewUrl: r.previewUrl }));
  res.json({ previews });
});

// Admin or preview users: list all feature requests
router.get('/feature-requests', authMiddleware, requirePreviewAccess, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  res.json({ requests: buildFeatureRequestsResponse() });
});

// Admin or preview users: SSE for feature request updates
router.get('/feature-requests/events', authMiddleware, requirePreviewAccess, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const requests = buildFeatureRequestsResponse();
  res.write(`event: requests\n`);
  res.write(`data: ${JSON.stringify({ requests })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
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

// Admin or preview users: continue an existing OpenCode session for the feature request
router.post('/feature-requests/:id/continue', authMiddleware, requirePreviewAccess, (req: AuthRequest, res) => {
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

  const mainServerHost = req.get('host') || req.hostname;
  const mainServerUrl = `${req.protocol}://${mainServerHost}`;
  continueFeatureRequest(id, continuePrompt, req.protocol, req.hostname, mainServerUrl);
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
    notifyFeatureRequestsUpdated();
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: result.error || 'Löschen fehlgeschlagen' });
  }
});

// Admin: merge origin/main into the feature request branch and rebuild the preview
router.post('/feature-requests/:id/merge-from-main', authMiddleware, requirePreviewAccess, (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'AI Feature ist nicht konfiguriert' });
  }
  const id = Number(req.params.id);
  const request = getFeatureRequestById(id);
  if (!request) return res.status(404).json({ error: 'Feature Request nicht gefunden' });
  if (request.status !== 'preview_ready') {
    return res.status(400).json({ error: 'Feature Request ist nicht bereit' });
  }
  const mainServerHost = req.get('host') || req.hostname;
  const mainServerUrl = `${req.protocol}://${mainServerHost}`;
  mergeFromMainForFeatureRequest(id, req.protocol, req.hostname, mainServerUrl);
  res.json({ ok: true });
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
