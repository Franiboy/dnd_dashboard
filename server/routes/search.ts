import { Router } from 'express';
import { z } from 'zod';
import { parseWith, orFail } from '../errors.js';
import { authMiddleware, requireApproved, requireUser, type AuthRequest } from '../auth.js';
import { globalSearch } from '../repositories/search.js';

const router = Router();

const searchQuerySchema = z.object({
  q: z
    .string({ error: 'Suchbegriff ist erforderlich' })
    .trim()
    .min(2, 'Suchbegriff muss mindestens 2 Zeichen lang sein')
    .max(200, 'Suchbegriff darf maximal 200 Zeichen lang sein'),
  limit: z.coerce
    .number({ error: 'limit muss eine Zahl sein' })
    .int('limit muss eine ganze Zahl sein')
    .min(1, 'limit muss mindestens 1 sein')
    .max(20, 'limit darf höchstens 20 sein')
    .default(8),
});

router.use(authMiddleware, requireApproved);

router.get('/', (req: AuthRequest, res) => {
  const user = requireUser(req);
  const { q, limit } = parseWith(searchQuerySchema, req.query);
  const results = orFail('Suche ist fehlgeschlagen', () =>
    globalSearch(q, { userId: user.id, limitPerSource: limit })
  );
  res.json({ results });
});

export default router;
