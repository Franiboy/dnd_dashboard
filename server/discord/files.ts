import { unlink } from 'node:fs/promises';
import { getFilesBySessionId, updateFile } from '../repositories/recordings.js';
import { emitSessionsUpdated } from './recordingsEvents.js';
import { createLogger } from '../logger.js';

const log = createLogger('discord-files');

function isEnoentError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

// transcribe.py preprocess_audio() writes an untracked normalized copy
// "<name>_norm.wav" next to every WAV it transcribes. The recording WAV is
// always derived from the PCM path, so deriving from pcmPath also finds
// normalized copies of files whose wav_path was already cleaned up.
function getNormalizedWavPaths(file: { wavPath: string | null; pcmPath: string }): string[] {
  const paths = new Set<string>();
  if (file.wavPath) {
    paths.add(file.wavPath.replace(/\.wav$/, '_norm.wav'));
  }
  if (/\.pcm$/.test(file.pcmPath)) {
    paths.add(file.pcmPath.replace(/\.pcm$/, '_norm.wav'));
  }
  return [...paths];
}

export interface DeleteSessionAudioOptions {
  /**
   * Set to false when a batch (e.g. the retention cleanup) deletes several
   * sessions and emits a single update afterwards instead.
   */
  notify?: boolean;
}

export async function deleteSessionAudioFiles(
  sessionId: number,
  options: DeleteSessionAudioOptions = {}
): Promise<number> {
  const { notify = true } = options;
  const files = getFilesBySessionId(sessionId);
  let deleted = 0;

  for (const file of files) {
    if (file.wavPath) {
      try {
        await unlink(file.wavPath);
        deleted++;
        updateFile(file.id, { wavPath: null });
      } catch (err) {
        log.warn(`Failed to delete audio file ${file.wavPath}:`, err);
        if (isEnoentError(err)) {
          updateFile(file.id, { wavPath: null });
        }
      }
    }

    for (const normPath of getNormalizedWavPaths(file)) {
      try {
        await unlink(normPath);
        deleted++;
      } catch (err) {
        if (!isEnoentError(err)) {
          log.warn(`Failed to delete normalized audio file ${normPath}:`, err);
        }
      }
    }
  }

  if (notify) {
    emitSessionsUpdated();
  }
  return deleted;
}
