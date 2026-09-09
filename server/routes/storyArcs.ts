import { Router } from 'express';
import { z } from 'zod';
import { AppError, orFail, parseWith } from '../errors.js';
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

const idParamSchema = z.coerce.number().int().positive({ error: 'Ungültige ID' });

const chapterNumberSchema = z.union(
  [
    z.null(),
    z.coerce
      .number()
      .int({ error: 'Kapitelnummer muss eine ganze Zahl sein' })
      .positive({ error: 'Kapitelnummer muss positiv sein' }),
  ],
  { error: 'Kapitelnummer muss eine positive Zahl sein' }
);

const createArcSchema = z.object({
  name: z.string({ error: 'Name ist erforderlich' }).trim().min(1, 'Name ist erforderlich'),
  description: z.preprocess((v) => (typeof v === 'string' ? v : null), z.string().nullable()),
  chapterNumber: chapterNumberSchema.optional(),
});

const updateArcSchema = z
  .object({
    name: z
      .string({ error: 'Name darf nicht leer sein' })
      .trim()
      .min(1, 'Name darf nicht leer sein'),
    description: z.union([z.null(), z.string()], { error: 'Beschreibung muss ein Text sein' }),
    chapterNumber: chapterNumberSchema,
  })
  .partial();

router.use(authMiddleware, requireApproved);

router.get('/', (_req: AuthRequest, res) => {
  res.json({ arcs: orFail('Story Arcs konnten nicht geladen werden', () => listStoryArcs()) });
});

router.post('/', requireAdmin, (req: AuthRequest, res) => {
  const { name, description, chapterNumber } = parseWith(createArcSchema, req.body);
  const arc = orFail('Story Arc konnte nicht angelegt werden', () =>
    createStoryArc({ name, description, chapterNumber: chapterNumber ?? null })
  );
  log.info(`Created story arc ${arc.id} (${arc.name})`);
  res.status(201).json({ arc });
});

router.put('/:id', requireAdmin, (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const updates = parseWith(updateArcSchema, req.body);

  const arc = orFail('Story Arc konnte nicht gespeichert werden', () =>
    updateStoryArc(id, updates)
  );
  if (!arc) {
    throw new AppError(404, 'Story Arc nicht gefunden');
  }
  res.json({ arc });
});

router.post('/:id/activate', requireAdmin, (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);

  const arc = orFail('Story Arc konnte nicht aktiviert werden', () => activateStoryArc(id));
  if (!arc) {
    throw new AppError(404, 'Story Arc nicht gefunden');
  }
  log.info(`Activated story arc ${arc.id} (${arc.name})`);
  res.json({ arc });
});

router.delete('/:id', requireAdmin, (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);

  // deleteStoryArc throws AppErrors with user-facing guard messages
  // (active/completed arcs are protected from deletion).
  const deleted = deleteStoryArc(id);
  if (!deleted) {
    throw new AppError(404, 'Story Arc nicht gefunden');
  }
  log.info(`Deleted story arc ${id}`);
  res.json({ ok: true });
});

export default router;
