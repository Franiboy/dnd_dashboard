import { Router, type Response } from 'express';
import { authMiddleware, requireAdmin, type AuthRequest } from '../auth.js';
import {
  deleteUser,
  findUserById,
  getAllUsers,
  isInitialAdmin,
  setUserAdmin,
  setUserApproved,
  setUserDisabledApps,
  setUserPreviewAccess,
} from '../users.js';

const sseClients = new Set<Response>();

function notifyUserUpdate() {
  const data = JSON.stringify(getAllUsers());
  sseClients.forEach((client) => {
    client.write(`event: users\n`);
    client.write(`data: ${data}\n\n`);
  });
}

function checkAdminAction(req: AuthRequest, targetId: string): { ok: true } | { ok: false; error: string } {
  const target = findUserById(targetId);
  if (!target) return { ok: false, error: 'User nicht gefunden' };
  if (isInitialAdmin(target)) return { ok: false, error: 'Der Ursprungsadmin kann nicht verändert werden' };
  if (target.id === req.user!.id) return { ok: false, error: 'Du kannst deinen eigenen Account nicht verändern' };
  return { ok: true };
}

const router = Router();

router.get('/users', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  res.json(getAllUsers());
});

router.get('/users/events', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial list
  res.write(`event: users\n`);
  res.write(`data: ${JSON.stringify(getAllUsers())}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

router.post('/users/:id/approve', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const user = setUserApproved(targetId, true);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/reject', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const user = setUserApproved(targetId, false);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/admin', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const { isAdmin } = req.body;
  const user = setUserAdmin(targetId, isAdmin);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/preview-access', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const { canAccessPreviews } = req.body;
  const user = setUserPreviewAccess(targetId, canAccessPreviews);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.post('/users/:id/disabled-apps', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const { disabledApps } = req.body;
  if (!Array.isArray(disabledApps) || disabledApps.some((app) => typeof app !== 'string')) {
    return res.status(400).json({ error: 'disabledApps muss ein Array von Strings sein' });
  }
  const user = setUserDisabledApps(targetId, disabledApps as string[]);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json(user);
});

router.delete('/users/:id', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const success = deleteUser(targetId);
  if (!success) return res.status(404).json({ error: 'User nicht gefunden' });
  notifyUserUpdate();
  res.json({ ok: true });
});

export default router;
