import { Router } from 'express';
import { authMiddleware, requireAdmin, requireApproved, type AuthRequest } from '../auth.js';
import { createLogger } from '../logger.js';
import {
  createStoryArc,
  deleteStoryArc,
  activateStoryArc,
  listStoryArcs,
  updateStoryArc,
} from '../repositories/storyArcs.js';

const log = createLogger('storyArcRoutes');

const router = Router();

router.use(authMiddleware, requireApproved);

router.get('/', (_req: AuthRequest, res) => {
  try {
    res.json({ arcs: listStoryArcs() });
  } catch {
    res.status(500).json({ error: 'Story Arcs konnten nicht geladen werden' });
  }
});

router.post('/', requireAdmin, (req: AuthRequest, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Name ist erforderlich' });
    return;
  }

  try {
    const arc = createStoryArc({
      name: name.trim(),
      description: typeof description === 'string' ? description : null,
    });
    log.info(`Created story arc ${arc.id} (${arc.name})`);
    res.status(201).json({ arc });
  } catch {
    res.status(500).json({ error: 'Story Arc konnte nicht angelegt werden' });
  }
});

router.put('/:id', requireAdmin, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ungültige ID' });
    return;
  }

  const { name, description } = req.body;
  const updates: { name?: string; description?: string | null } = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name darf nicht leer sein' });
      return;
    }
    updates.name = name;
  }
  if (description !== undefined) {
    if (description !== null && typeof description !== 'string') {
      res.status(400).json({ error: 'Beschreibung muss ein Text sein' });
      return;
    }
    updates.description = description;
  }

  try {
    const arc = updateStoryArc(id, updates);
    if (!arc) {
      res.status(404).json({ error: 'Story Arc nicht gefunden' });
      return;
    }
    res.json({ arc });
  } catch {
    res.status(500).json({ error: 'Story Arc konnte nicht gespeichert werden' });
  }
});

router.post('/:id/activate', requireAdmin, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ungültige ID' });
    return;
  }

  try {
    const arc = activateStoryArc(id);
    if (!arc) {
      res.status(404).json({ error: 'Story Arc nicht gefunden' });
      return;
    }
    log.info(`Activated story arc ${arc.id} (${arc.name})`);
    res.json({ arc });
  } catch {
    res.status(500).json({ error: 'Story Arc konnte nicht aktiviert werden' });
  }
});

router.delete('/:id', requireAdmin, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ungültige ID' });
    return;
  }

  try {
    const deleted = deleteStoryArc(id);
    if (!deleted) {
      res.status(404).json({ error: 'Story Arc nicht gefunden' });
      return;
    }
    log.info(`Deleted story arc ${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Story Arc konnte nicht gelöscht werden',
    });
  }
});

export default router;
