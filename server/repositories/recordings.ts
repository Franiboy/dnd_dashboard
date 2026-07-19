import { db } from '../database.js';
import type { RecordingFile, RecordingSession } from '../../shared/types.js';

interface CreateSessionInput {
  name: string;
  guildId: string;
  channelId: string;
  createdBy: string;
  directory: string;
}

interface CreateFileInput {
  sessionId: number;
  userId: string;
  displayName: string;
  pcmPath: string;
}

export function createSession(input: CreateSessionInput): RecordingSession {
  const startedAt = new Date().toISOString();
  const result = db
    .prepare(
      'INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(input.name, 'recording', input.guildId, input.channelId, input.createdBy, startedAt, input.directory);

  const id = Number(result.lastInsertRowid);
  return {
    id,
    name: input.name,
    status: 'recording',
    guildId: input.guildId,
    channelId: input.channelId,
    createdBy: input.createdBy,
    startedAt,
    stoppedAt: null,
    directory: input.directory,
    transcript: null,
    error: null,
  };
}

export function getSessionById(id: number): RecordingSession | null {
  const row = db
    .prepare(
      'SELECT id, name, status, guild_id as guildId, channel_id as channelId, created_by as createdBy, started_at as startedAt, stopped_at as stoppedAt, directory, transcript, error FROM recording_sessions WHERE id = ?',
    )
    .get(id) as RecordingSession | undefined;
  return row ?? null;
}

export function listSessions(): RecordingSession[] {
  const rows = db
    .prepare(
      `SELECT 
        s.id, s.name, s.status, s.guild_id as guildId, s.channel_id as channelId, 
        s.created_by as createdBy, s.started_at as startedAt, s.stopped_at as stoppedAt, 
        s.directory, NULL as transcript, s.error,
        COALESCE((SELECT COUNT(*) FROM recording_files f WHERE f.session_id = s.id AND f.wav_path IS NOT NULL), 0) as hasWavFiles
      FROM recording_sessions s
      ORDER BY started_at DESC`,
    )
    .all() as (Omit<RecordingSession, 'hasWavFiles' | 'transcript'> & { hasWavFiles: number; transcript: null })[];
  return rows.map((row) => ({ ...row, hasWavFiles: !!row.hasWavFiles }));
}

export function listPendingTranscriptionSessions(): RecordingSession[] {
  return db
    .prepare(
      "SELECT id, name, status, guild_id as guildId, channel_id as channelId, created_by as createdBy, started_at as startedAt, stopped_at as stoppedAt, directory, transcript, error FROM recording_sessions WHERE status = 'pending_transcription' ORDER BY stopped_at ASC",
    )
    .all() as RecordingSession[];
}

export function updateSession(
  id: number,
  updates: Partial<Pick<RecordingSession, 'status' | 'stoppedAt' | 'transcript' | 'error' | 'directory'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.stoppedAt !== undefined) {
    fields.push('stopped_at = ?');
    values.push(updates.stoppedAt);
  }
  if (updates.transcript !== undefined) {
    fields.push('transcript = ?');
    values.push(updates.transcript);
  }
  if (updates.error !== undefined) {
    fields.push('error = ?');
    values.push(updates.error);
  }
  if (updates.directory !== undefined) {
    fields.push('directory = ?');
    values.push(updates.directory);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE recording_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function createFile(input: CreateFileInput): RecordingFile {
  const result = db
    .prepare(
      'INSERT INTO recording_files (session_id, user_id, display_name, pcm_path) VALUES (?, ?, ?, ?)',
    )
    .run(input.sessionId, input.userId, input.displayName, input.pcmPath);

  const id = Number(result.lastInsertRowid);
  return {
    id,
    sessionId: input.sessionId,
    userId: input.userId,
    displayName: input.displayName,
    pcmPath: input.pcmPath,
    wavPath: null,
    duration: null,
    transcriptPath: null,
  };
}

export function getFilesBySessionId(sessionId: number): RecordingFile[] {
  return db
    .prepare(
      'SELECT id, session_id as sessionId, user_id as userId, display_name as displayName, pcm_path as pcmPath, wav_path as wavPath, duration, transcript_path as transcriptPath FROM recording_files WHERE session_id = ?',
    )
    .all(sessionId) as RecordingFile[];
}

export function updateFile(
  id: number,
  updates: Partial<Pick<RecordingFile, 'wavPath' | 'duration' | 'transcriptPath'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.wavPath !== undefined) {
    fields.push('wav_path = ?');
    values.push(updates.wavPath);
  }
  if (updates.duration !== undefined) {
    fields.push('duration = ?');
    values.push(updates.duration);
  }
  if (updates.transcriptPath !== undefined) {
    fields.push('transcript_path = ?');
    values.push(updates.transcriptPath);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE recording_files SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}
