import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { BingoGame, ClientToServerEvents, ServerToClientEvents, SafeUser } from '../../shared/types';

export { useAuth } from './useAuth';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export function useSocket(token: string | null, user: SafeUser | null) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [game, setGame] = useState<BingoGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [bingo, setBingo] = useState<string | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!token || !user) return;

    const socket = io(SERVER_URL, {
      auth: { token },
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      if (user && !joinedRef.current) {
        joinedRef.current = true;
        socket.emit('join');
      }
    });

    socket.on('state', (g) => setGame(g));
    socket.on('error', (msg) => setError(msg));
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
      socket.disconnect();
    };
  }, [token, user?.id]);

  return {
    socket: socketRef.current,
    game,
    error,
    playerId,
    bingo,
    setError,
  };
}
