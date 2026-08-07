import { getNormalModel, isValidModel } from './modelConfig.js';

export { isValidModel } from './modelConfig.js';

export function isAiEnabled(): boolean {
  const provider = process.env.AI_PROVIDER;

  if (!provider || !isValidModel(getNormalModel())) {
    return false;
  }

  if (provider.trim() !== 'opencode') {
    return false;
  }

  return true;
}
