import { EventEmitter } from 'node:events';

const featureRequestEmitter = new EventEmitter();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function onFeatureRequestsUpdated(callback: () => void): () => void {
  featureRequestEmitter.on('update', callback);
  return () => featureRequestEmitter.off('update', callback);
}

export function notifyFeatureRequestsUpdated(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    featureRequestEmitter.emit('update');
  }, 500);
}
