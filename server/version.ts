import { isAiEnabled } from './ai/config.js';
import { isRecordingFeatureEnabled } from './discord/config.js';
import { isDevAutoLoginEnabled } from './env.js';

export function getVersion() {
  return {
    aiEnabled: isAiEnabled(),
    recordingEnabled: isRecordingFeatureEnabled(),
    devAutoLogin: isDevAutoLoginEnabled(),
  };
}
