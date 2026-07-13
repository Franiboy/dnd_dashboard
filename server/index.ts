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
  leavePlayer,
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
  ADMIN_PASSWORD,
  checkLoginAllowed,
  createDiscordUser,
  deleteUser,
  ensureAdminUser,
  findUserByDiscordId,
  findUserById,
  findUserByUsername,
  getAllUsers,
  isInitialAdmin,
  recordFailedLogin,
  resetFailedLogins,
  setUserAdmin,
  setUserApproved,
  toSafeUser,
  updateDiscordProfile,
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

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:5173/auth/discord';

function getDiscordAvatarUrl(discordId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
}

// Auth routes
app.get('/api/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.status(500).json({ error: 'Discord OAuth ist nicht konfiguriert' });
  }
  const state = crypto.randomUUID();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  res.json({ url: url.toString(), state });
});

app.post('/api/auth/discord/callback', authRateLimit, async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Code fehlt' });
  }
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Discord OAuth ist nicht konfiguriert' });
  }

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.error('Discord token error:', text);
      return res.status(401).json({ error: 'Discord Authentifizierung fehlgeschlagen' });
    }
    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) {
      const text = await userResponse.text();
      console.error('Discord user error:', text);
      return res.status(401).json({ error: 'Discord Profil konnte nicht geladen werden' });
    }
    const discordUser = await userResponse.json();

    let user = findUserByDiscordId(discordUser.id);
    const avatarUrl = getDiscordAvatarUrl(discordUser.id, discordUser.avatar);
    const displayName = discordUser.global_name || discordUser.username;
    const username = discordUser.username;

    if (!user) {
      const existingByUsername = findUserByUsername(username);
      if (existingByUsername) {
        return res.status(400).json({ error: 'Ein Account mit diesem Username existiert bereits' });
      }
      const created = createDiscordUser(discordUser.id, username, displayName, avatarUrl);
      user = findUserById(created.id);
    } else {
      if (user.displayName !== displayName || user.avatarUrl !== avatarUrl) {
        updateDiscordProfile(user.id, displayName, avatarUrl);
      }
    }

    if (!user) {
      return res.status(500).json({ error: 'Benutzer konnte nicht erstellt werden' });
    }

    if (!user.isApproved) {
      const token = createToken(user);
      setAuthCookie(res, token);
      return res.status(403).json({ error: 'Account wurde noch nicht freigegeben', user: toSafeUser(user), token });
    }

    const allowed = checkLoginAllowed(user);
    if (!allowed.allowed) {
      return res.status(403).json({ error: allowed.reason });
    }

    resetFailedLogins(user);
    const token = createToken(user);
    setAuthCookie(res, token);
    res.json({ ok: true, user: toSafeUser(user), token });
  } catch (err) {
    console.error('Discord callback error:', err);
    res.status(500).json({ error: 'Interner Fehler' });
  }
});

app.post('/api/admin/login', authRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin Login ist nicht konfiguriert' });
  }
  if (username !== 'admin' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Falsche Anmeldedaten' });
  }

  const user = findUserByUsername('admin');
  if (!user) {
    return res.status(401).json({ error: 'Admin nicht gefunden' });
  }

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
  if (!req.user!.isApproved) {
    return res.status(403).json({ error: 'Account wurde noch nicht freigegeben' });
  }
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

  socket.on('join', () => {
    const displayName = user?.displayName;
    if (!displayName) return socket.emit('error', 'Name fehlt.');
    if (user?.isAdmin) return socket.emit('error', 'Admin kann nicht als Spieler beitreten.');

    const currentGame = getGame();
    const existing = currentGame.players.find((p) => p.name === displayName);
    if (existing) {
      socketPlayerMap.set(socket.id, existing.id);
      socket.emit('joined', existing.id);
      return socket.emit('state', currentGame);
    }

    const { game: nextGame, playerId } = joinPlayer(displayName);
    socketPlayerMap.set(socket.id, playerId);
    socket.emit('joined', playerId);
    io.emit('state', nextGame);
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
    const playerId = socketPlayerMap.get(socket.id);
    socketPlayerMap.delete(socket.id);
    if (playerId) {
      io.emit('state', leavePlayer(playerId));
    }
  });
});

http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} received, shutting down gracefully...`);

  // Force close after 1.5s even if sockets are still open
  const forceExit = setTimeout(() => {
    console.log('Forcing shutdown...');
    process.exit(0);
  }, 1500);

  // Close Socket.io to drop active connections
  io.close(() => {
    http.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
