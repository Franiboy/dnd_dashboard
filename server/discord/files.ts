import { unlink } from 'node:fs/promises';
import { getFilesBySessionId, updateFile } from '../repositories/recordings.js';

export async function deleteSessionAudioFiles(sessionId: number): Promise<number> {
  const files = getFilesBySessionId(sessionId);
  let deleted = 0;

  for (const file of files) {
    if (file.wavPath) {
      try {
        await unlink(file.wavPath);
        deleted++;
      } catch (err) {
        console.warn(`Failed to delete audio file ${file.wavPath}:`, err);
      }
      updateFile(file.id, { wavPath: null });
    }
  }

  return deleted;
}
