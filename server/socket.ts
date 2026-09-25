import type { Server, Socket } from 'socket.io';
import type {
  BingoGame,
  ClientToServerEvents,
  ServerToClientEvents,
  ServerMessageParams,
  ServerMessagePayload,
  User,
} from '../shared/types.js';
import { AppError, messagePayload } from './errors.js';

/** Per-socket server-side data, filled by the connection middleware. */
export interface SocketData {
  user: User;
}

export type TypedIoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

let ioServer: TypedIoServer | null = null;

/** The live Socket.io server instance, or null before `setupSocket` ran. */
export function getIoServer(): TypedIoServer | null {
  return ioServer;
}

type BingoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Emit a stable, localizable product error while retaining its text fallback. */
function emitSocketError(
  socket: BingoSocket,
  message: string,
  messageKey: string,
  params?: ServerMessageParams
): void {
  socket.emit('error', messagePayload({ message, messageKey, errorCode: messageKey, params }));
}

function emitSocketException(socket: BingoSocket, error: unknown): void {
  if (error instanceof AppError) {
    socket.emit('error', messagePayload(error));
    return;
  }
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  const known = messagePayload(message);
  socket.emit(
    'error',
    known.errorCode
      ? known
      : messagePayload({
          message,
          messageKey: 'errors.internal',
          errorCode: 'errors.internal',
        })
  );
}

function connectError(error: ServerMessagePayload): Error {
  const result = new Error(error.message) as Error & { data?: ServerMessagePayload };
  result.data = error;
  return result;
}
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
  broadcastWhiteboardZoneChange,
  createElement,
  removeElement,
  updateElement,
} from './whiteboard.js';
import { getElement, listElementsForUser } from './repositories/whiteboard.js';

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

export function broadcastGameState(io: TypedIoServer): void {
  for (const socket of io.sockets.sockets.values()) {
    const socketUser = socket.data?.user;
    if (!socketUser) continue;
    socket.emit('state', getGameForUser(socketUser));
  }
}

export function setupSocket(io: TypedIoServer) {
  ioServer = io;
  const socketPlayerMap = new Map<string, string>();

  function broadcastState() {
    broadcastGameState(io);
  }

  io.use((socket, next) => {
    const authToken =
      typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
    const user = getAuthenticatedUser(socket.handshake as any, authToken ? [authToken] : []);
    if (!user) {
      return next(
        connectError(
          messagePayload({
            message: 'Unauthorized',
            messageKey: 'errors.unauthorized',
            errorCode: 'errors.unauthorized',
          })
        )
      );
    }
    if (!user.isApproved) {
      return next(
        connectError(
          messagePayload({
            message: 'Forbidden: Account not approved',
            messageKey: 'errors.accountNotApproved',
            errorCode: 'errors.accountNotApproved',
          })
        )
      );
    }
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.emit('state', getGameForUser(user));
    socket.emit('wbElements', listElementsForUser(user));

    socket.on('join', () => {
      const displayName = user?.displayName;
      if (!displayName) return emitSocketError(socket, 'Name fehlt.', 'errors.bingo.nameMissing');

      // Only players and dungeon masters actively play bingo; guests spectate
      // and keep receiving state broadcasts without a player entry.
      if (!canParticipate(user.role)) {
        return emitSocketError(
          socket,
          'Nur Spieler und Dungeon Master können am Bingo teilnehmen.',
          'errors.bingo.participantOnly'
        );
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
      if (!text?.trim()) return emitSocketError(socket, 'Text fehlt.', 'errors.bingo.textMissing');
      if (isPrivate && assignedTo.length === 0)
        return emitSocketError(
          socket,
          'Private Aufgaben müssen mindestens einer Person zugewiesen werden.',
          'errors.bingo.privateAssignment'
        );
      if (audience === 'dm' && !canManageDmTasks(user.role, user.isAdmin))
        return emitSocketError(
          socket,
          'Nur Dungeon Master können DM-Aufgaben hinzufügen.',
          'errors.bingo.dmAddDenied'
        );
      try {
        addTask(text, { isPrivate, assignedTo, audience });
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('removeTask', (taskId) => {
      const task = getGame().tasks.find((t) => t.id === taskId);
      if (task?.audience === 'dm' && !canManageDmTasks(user.role, user.isAdmin))
        return emitSocketError(
          socket,
          'Nur Dungeon Master können DM-Aufgaben entfernen.',
          'errors.bingo.dmRemoveDenied'
        );
      try {
        removeTask(taskId);
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('updateTask', ({ taskId, text, isPrivate, assignedTo, audience }) => {
      const task = getGame().tasks.find((t) => t.id === taskId);
      const nextAudience = normalizeAudience(audience);
      const involvesDmPool = task?.audience === 'dm' || nextAudience === 'dm';
      if (involvesDmPool && !canManageDmTasks(user.role, user.isAdmin))
        return emitSocketError(
          socket,
          'Nur Dungeon Master können DM-Aufgaben bearbeiten.',
          'errors.bingo.dmEditDenied'
        );
      try {
        updateTask(taskId, { text, isPrivate, assignedTo, audience: nextAudience });
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('setGridSize', (gridSize) => {
      if (!user?.isAdmin)
        return emitSocketError(
          socket,
          'Nur Admins können die Feldgröße ändern.',
          'errors.bingo.gridSizeDenied'
        );
      try {
        setGridSize(gridSize);
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('startGame', () => {
      if (!user?.isAdmin)
        return emitSocketError(
          socket,
          'Nur Admins können das Spiel starten.',
          'errors.bingo.startDenied'
        );
      try {
        startGame();
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('updateBoard', (board) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return emitSocketError(socket, 'Nicht beigetreten.', 'errors.bingo.notJoined');
      try {
        updateBoard(playerId, board);
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('lockBoard', () => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return emitSocketError(socket, 'Nicht beigetreten.', 'errors.bingo.notJoined');
      try {
        lockBoard(playerId);
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('unlockBoard', () => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return emitSocketError(socket, 'Nicht beigetreten.', 'errors.bingo.notJoined');
      try {
        unlockBoard(playerId);
        broadcastState();
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('confirmTask', (taskId) => {
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return emitSocketError(socket, 'Nicht beigetreten.', 'errors.bingo.notJoined');
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
      if (!playerId) return emitSocketError(socket, 'Nicht beigetreten.', 'errors.bingo.notJoined');
      unconfirmTask(taskId);
      broadcastState();
    });

    // Dungeon masters mark dm-pool moments on their own board only.
    socket.on('confirmOwnTask', (taskId) => {
      if (!canManageDmTasks(user.role, user.isAdmin))
        return emitSocketError(
          socket,
          'Nur Dungeon Master können DM-Aufgaben bestätigen.',
          'errors.bingo.dmConfirmDenied'
        );
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return emitSocketError(socket, 'Nicht beigetreten.', 'errors.bingo.notJoined');
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
        return emitSocketError(
          socket,
          'Nur Dungeon Master können DM-Aufgaben zurücknehmen.',
          'errors.bingo.dmUnconfirmDenied'
        );
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return emitSocketError(socket, 'Nicht beigetreten.', 'errors.bingo.notJoined');
      unconfirmOwnTask(playerId, taskId);
      broadcastState();
    });

    socket.on('resetGame', () => {
      if (!user?.isAdmin)
        return emitSocketError(
          socket,
          'Nur Admins können das Spiel zurücksetzen.',
          'errors.bingo.resetDenied'
        );
      finishAndResetGame();
      broadcastState();
    });

    socket.on('wbCreate', (element) => {
      try {
        const created = createElement(element, user);
        broadcastWhiteboardUpsert(io, created);
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('wbUpdate', ({ id, patch }) => {
      try {
        const before = getElement(id);
        if (!before)
          return emitSocketError(
            socket,
            'Element nicht gefunden.',
            'errors.whiteboard.elementNotFound'
          );
        const updated = updateElement(id, patch, user);
        if (before.zone === updated.zone) broadcastWhiteboardUpsert(io, updated);
        else broadcastWhiteboardZoneChange(io, before, updated);
      } catch (e: any) {
        emitSocketException(socket, e);
      }
    });

    socket.on('wbRemove', (id) => {
      try {
        removeElement(id, user);
        broadcastWhiteboardRemoved(io, id);
      } catch (e: any) {
        emitSocketException(socket, e);
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
