import { isValidModel } from './ai/config.js';

const DEFAULT_TARGET_POOL_SIZE = 20;
const DEFAULT_REFILL_THRESHOLD = 5;
const DEFAULT_GENERATION_BATCH_SIZE = 15;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : fallback;
}

export function getTargetPoolSize(): number {
  return parsePositiveInt(process.env.BINGO_SUGGESTION_TARGET, DEFAULT_TARGET_POOL_SIZE);
}

export function getRefillThreshold(): number {
  return parsePositiveInt(process.env.BINGO_SUGGESTION_THRESHOLD, DEFAULT_REFILL_THRESHOLD);
}

export function getGenerationBatchSize(): number {
  return parsePositiveInt(process.env.BINGO_SUGGESTION_BATCH, DEFAULT_GENERATION_BATCH_SIZE);
}

export function getBingoModel(): string {
  if (isValidModel(process.env.AI_CHEAP_MODEL)) {
    return process.env.AI_CHEAP_MODEL.trim();
  }
  // isAiEnabled() already validates that AI_MODEL is set before this is called.
  return process.env.AI_MODEL?.trim() || '';
}
