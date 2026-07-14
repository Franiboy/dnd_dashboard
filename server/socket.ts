import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
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
} from './game.js';
import { findUserById } from './users.js';

export function setupSocket(io: Server<ClientToServerEvents, ServerToClientEvents>) {
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

      const currentGame = getGame();
      const existing = currentGame.players.find((p) => p.name === displayName);
      if (existing) {
        socketPlayerMap.set(socket.id, existing.id);
        socket.emit('joined', existing.id);
        const updatedGame = setPlayerOnline(existing.id, true);
        return io.emit('state', updatedGame);
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

    socket.on('setGridSize', (gridSize) => {
      if (!user?.isAdmin) return socket.emit('error', 'Nur Admins können die Feldgröße ändern.');
      try {
        io.emit('state', setGridSize(gridSize));
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('startGame', () => {
      if (!user?.isAdmin) return socket.emit('error', 'Nur Admins können das Spiel starten.');
      try {
        io.emit('state', startGame());
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('updateBoard', (board) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      try {
        io.emit('state', updateBoard(playerId, board));
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('lockBoard', () => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      try {
        io.emit('state', lockBoard(playerId));
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('unlockBoard', () => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      try {
        io.emit('state', unlockBoard(playerId));
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('confirmTask', (taskId) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      const beforeBingo = new Set(getGame().players.filter((p) => p.status === 'bingo').map((p) => p.id));
      const game = confirmTask(playerId, taskId);
      game.players.forEach((p) => {
        if (p.status === 'bingo' && !beforeBingo.has(p.id)) {
          io.emit('bingo', p.name);
        }
      });
      io.emit('state', game);
    });

    socket.on('confirmTaskFor', ({ playerId, taskId }) => {
      const sourceId = socketPlayerMap.get(socket.id);
      const current = getGame();
      const source = sourceId ? current.players.find((p) => p.id === sourceId) : undefined;
      const beforeBingo = new Set(current.players.filter((p) => p.status === 'bingo').map((p) => p.id));
      const nextGame = confirmTaskFor(playerId, taskId, source?.name || 'Unbekannt');
      nextGame.players.forEach((p) => {
        if (p.status === 'bingo' && !beforeBingo.has(p.id)) {
          io.emit('bingo', p.name);
        }
      });
      io.emit('state', nextGame);
    });

    socket.on('unconfirmTask', (taskId) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      io.emit('state', unconfirmTask(taskId));
    });

    socket.on('resetGame', () => {
      if (!user?.isAdmin) return socket.emit('error', 'Nur Admins können das Spiel zurücksetzen.');
      io.emit('state', finishAndResetGame());
    });

    socket.on('disconnect', () => {
      const playerId = socketPlayerMap.get(socket.id);
      socketPlayerMap.delete(socket.id);
      if (playerId) {
        io.emit('state', setPlayerOnline(playerId, false));
      }
    });
  });
}
