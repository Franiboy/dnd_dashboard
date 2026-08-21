import { Router } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { listElementsForUser } from '../whiteboard.js';

const router = Router();

const whiteboardRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

router.use(authMiddleware, requireApproved, whiteboardRateLimit);

// Initial load of the board. All further changes flow through Socket.io.
router.get('/', (req: AuthRequest, res) => {
  res.json({ elements: listElementsForUser(req.user!) });
});

export default router;
