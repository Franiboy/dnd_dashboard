import { Router } from 'express';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import { executeAiActions, parseAiActions } from '../ai/actions.js';

const router = Router();

router.use(authMiddleware, requireAdmin);

router.post('/execute', (req: AuthRequest, res) => {
  const { actions: rawActions } = req.body;
  if (!Array.isArray(rawActions)) {
    res.status(400).json({ error: 'Aktionen-Array ist erforderlich' });
    return;
  }

  const actions = parseAiActions(rawActions);
  const results = executeAiActions(actions);
  res.json({ results });
});

export default router;
