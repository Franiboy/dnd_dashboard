import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAiEnabled } from './ai/config.js';
import { isRecordingFeatureEnabled } from './discord/config.js';
import { isDevAutoLoginEnabled } from './env.js';

function getReleaseSha(): string | null {
  const fromEnvironment = process.env.DND_RELEASE_SHA?.trim();
  if (fromEnvironment) return fromEnvironment;

  const marker = join(process.cwd(), '.release-sha');
  if (!existsSync(marker)) return null;
  return readFileSync(marker, 'utf8').trim() || null;
}

export function getVersion() {
  return {
    aiEnabled: isAiEnabled(),
    recordingEnabled: isRecordingFeatureEnabled(),
    devAutoLogin: isDevAutoLoginEnabled(),
    releaseSha: getReleaseSha(),
  };
}
