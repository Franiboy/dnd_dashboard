import { EventEmitter } from 'node:events';
import type { TranscriptionProgress } from '../../shared/types.js';

const emitter = new EventEmitter();

export function onSessionsUpdated(callback: () => void): () => void {
  emitter.on('sessions', callback);
  return () => emitter.off('sessions', callback);
}

export function onStatusUpdated(callback: () => void): () => void {
  emitter.on('status', callback);
  return () => emitter.off('status', callback);
}

export function onProgressUpdated(
  callback: (sessionId: number, progress: TranscriptionProgress | null) => void
): () => void {
  const handler = (_sessionId: number, _progress: TranscriptionProgress | null) =>
    callback(_sessionId, _progress);
  emitter.on('progress', handler);
  return () => emitter.off('progress', handler);
}

export function emitSessionsUpdated(): void {
  emitter.emit('sessions');
}

export function emitStatusUpdated(): void {
  emitter.emit('status');
}

export function emitProgressUpdated(
  sessionId: number,
  progress: TranscriptionProgress | null
): void {
  emitter.emit('progress', sessionId, progress);
}
