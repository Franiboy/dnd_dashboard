import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useError } from './useError';
import { useI18n } from './useI18n';
import { getServerMessagePayload, localizeServerMessage } from '../i18n/serverMessages';
import type {
  BingoGame,
  ClientToServerEvents,
  ServerToClientEvents,
  SafeUser,
} from '../../shared/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

function connectErrorPayload(error: Error) {
  return getServerMessagePayload((error as Error & { data?: unknown }).data) ?? error.message;
}

export function useSocket(user: SafeUser | null) {
  const { showError } = useError();
  const { t } = useI18n();
  // Held in state (not a ref) so callers see the socket on the render where
  // it connects instead of a stale/null ref value.
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(
    null
  );
  const [game, setGame] = useState<BingoGame | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [bingo, setBingo] = useState<string | null>(null);
  const joinedRef = useRef(false);
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!user) return;

    const socket = io(SERVER_URL || undefined, {
      withCredentials: true,
      reconnection: true,
    });

    // Publishing the created connection to state is the point of this effect
    // (the socket is external state React must re-render for).
    // oxlint-disable-next-line react/set-state-in-effect
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
    socket.on('error', (message) => {
      const payload = getServerMessagePayload(message);
      const localized = localizeServerMessage(payload ?? message, tRef.current, {
        fallback: typeof message === 'string' ? message : undefined,
      });
      if (localized) showError(localized);
    });
    socket.on('connect_error', (error: Error) => {
      const localized = localizeServerMessage(connectErrorPayload(error), tRef.current, {
        fallback: error.message,
      });
      if (localized) showError(localized);
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
