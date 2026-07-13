import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { BingoGame, ClientToServerEvents, ServerToClientEvents, SafeUser } from '../../shared/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export function useSocket(token: string | null, user: SafeUser | null) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [game, setGame] = useState<BingoGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [bingo, setBingo] = useState<string | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!token) return;

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

export function useAuth() {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('dnd_token'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('dnd_token', data.token);
        setError(null);
        return true;
      }
      setError(data.error || 'Login fehlgeschlagen');
      return false;
    } catch {
      setError('Server nicht erreichbar');
      return false;
    }
  };

  const register = async (username: string, displayName: string, password: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, password }),
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        return data.message || 'Registrierung erfolgreich';
      }
      setError(data.error || 'Registrierung fehlgeschlagen');
      return null;
    } catch {
      setError('Server nicht erreichbar');
      return null;
    }
  };

  const updateDisplayName = async (displayName: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName }),
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data.user);
        return true;
      }
      setError(data.error || 'Aktualisierung fehlgeschlagen');
      return false;
    } catch {
      setError('Server nicht erreichbar');
      return false;
    }
  };

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setToken(null);
    localStorage.removeItem('dnd_token');
  };

  const fetchMe = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('dnd_token');
        setToken(null);
      }
    } catch {
      setToken(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMe();
  }, [token]);

  return { user, token, loading, error, login, register, updateDisplayName, logout, setError };
}
