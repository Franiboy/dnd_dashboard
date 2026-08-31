import { Router } from 'express';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import {
  ensureCampaignDay,
  getCurrentGameDay,
  getNextGameDay,
  listCampaignDays,
} from '../repositories/gameTimeline.js';
import type { CampaignDay } from '../../shared/types.js';

const router = Router();

router.use(authMiddleware, requireApproved);

router.get('/days', (_req: AuthRequest, res) => {
  try {
    const days = listCampaignDays();
    res.json({ days, currentGameDay: getCurrentGameDay(), nextGameDay: getNextGameDay() });
  } catch {
    res.status(500).json({ error: 'Zeitleiste konnte nicht geladen werden' });
  }
});

router.post('/days', (req: AuthRequest, res) => {
  const { day } = req.body;
  const dayNum = day === undefined || day === null ? null : Number(day);
  if (dayNum !== null && (!Number.isInteger(dayNum) || dayNum <= 0)) {
    res.status(400).json({ error: 'Spieltag muss eine positive ganze Zahl sein' });
    return;
  }

  try {
    // Explicit day given, or advance to the next free day.
    const target = dayNum ?? getNextGameDay();
    const dayRow: CampaignDay = ensureCampaignDay(target);
    res.status(201).json({ day: dayRow, currentGameDay: getCurrentGameDay() });
  } catch {
    res.status(500).json({ error: 'Spieltag konnte nicht angelegt werden' });
  }
});

export default router;
