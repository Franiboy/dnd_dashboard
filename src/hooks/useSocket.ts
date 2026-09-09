import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useError } from './useError';
import type {
  BingoGame,
  ClientToServerEvents,
  ServerToClientEvents,
  SafeUser,
} from '../../shared/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

export function useSocket(user: SafeUser | null) {
  const { showError } = useError();
  // Held in state (not a ref) so callers see the socket on the render where
  // it connects instead of a stale/null ref value.
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(
    null
  );
  const [game, setGame] = useState<BingoGame | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [bingo, setBingo] = useState<string | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!user) return;

    const socket = io(SERVER_URL || undefined, {
      withCredentials: true,
      reconnection: true,
    });

    setSocket(socket);

    socket.on('connect', () => {
      if (user && !joinedRef.current) {
        joinedRef.current = true;
        socket.emit('join');
      }
    });

    socket.on('disconnect', () => {
      joinedRef.current = false;
    });

    socket.on('state', (g) => setGame(g));
    socket.on('error', (msg) => {
      showError(msg);
    });
    socket.on('joined', (id) => {
      setPlayerId(id);
      joinedRef.current = true;
    });
    socket.on('bingo', (name) => {
      setBingo(name);
      setTimeout(() => setBingo(null), 4000);
    });

    return () => {
      joinedRef.current = false;
      setSocket(null);
      socket.disconnect();
    };
  }, [user, showError]);

  return {
    socket,
    game,
    playerId,
    bingo,
  };
}
