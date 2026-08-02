import type { Server } from 'socket.io';
import type { BingoGame, ClientToServerEvents, ServerToClientEvents, User } from '../shared/types.js';
import { getToken, verifyToken } from './auth.js';
import {
  addTask,
  confirmTask,
  confirmTaskFor,
  finishAndResetGame,
  getGame,
  joinPlayer,
  lockBoard,
  removeTask,
  setGridSize,
  setPlayerOnline,
  startGame,
  unconfirmTask,
  unlockBoard,
  updateBoard,
  updateTask,
} from './game.js';
import { findUserById } from './users.js';

export function getGameForUser(user: User): BingoGame {
  const current = getGame();
  if (user.isAdmin) return current;
  return { ...current, tasks: current.tasks.filter((t) => !t.isPrivate || t.assignedTo?.includes(user.id)) };
}

export function broadcastGameState(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
  for (const socket of io.sockets.sockets.values()) {
    const socketUser = (socket as any).user as User | undefined;
    if (!socketUser) continue;
    socket.emit('state', getGameForUser(socketUser));
  }
}

export function setupSocket(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  const socketPlayerMap = new Map<string, string>();

  function broadcastState() {
    broadcastGameState(io);
  }

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
    const user = (socket as any).user as User;
    socket.emit('state', getGameForUser(user));

    socket.on('join', () => {
      const displayName = user?.displayName;
      if (!displayName) return socket.emit('error', 'Name fehlt.');

      const currentGame = getGame();
      const existing = currentGame.players.find((p) => p.name === displayName);
      if (existing) {
        if (user.id && !existing.userId) existing.userId = user.id;
        if (user.avatarUrl !== undefined && existing.avatarUrl !== user.avatarUrl) {
          existing.avatarUrl = user.avatarUrl;
        }
        socketPlayerMap.set(socket.id, existing.id);
        socket.emit('joined', existing.id);
        setPlayerOnline(existing.id, true);
        broadcastState();
        return;
      }

      const { playerId } = joinPlayer(displayName, user.id, user.avatarUrl);
      socketPlayerMap.set(socket.id, playerId);
      socket.emit('joined', playerId);
      broadcastState();
    });

    socket.on('addTask', (payload) => {
      const raw = payload as any;
      const text = typeof raw === 'string' ? raw : raw?.text;
      const isPrivate = typeof raw === 'string' ? false : !!raw?.isPrivate;
      const assignedTo = Array.isArray(raw?.assignedTo) ? raw.assignedTo : [];
      if (!text?.trim()) return socket.emit('error', 'Text fehlt.');
      if (isPrivate && assignedTo.length === 0) return socket.emit('error', 'Private Aufgaben müssen mindestens einer Person zugewiesen werden.');
      addTask(text, { isPrivate, assignedTo });
      broadcastState();
    });

    socket.on('removeTask', (taskId) => {
      removeTask(taskId);
      broadcastState();
    });

    socket.on('updateTask', ({ taskId, text, isPrivate, assignedTo }) => {
      try {
        updateTask(taskId, { text, isPrivate, assignedTo });
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('setGridSize', (gridSize) => {
      if (!user?.isAdmin) return socket.emit('error', 'Nur Admins können die Feldgröße ändern.');
      try {
        setGridSize(gridSize);
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('startGame', () => {
      if (!user?.isAdmin) return socket.emit('error', 'Nur Admins können das Spiel starten.');
      try {
        startGame();
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('updateBoard', (board) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      try {
        updateBoard(playerId, board);
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('lockBoard', () => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      try {
        lockBoard(playerId);
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('unlockBoard', () => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      try {
        unlockBoard(playerId);
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('confirmTask', (taskId) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      const beforeBingo = new Set(getGame().players.filter((p) => p.status === 'bingo').map((p) => p.id));
      confirmTask(playerId, taskId);
      getGame().players.forEach((p) => {
        if (p.status === 'bingo' && !beforeBingo.has(p.id)) {
          io.emit('bingo', p.name);
        }
      });
      broadcastState();
    });

    socket.on('confirmTaskFor', ({ playerId, taskId }) => {
      const sourceId = socketPlayerMap.get(socket.id);
      const current = getGame();
      const source = sourceId ? current.players.find((p) => p.id === sourceId) : undefined;
      const beforeBingo = new Set(current.players.filter((p) => p.status === 'bingo').map((p) => p.id));
      confirmTaskFor(playerId, taskId, source?.name || 'Unbekannt');
      getGame().players.forEach((p) => {
        if (p.status === 'bingo' && !beforeBingo.has(p.id)) {
          io.emit('bingo', p.name);
        }
      });
      broadcastState();
    });

    socket.on('unconfirmTask', (taskId) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      unconfirmTask(taskId);
      broadcastState();
    });

    socket.on('resetGame', () => {
      if (!user?.isAdmin) return socket.emit('error', 'Nur Admins können das Spiel zurücksetzen.');
      finishAndResetGame();
      broadcastState();
    });

    socket.on('disconnect', () => {
      const playerId = socketPlayerMap.get(socket.id);
      socketPlayerMap.delete(socket.id);
      if (playerId) {
        setPlayerOnline(playerId, false);
        broadcastState();
      }
    });
  });
}
