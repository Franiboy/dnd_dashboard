import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { BingoGame, ClientToServerEvents, ServerToClientEvents, SafeUser } from '../../shared/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

export function useSocket(token: string | null, user: SafeUser | null, onError?: (msg: string) => void) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [game, setGame] = useState<BingoGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [bingo, setBingo] = useState<string | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!token || !user) return;

    const socket = io(SERVER_URL || undefined, {
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

    socket.on('disconnect', () => {
      joinedRef.current = false;
    });

    socket.on('state', (g) => setGame(g));
    socket.on('error', (msg) => {
      setError(msg);
      onError?.(msg);
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
      socket.disconnect();
    };
  }, [token, user?.id, onError]);

  return {
    socket: socketRef.current,
    game,
    error,
    playerId,
    bingo,
    setError,
  };
}
