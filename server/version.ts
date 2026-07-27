import { isAiEnabled } from './ai/config.js';
import { isRecordingFeatureEnabled } from './discord/config.js';

export function getVersion() {
  return {
    aiEnabled: isAiEnabled(),
    recordingEnabled: isRecordingFeatureEnabled(),
  };
}
