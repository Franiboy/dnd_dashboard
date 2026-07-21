import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('diaryFiles');

const BASE_DIR = resolve(process.cwd(), 'data', 'diary');

function getEntryDir(entryId: number): string {
  return join(BASE_DIR, String(entryId));
}

export function getRewrittenFilePath(entryId: number): string {
  return join(getEntryDir(entryId), 'rewritten.html');
}

export function ensureDiaryEntryDir(entryId: number): void {
  const dir = getEntryDir(entryId);
  mkdirSync(dir, { recursive: true });
  log.info(`Ensured diary directory: ${dir}`);
}

export function readRewrittenFile(entryId: number): string | null {
  const path = getRewrittenFilePath(entryId);
  try {
    const content = readFileSync(path, 'utf-8');
    log.info(`Read rewritten file: ${path} (${content.length} bytes)`);
    return content.trim() || null;
  } catch (err) {
    log.warn(`Failed to read rewritten file: ${path}`, err);
    return null;
  }
}

export function writeRewrittenFile(entryId: number, content: string): void {
  const path = getRewrittenFilePath(entryId);
  ensureDiaryEntryDir(entryId);
  writeFileSync(path, content, 'utf-8');
  log.info(`Wrote rewritten file: ${path} (${content.length} bytes)`);
}

export function deleteRewrittenFile(entryId: number): void {
  const path = getRewrittenFilePath(entryId);
  try {
    unlinkSync(path);
    log.info(`Deleted rewritten file: ${path}`);
  } catch (err) {
    log.warn(`Failed to delete rewritten file: ${path}`, err);
  }
}
