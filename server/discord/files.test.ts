import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createFile,
  createSession,
  deleteSession,
  getFilesBySessionId,
  updateFile,
} from '../repositories/recordings.js';
import { deleteSessionAudioFiles } from './files.js';

const tempDirs: string[] = [];
const createdSessionIds: number[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dnd-files-test-'));
  tempDirs.push(dir);
  return dir;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function createTestFile(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, 'audio');
}

afterAll(async () => {
  for (const id of createdSessionIds) {
    deleteSession(id);
  }
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('deleteSessionAudioFiles', () => {
  it('deletes tracked WAVs and untracked normalized copies', async () => {
    const dir = await makeTempDir();
    const session = createSession({
      name: 'cleanup-test',
      guildId: 'guild',
      channelId: 'channel',
      createdBy: 'tester',
      directory: dir,
    });
    createdSessionIds.push(session.id);

    // File with a tracked WAV plus its normalized transcription copy.
    const tracked = createFile({
      sessionId: session.id,
      userId: 'user-a',
      displayName: 'User A',
      pcmPath: join(dir, 'user-a.pcm'),
    });
    updateFile(tracked.id, { wavPath: join(dir, 'user-a.wav'), duration: 10 });

    // File whose WAV was cleaned up earlier but whose normalized copy remains.
    const alreadyCleaned = createFile({
      sessionId: session.id,
      userId: 'user-b',
      displayName: 'User B',
      pcmPath: join(dir, 'user-b.pcm'),
    });

    await createTestFile(join(dir, 'user-a.wav'));
    await createTestFile(join(dir, 'user-a_norm.wav'));
    await createTestFile(join(dir, 'user-b_norm.wav'));

    const deleted = await deleteSessionAudioFiles(session.id);

    expect(deleted).toBe(3);
    expect(await fileExists(join(dir, 'user-a.wav'))).toBe(false);
    expect(await fileExists(join(dir, 'user-a_norm.wav'))).toBe(false);
    expect(await fileExists(join(dir, 'user-b_norm.wav'))).toBe(false);

    const files = getFilesBySessionId(session.id);
    expect(files.find((f) => f.id === tracked.id)?.wavPath).toBeNull();
    expect(files.find((f) => f.id === alreadyCleaned.id)?.wavPath).toBeNull();
  });

  it('clears missing WAV paths and counts nothing when files are gone', async () => {
    const dir = await makeTempDir();
    const session = createSession({
      name: 'cleanup-test-missing',
      guildId: 'guild',
      channelId: 'channel',
      createdBy: 'tester',
      directory: dir,
    });
    createdSessionIds.push(session.id);

    const file = createFile({
      sessionId: session.id,
      userId: 'user-c',
      displayName: 'User C',
      pcmPath: join(dir, 'user-c.pcm'),
    });
    updateFile(file.id, { wavPath: join(dir, 'user-c.wav'), duration: 5 });

    const deleted = await deleteSessionAudioFiles(session.id);

    expect(deleted).toBe(0);
    expect(getFilesBySessionId(session.id).find((f) => f.id === file.id)?.wavPath).toBeNull();
  });

  it('does not delete a PCM path with an unexpected extension', async () => {
    const dir = await makeTempDir();
    const session = createSession({
      name: 'cleanup-test-extension',
      guildId: 'guild',
      channelId: 'channel',
      createdBy: 'tester',
      directory: dir,
    });
    createdSessionIds.push(session.id);

    const pcmPath = join(dir, 'user-d.pcm.partial');
    createFile({
      sessionId: session.id,
      userId: 'user-d',
      displayName: 'User D',
      pcmPath,
    });
    await createTestFile(pcmPath);

    await deleteSessionAudioFiles(session.id);

    expect(await fileExists(pcmPath)).toBe(true);
  });
});
