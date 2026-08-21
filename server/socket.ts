import type { Server } from 'socket.io';
import type {
  BingoGame,
  ClientToServerEvents,
  ServerToClientEvents,
  User,
} from '../shared/types.js';
import { getAuthenticatedUser } from './auth.js';
import {
  addTask,
  canParticipate,
  canManageDmTasks,
  confirmOwnTask,
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
  syncPlayersFromUsers,
  unconfirmOwnTask,
  unconfirmTask,
  unlockBoard,
  updateBoard,
  updateTask,
} from './game.js';
import type { TaskAudience } from '../shared/types.js';
import {
  broadcastWhiteboardRemoved,
  broadcastWhiteboardUpsert,
  createElement,
  listElementsForUser,
  removeElement,
  updateElement,
} from './whiteboard.js';

export function getGameForUser(user: User): BingoGame {
  const current = getGame();
  if (user.isAdmin) return current;
  const seesDmPool = user.role === 'dungeon_master';
  return {
    ...current,
    tasks: current.tasks.filter(
      (t) =>
        (t.audience !== 'dm' || seesDmPool) && (!t.isPrivate || t.assignedTo?.includes(user.id))
    ),
  };
}

function normalizeAudience(audience: unknown): TaskAudience | undefined {
  if (audience === undefined || audience === null || audience === '') return undefined;
  return audience === 'dm' ? 'dm' : 'players';
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
    const authToken =
      typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
    const user = getAuthenticatedUser(socket.handshake as any, authToken ? [authToken] : []);
    if (!user || !user.isApproved) return next(new Error('Unauthorized'));
    (socket as any).user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user as User;
    socket.emit('state', getGameForUser(user));
    socket.emit('wbElements', listElementsForUser(user));

    socket.on('join', () => {
      const displayName = user?.displayName;
      if (!displayName) return socket.emit('error', 'Name fehlt.');

      // Only players and dungeon masters actively play bingo; guests spectate
      // and keep receiving state broadcasts without a player entry.
      if (!canParticipate(user.role)) {
        return socket.emit('error', 'Nur Spieler und Dungeon Master können am Bingo teilnehmen.');
      }

      // Make sure role-based participants exist before matching.
      syncPlayersFromUsers();
      const currentGame = getGame();
      const existing =
        currentGame.players.find((p) => p.userId && p.userId === user.id) ??
        currentGame.players.find((p) => p.name === displayName);
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

      const { playerId } = joinPlayer(displayName, user.id, user.avatarUrl, user.role);
      socketPlayerMap.set(socket.id, playerId);
      socket.emit('joined', playerId);
      broadcastState();
    });

    socket.on('addTask', (payload) => {
      const raw = payload as any;
      const text = typeof raw === 'string' ? raw : raw?.text;
      const isPrivate = typeof raw === 'string' ? false : !!raw?.isPrivate;
      const assignedTo = Array.isArray(raw?.assignedTo) ? raw.assignedTo : [];
      const audience = normalizeAudience(raw?.audience);
      if (!text?.trim()) return socket.emit('error', 'Text fehlt.');
      if (isPrivate && assignedTo.length === 0)
        return socket.emit(
          'error',
          'Private Aufgaben müssen mindestens einer Person zugewiesen werden.'
        );
      if (audience === 'dm' && !canManageDmTasks(user.role, user.isAdmin))
        return socket.emit('error', 'Nur Dungeon Master können DM-Aufgaben hinzufügen.');
      try {
        addTask(text, { isPrivate, assignedTo, audience });
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('removeTask', (taskId) => {
      const task = getGame().tasks.find((t) => t.id === taskId);
      if (task?.audience === 'dm' && !canManageDmTasks(user.role, user.isAdmin))
        return socket.emit('error', 'Nur Dungeon Master können DM-Aufgaben entfernen.');
      try {
        removeTask(taskId);
        broadcastState();
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('updateTask', ({ taskId, text, isPrivate, assignedTo, audience }) => {
      const task = getGame().tasks.find((t) => t.id === taskId);
      const nextAudience = normalizeAudience(audience);
      const involvesDmPool = task?.audience === 'dm' || nextAudience === 'dm';
      if (involvesDmPool && !canManageDmTasks(user.role, user.isAdmin))
        return socket.emit('error', 'Nur Dungeon Master können DM-Aufgaben bearbeiten.');
      try {
        updateTask(taskId, { text, isPrivate, assignedTo, audience: nextAudience });
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
      const beforeBingo = new Set(
        getGame()
          .players.filter((p) => p.status === 'bingo')
          .map((p) => p.id)
      );
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
      const beforeBingo = new Set(
        current.players.filter((p) => p.status === 'bingo').map((p) => p.id)
      );
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

    // Dungeon masters mark dm-pool moments on their own board only.
    socket.on('confirmOwnTask', (taskId) => {
      if (!canManageDmTasks(user.role, user.isAdmin))
        return socket.emit('error', 'Nur Dungeon Master können DM-Aufgaben bestätigen.');
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      const beforeBingo = new Set(
        getGame()
          .players.filter((p) => p.status === 'bingo')
          .map((p) => p.id)
      );
      confirmOwnTask(playerId, taskId);
      getGame().players.forEach((p) => {
        if (p.status === 'bingo' && !beforeBingo.has(p.id)) {
          io.emit('bingo', p.name);
        }
      });
      broadcastState();
    });

    socket.on('unconfirmOwnTask', (taskId) => {
      if (!canManageDmTasks(user.role, user.isAdmin))
        return socket.emit('error', 'Nur Dungeon Master können DM-Aufgaben zurücknehmen.');
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return socket.emit('error', 'Nicht beigetreten.');
      unconfirmOwnTask(playerId, taskId);
      broadcastState();
    });

    socket.on('resetGame', () => {
      if (!user?.isAdmin) return socket.emit('error', 'Nur Admins können das Spiel zurücksetzen.');
      finishAndResetGame();
      broadcastState();
    });

    socket.on('wbCreate', (element) => {
      try {
        const created = createElement(element, user);
        broadcastWhiteboardUpsert(io, created);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('wbUpdate', ({ id, patch }) => {
      try {
        const updated = updateElement(id, patch, user);
        broadcastWhiteboardUpsert(io, updated);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
    });

    socket.on('wbRemove', (id) => {
      try {
        removeElement(id, user);
        broadcastWhiteboardRemoved(io, id);
      } catch (e: any) {
        socket.emit('error', e.message);
      }
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
