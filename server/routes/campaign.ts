import { Router } from 'express';
import { z } from 'zod';
import { orFail, parseWith } from '../errors.js';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import {
  ensureCampaignDay,
  getCurrentGameDay,
  getNextGameDay,
  listCampaignDays,
} from '../repositories/gameTimeline.js';
import type { CampaignDay } from '../../shared/types.js';

const router = Router();

const createDaySchema = z.preprocess(
  (v) => (v === undefined || v === null ? null : Number(v)),
  z.union([
    z.null(),
    z
      .number({ error: 'Spieltag muss eine positive ganze Zahl sein' })
      .int('Spieltag muss eine positive ganze Zahl sein')
      .positive('Spieltag muss eine positive ganze Zahl sein'),
  ])
);

router.use(authMiddleware, requireApproved);

router.get('/days', (_req: AuthRequest, res) => {
  const days = orFail('Zeitleiste konnte nicht geladen werden', () => listCampaignDays());
  res.json({ days, currentGameDay: getCurrentGameDay(), nextGameDay: getNextGameDay() });
});

router.post('/days', (req: AuthRequest, res) => {
  const day = parseWith(createDaySchema, req.body.day);

  // Explicit day given, or advance to the next free day.
  const target = day ?? getNextGameDay();
  const dayRow: CampaignDay = orFail('Spieltag konnte nicht angelegt werden', () =>
    ensureCampaignDay(target)
  );
  res.status(201).json({ day: dayRow, currentGameDay: getCurrentGameDay() });
});

export default router;
