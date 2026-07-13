import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { BingoGame, ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export function useSocket(password: string | null) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [game, setGame] = useState<BingoGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [bingo, setBingo] = useState<string | null>(null);

  useEffect(() => {
    if (!password) return;

    const socket = io(SERVER_URL, {
      auth: { password },
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on('state', (g) => setGame(g));
    socket.on('error', (msg) => setError(msg));
    socket.on('joined', (id) => setPlayerId(id));
    socket.on('bingo', (name) => {
      setBingo(name);
      setTimeout(() => setBingo(null), 4000);
    });

    return () => {
      socket.disconnect();
    };
  }, [password]);

  return {
    socket: socketRef.current,
    game,
    error,
    playerId,
    bingo,
    setError,
  };
}
