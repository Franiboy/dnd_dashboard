import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();

export function onSessionsUpdated(callback: () => void): () => void {
  emitter.on('sessions', callback);
  return () => emitter.off('sessions', callback);
}

export function onStatusUpdated(callback: () => void): () => void {
  emitter.on('status', callback);
  return () => emitter.off('status', callback);
}

export function emitSessionsUpdated(): void {
  emitter.emit('sessions');
}

export function emitStatusUpdated(): void {
  emitter.emit('status');
}
