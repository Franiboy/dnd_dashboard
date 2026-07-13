import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { rateLimit } from 'express-rate-limit';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../shared/types.js';
import {
  addTask,
  confirmTask,
  confirmTaskFor,
  finishGame,
  getGame,
  joinPlayer,
  removeTask,
  resetGame,
  startGame,
  updateBoard,
} from './game.js';
import {
  authMiddleware,
  clearAuthCookie,
  createToken,
  requireAdmin,
  setAuthCookie,
  type AuthRequest,
  getToken,
  verifyToken,
} from './auth.js';
import {
  checkLoginAllowed,
  createUser,
  deleteUser,
  ensureAdminUser,
  findUserById,
  findUserByUsername,
  getAllUsers,
  isInitialAdmin,
  recordFailedLogin,
  resetFailedLogins,
  setUserAdmin,
  setUserApproved,
  toSafeUser,
  verifyPassword,
} from './users.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' },
  skip: (req) => req.method !== 'POST',
});

// Ensure admin user exists at startup
ensureAdminUser();

// Auth routes
app.post('/api/register', authRateLimit, (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username?.trim() || !displayName?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Alle Felder sind Pflicht' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen haben' });
  }
  const existing = findUserByUsername(username);
  if (existing) {
    return res.status(400).json({ error: 'Username existiert bereits' });
  }
  const user = createUser(username, displayName, password);
  res.json({ ok: true, message: 'Registrierung erfolgreich. Warte auf Freigabe durch einen Admin.', user });
});

app.post('/api/login', authRateLimit, (req, res) => {
  const { username, password } = req.body;
  const user = findUserByUsername(username);

  if (!user) {
    return res.status(401).json({ error: 'Falsche Anmeldedaten' });
  }

  const allowed = checkLoginAllowed(user);
  if (!allowed.allowed) {
    return res.status(403).json({ error: allowed.reason });
  }

  if (!verifyPassword(user, password) || !user.isApproved) {
    recordFailedLogin(user);
    return res.status(401).json({ error: 'Falsche Anmeldedaten' });
  }

  resetFailedLogins(user);
  const token = createToken(user);
  setAuthCookie(res, token);
  res.json({ ok: true, user: toSafeUser(user), token });
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ ok: true, user: toSafeUser(req.user!) });
});

app.get('/api/state', authMiddleware, (req: AuthRequest, res) => {
  res.json(getGame());
});

function checkAdminAction(req: AuthRequest, targetId: string): { ok: true } | { ok: false; error: string } {
  const target = findUserById(targetId);
  if (!target) return { ok: false, error: 'User nicht gefunden' };
  if (isInitialAdmin(target)) return { ok: false, error: 'Der Ursprungsadmin kann nicht verändert werden' };
  if (target.id === req.user!.id) return { ok: false, error: 'Du kannst deinen eigenen Account nicht verändern' };
  return { ok: true };
}

// Admin routes
app.get('/api/admin/users', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  res.json(getAllUsers());
});

app.post('/api/admin/users/:id/approve', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const user = setUserApproved(targetId, true);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json(user);
});

app.post('/api/admin/users/:id/reject', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const user = setUserApproved(targetId, false);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json(user);
});

app.post('/api/admin/users/:id/admin', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const { isAdmin } = req.body;
  const user = setUserAdmin(targetId, isAdmin);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json(user);
});

app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, (req: AuthRequest, res) => {
  const targetId = req.params.id as string;
  const check = checkAdminAction(req, targetId);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const success = deleteUser(targetId);
  if (!success) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json({ ok: true });
});

// Serve static files in production
const distDir = path.join(__dirname, '..', '..', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.get(/.*/, authMiddleware, (req: AuthRequest, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const socketPlayerMap = new Map<string, string>();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || getToken(socket.handshake as any);
  if (!token) return next(new Error('Unauthorized'));
  const payload = verifyToken(token);
  if (!payload) return next(new Error('Unauthorized'));
  const user = findUserById(payload.userId);
  if (!user || !user.isApproved) return next(new Error('Unauthorized'));
  (socket as any).user = user;
  next();
});

io.on('connection', (socket) => {
  const user = (socket as any).user;
  socket.emit('state', getGame());

  socket.on('join', (name) => {
    const displayName = user?.displayName || name.trim();
    if (!displayName) return socket.emit('error', 'Name fehlt.');
    const { game, playerId } = joinPlayer(displayName);
    socketPlayerMap.set(socket.id, playerId);
    socket.emit('joined', playerId);
    io.emit('state', game);
  });

  socket.on('addTask', (text) => {
    if (!text.trim()) return socket.emit('error', 'Text fehlt.');
    io.emit('state', addTask(text));
  });

  socket.on('removeTask', (taskId) => {
    io.emit('state', removeTask(taskId));
  });

  socket.on('startGame', (gridSize) => {
    try {
      io.emit('state', startGame(gridSize));
    } catch (e: any) {
      socket.emit('error', e.message);
    }
  });

  socket.on('updateBoard', (board) => {
    const playerId = socketPlayerMap.get(socket.id);
    if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
    io.emit('state', updateBoard(playerId, board));
  });

  socket.on('confirmTask', (taskId) => {
    const playerId = socketPlayerMap.get(socket.id);
    if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
    const game = confirmTask(playerId, taskId);
    const player = game.players.find((p) => p.id === playerId);
    if (player?.status === 'bingo') {
      io.emit('bingo', player.name);
    }
    io.emit('state', game);
  });

  socket.on('confirmTaskFor', ({ playerId, taskId }) => {
    const sourceId = socketPlayerMap.get(socket.id);
    const current = getGame();
    const source = sourceId ? current.players.find((p) => p.id === sourceId) : undefined;
    const nextGame = confirmTaskFor(playerId, taskId, source?.name || 'Unbekannt');
    const target = nextGame.players.find((p) => p.id === playerId);
    if (target?.status === 'bingo') {
      io.emit('bingo', target.name);
    }
    io.emit('state', nextGame);
  });

  socket.on('finishGame', () => {
    io.emit('state', finishGame());
  });

  socket.on('resetGame', () => {
    socketPlayerMap.clear();
    io.emit('state', resetGame());
  });

  socket.on('disconnect', () => {
    socketPlayerMap.delete(socket.id);
  });
});

http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
