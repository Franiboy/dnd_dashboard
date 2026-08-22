import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useError } from './useError';
import type {
  ClientToServerEvents,
  SafeUser,
  ServerToClientEvents,
  WhiteboardElement,
  WhiteboardPatch,
} from '../../shared/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

type WhiteboardSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function upsertInto(list: WhiteboardElement[], element: WhiteboardElement): WhiteboardElement[] {
  const index = list.findIndex((e) => e.id === element.id);
  if (index === -1) return [...list, element];
  const next = [...list];
  next[index] = element;
  return next;
}

export function useWhiteboard(user: SafeUser | null) {
  const { showError } = useError();
  const socketRef = useRef<WhiteboardSocket | null>(null);
  const [elements, setElements] = useState<WhiteboardElement[]>([]);
  const [connected, setConnected] = useState(false);

  // Ids of elements currently being dragged/resized/edited locally.
  // Authoritative broadcasts for these are skipped so live gestures never
  // snap back mid-interaction; the final update emit reconciles afterwards.
  const localEditIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    const socket: WhiteboardSocket = io(SERVER_URL || undefined, {
      withCredentials: true,
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('wbElements', setElements);
    socket.on('wbUpsert', (element) => {
      if (localEditIdsRef.current.has(element.id)) return;
      setElements((prev) => upsertInto(prev, element));
    });
    socket.on('wbRemoved', (id) => {
      localEditIdsRef.current.delete(id);
      setElements((prev) => prev.filter((e) => e.id !== id));
    });
    socket.on('error', (message) => showError(message));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user, showError]);

  const upsertLocal = useCallback((element: WhiteboardElement) => {
    setElements((prev) => upsertInto(prev, element));
  }, []);

  const applyPatchLocal = useCallback((id: string, patch: WhiteboardPatch) => {
    setElements((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: e.updatedAt } : e))
    );
  }, []);

  const createElement = useCallback(
    (element: WhiteboardElement) => {
      upsertLocal(element);
      socketRef.current?.emit('wbCreate', element);
    },
    [upsertLocal]
  );

  const updateElement = useCallback((id: string, patch: WhiteboardPatch) => {
    setElements((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: e.updatedAt } : e))
    );
    socketRef.current?.emit('wbUpdate', { id, patch });
  }, []);

  const removeElement = useCallback((id: string) => {
    setElements((prev) => prev.filter((e) => e.id !== id));
    socketRef.current?.emit('wbRemove', id);
  }, []);

  const beginLocalEdit = useCallback((id: string) => {
    localEditIdsRef.current.add(id);
  }, []);

  const endLocalEdit = useCallback((id: string) => {
    localEditIdsRef.current.delete(id);
  }, []);

  return {
    elements,
    connected,
    createElement,
    applyPatchLocal,
    updateElement,
    removeElement,
    beginLocalEdit,
    endLocalEdit,
    upsertLocal,
  };
}
