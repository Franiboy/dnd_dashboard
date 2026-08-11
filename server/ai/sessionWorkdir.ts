import { join } from 'node:path';

const BASE_DIR = join(process.cwd(), 'data', 'sessions');

export function getSessionWorkDir(sessionId: number): string {
  return join(BASE_DIR, String(sessionId));
}

export function getSessionWorkFile(sessionId: number): string {
  return join(getSessionWorkDir(sessionId), 'transcript.txt');
}
