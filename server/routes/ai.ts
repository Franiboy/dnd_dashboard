import { Router } from 'express';
import { z } from 'zod';
import { parseWith } from '../errors.js';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { executeAiActions, parseAiActions } from '../ai/actions.js';

const router = Router();

const executeSchema = z.object({
  actions: z.array(z.unknown(), { error: 'Aktionen-Array ist erforderlich' }),
});

router.use(authMiddleware, requireAdmin);

router.post('/execute', (req: AuthRequest, res) => {
  const { actions } = parseWith(executeSchema, req.body);
  const parsed = parseAiActions(actions);
  const results = executeAiActions(parsed);
  res.json({ results });
});

export default router;
