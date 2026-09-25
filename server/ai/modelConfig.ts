import { execFileSync } from 'node:child_process';
import { getAiSettings } from '../repositories/aiSettings.js';
import { createLogger } from '../logger.js';

const log = createLogger('model-config');

const DEFAULT_MODEL = 'opencode/deepseek-v4-flash-free';

export function isValidModel(value: string | undefined | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Heuristic for placeholder values like provider/GLM5.2
  if (trimmed.toLowerCase().startsWith('provider/')) return false;
  return true;
}

function getOpenCodeBin(): string {
  return process.env.AI_OPENCODE_BIN || 'opencode';
}

export function getModel(): string {
  const settings = getAiSettings();
  if (isValidModel(settings.model)) return settings.model!.trim();
  if (isValidModel(process.env.AI_MODEL)) return process.env.AI_MODEL.trim();
  return DEFAULT_MODEL;
}

let cachedModels: string[] | null = null;
let cachedModelsAt = 0;
const MODEL_LIST_CACHE_MS = 60 * 60 * 1000;

export async function listAvailableModels(forceRefresh = false): Promise<string[]> {
  if (!forceRefresh && cachedModels && Date.now() - cachedModelsAt < MODEL_LIST_CACHE_MS) {
    return cachedModels;
  }

  const bin = getOpenCodeBin();
  try {
    const output = execFileSync(bin, ['models'], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const models = output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.toLowerCase().startsWith('opencode '));
    cachedModels = models;
    cachedModelsAt = Date.now();
    return models;
  } catch (err) {
    log.warn(`Failed to list opencode models using ${bin}:`, err);
    return cachedModels ?? [];
  }
}

export function clearModelCache(): void {
  cachedModels = null;
  cachedModelsAt = 0;
}
