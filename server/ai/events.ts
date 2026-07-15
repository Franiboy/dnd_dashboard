import { EventEmitter } from 'node:events';

const featureRequestEmitter = new EventEmitter();

export function onFeatureRequestsUpdated(callback: () => void): () => void {
  featureRequestEmitter.on('update', callback);
  return () => featureRequestEmitter.off('update', callback);
}

export function notifyFeatureRequestsUpdated(): void {
  featureRequestEmitter.emit('update');
}
