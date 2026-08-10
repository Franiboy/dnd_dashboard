import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './logger.js';
import { getSessionById } from './repositories/recordings.js';

const log = createLogger('sessionFiles');

function getImprovedTranscriptPath(sessionId: number): string | null {
  const session = getSessionById(sessionId);
  if (!session) return null;
  return join(session.directory, 'transcript.improved.txt');
}

export function readImprovedTranscript(sessionId: number): string | null {
  const path = getImprovedTranscriptPath(sessionId);
  if (!path) return null;
  try {
    const content = readFileSync(path, 'utf-8');
    return content.trim() || null;
  } catch (err) {
    log.warn(`Failed to read improved transcript: ${path}`, err);
    return null;
  }
}

export function writeImprovedTranscript(sessionId: number, content: string): boolean {
  const path = getImprovedTranscriptPath(sessionId);
  if (!path) return false;
  try {
    writeFileSync(path, content, 'utf-8');
    log.info(`Wrote improved transcript file: ${path} (${content.length} bytes)`);
    return true;
  } catch (err) {
    log.warn(`Failed to write improved transcript: ${path}`, err);
    return false;
  }
}

export function deleteImprovedTranscript(sessionId: number): void {
  const path = getImprovedTranscriptPath(sessionId);
  if (!path) return;
  try {
    unlinkSync(path);
  } catch {
    // Ignore missing file.
  }
}
