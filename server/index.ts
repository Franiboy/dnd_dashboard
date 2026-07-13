import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3001;
const DND_PASSWORD = process.env.DND_PASSWORD || 'dnd1234';

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Auth middleware for API
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.cookies?.dnd_auth || req.headers['x-dnd-password'];
  if (token === DND_PASSWORD) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === DND_PASSWORD) {
    res.cookie('dnd_auth', password, { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Falsches Passwort' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('dnd_auth');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, (req, res) => {
  res.json(getGame());
});

// Serve static files in production
const distDir = path.join(__dirname, '..', '..', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.get(/.*/, requireAuth, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const socketPlayerMap = new Map<string, string>();

io.use((socket, next) => {
  const password = socket.handshake.auth?.password || socket.handshake.headers['x-dnd-password'];
  if (password === DND_PASSWORD) {
    return next();
  }
  next(new Error('Unauthorized'));
});

io.on('connection', (socket) => {
  socket.emit('state', getGame());

  socket.on('join', (name) => {
    if (!name.trim()) return socket.emit('error', 'Name fehlt.');
    const { game, playerId } = joinPlayer(name);
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
