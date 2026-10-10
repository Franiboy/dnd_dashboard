import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AUDIO_RETENTION_WINDOW_MS } from '../../shared/retention.js';
import { db } from '../database.js';
import {
  createFile,
  createSession,
  deleteSession,
  getFilesBySessionId,
  updateFile,
  updateSession,
} from '../repositories/recordings.js';
import { cleanupExpiredSessionAudio } from './audioCleanup.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const tempDirs: string[] = [];
const createdSessionIds: number[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dnd-audio-cleanup-test-'));
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

async function createAudioFile(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, 'audio');
}

interface TestSessionOptions {
  name: string;
  ageMs: number;
  transcript?: string;
  status?: 'completed' | 'pending_transcription' | 'processing';
}

async function createSessionWithAudio({
  name,
  ageMs,
  transcript = '[00:00] Torvald: Welcome.',
  status = 'completed',
}: TestSessionOptions): Promise<{ sessionId: number; dir: string; wavPath: string }> {
  const dir = await makeTempDir();
  const session = createSession({
    name,
    guildId: 'guild',
    channelId: 'channel',
    createdBy: 'tester',
    directory: dir,
  });
  createdSessionIds.push(session.id);
  db.prepare('UPDATE recording_sessions SET started_at = ?, status = ? WHERE id = ?').run(
    new Date(Date.now() - ageMs).toISOString(),
    status,
    session.id
  );
  updateSession(session.id, { transcript, stoppedAt: new Date().toISOString() });

  const wavPath = join(dir, `user-${name}.wav`);
  const file = createFile({
    sessionId: session.id,
    userId: 'tester',
    displayName: 'Tester',
    pcmPath: join(dir, `user-${name}.pcm`),
  });
  updateFile(file.id, { wavPath, duration: 10 });
  await createAudioFile(wavPath);
  await createAudioFile(wavPath.replace(/\.wav$/, '_norm.wav'));
  return { sessionId: session.id, dir, wavPath };
}

afterAll(async () => {
  for (const id of createdSessionIds) {
    deleteSession(id);
  }
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('cleanupExpiredSessionAudio', () => {
  it('deletes the audio of expired sessions but keeps transcript and directory', async () => {
    const { sessionId, dir, wavPath } = await createSessionWithAudio({
      name: 'expired',
      ageMs: AUDIO_RETENTION_WINDOW_MS + DAY_MS,
    });
    const transcriptPath = join(dir, 'transcript.txt');
    await createAudioFile(transcriptPath);

    const result = await cleanupExpiredSessionAudio();

    expect(result.sessions).toBe(1);
    expect(result.deletedFiles).toBe(2);
    expect(await fileExists(wavPath)).toBe(false);
    expect(await fileExists(wavPath.replace(/\.wav$/, '_norm.wav'))).toBe(false);
    // Transcript file and session row survive the audio cleanup.
    expect(await fileExists(transcriptPath)).toBe(true);
    const files = getFilesBySessionId(sessionId);
    expect(files.every((f) => f.wavPath === null)).toBe(true);
  });

  it('keeps the audio of sessions inside the retention window', async () => {
    const { wavPath } = await createSessionWithAudio({
      name: 'fresh',
      ageMs: AUDIO_RETENTION_WINDOW_MS - DAY_MS,
    });

    await cleanupExpiredSessionAudio();

    expect(await fileExists(wavPath)).toBe(true);
  });

  it('keeps the audio of expired sessions without a transcript', async () => {
    const { wavPath } = await createSessionWithAudio({
      name: 'untranscribed',
      ageMs: AUDIO_RETENTION_WINDOW_MS + DAY_MS,
      transcript: '',
      status: 'pending_transcription',
    });

    await cleanupExpiredSessionAudio();

    expect(await fileExists(wavPath)).toBe(true);
  });

  it('keeps the audio while a transcription is still running', async () => {
    const { wavPath } = await createSessionWithAudio({
      name: 'processing',
      ageMs: AUDIO_RETENTION_WINDOW_MS + DAY_MS,
      status: 'processing',
    });

    await cleanupExpiredSessionAudio();

    expect(await fileExists(wavPath)).toBe(true);
  });

  it('only removes files that are actually past the cutoff', async () => {
    const expired = await createSessionWithAudio({
      name: 'cutoff-old',
      ageMs: AUDIO_RETENTION_WINDOW_MS + 60_000,
    });
    const kept = await createSessionWithAudio({
      name: 'cutoff-new',
      ageMs: AUDIO_RETENTION_WINDOW_MS - 60_000,
    });

    const result = await cleanupExpiredSessionAudio(Date.now());

    expect(result.sessions).toBe(1);
    expect(await fileExists(expired.wavPath)).toBe(false);
    expect(await fileExists(kept.wavPath)).toBe(true);
  });
});
