import { unlink } from 'node:fs/promises';
import { getFilesBySessionId, updateFile } from '../repositories/recordings.js';
import { emitSessionsUpdated } from './recordingsEvents.js';
import { createLogger } from '../logger.js';

const log = createLogger('discord-files');

export async function deleteSessionAudioFiles(sessionId: number): Promise<number> {
  const files = getFilesBySessionId(sessionId);
  let deleted = 0;

  for (const file of files) {
    if (file.wavPath) {
      try {
        await unlink(file.wavPath);
        deleted++;
      } catch (err) {
        log.warn(`Failed to delete audio file ${file.wavPath}:`, err);
      }
      updateFile(file.id, { wavPath: null });
    }
  }

  emitSessionsUpdated();
  return deleted;
}
