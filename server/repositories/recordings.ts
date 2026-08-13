import { db } from '../database.js';
import type {
  RecordingFile,
  RecordingSession,
  RecordingStatus,
  SessionDiaryEntryLink,
  SessionDiaryTransfer,
} from '../../shared/types.js';

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
      'INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      input.name,
      'recording',
      input.guildId,
      input.channelId,
      input.createdBy,
      startedAt,
      input.directory,
      startedAt
    );

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
    trimStartSeconds: null,
    trimEndSeconds: null,
    transcribedTrimStartSeconds: null,
    transcribedTrimEndSeconds: null,
    transcriptImprovedAt: null,
    summary: null,
    summaryGeneratedAt: null,
    longSummary: null,
    longSummaryGeneratedAt: null,
  };
}

export function getSessionById(id: number): RecordingSession | null {
  const row = db
    .prepare(
      'SELECT id, name, status, guild_id as guildId, channel_id as channelId, created_by as createdBy, started_at as startedAt, stopped_at as stoppedAt, directory, transcript, error, trim_start_seconds as trimStartSeconds, trim_end_seconds as trimEndSeconds, transcribed_trim_start_seconds as transcribedTrimStartSeconds, transcribed_trim_end_seconds as transcribedTrimEndSeconds, transcript_improved_at as transcriptImprovedAt, summary, summary_generated_at as summaryGeneratedAt, long_summary as longSummary, long_summary_generated_at as longSummaryGeneratedAt FROM recording_sessions WHERE id = ?'
    )
    .get(id) as RecordingSession | undefined;
  return row ?? null;
}

export interface SessionSummary {
  id: number;
  name: string;
  startedAt: string;
  summary: string | null;
  summaryGeneratedAt: string | null;
  longSummary: string | null;
  longSummaryGeneratedAt: string | null;
}

export interface PendingAiSession {
  id: number;
  transcriptImprovedAt: string | null;
  longSummary: string | null;
  longSummaryGeneratedAt: string | null;
}

export function listSessionsPendingAi(): PendingAiSession[] {
  return db
    .prepare(
      "SELECT id, transcript_improved_at as transcriptImprovedAt, long_summary as longSummary, long_summary_generated_at as longSummaryGeneratedAt FROM recording_sessions WHERE status = 'completed' AND transcript IS NOT NULL"
    )
    .all() as PendingAiSession[];
}

export function getSessionSummaryById(id: number): SessionSummary | null {
  const row = db
    .prepare(
      'SELECT id, name, started_at as startedAt, summary, summary_generated_at as summaryGeneratedAt, long_summary as longSummary, long_summary_generated_at as longSummaryGeneratedAt FROM recording_sessions WHERE id = ?'
    )
    .get(id) as SessionSummary | undefined;
  return row ?? null;
}

export function listPreviousSessionSummaries(id: number, limit = 5): SessionSummary[] {
  const session = getSessionSummaryById(id);
  const startedAt = session?.startedAt;
  if (!startedAt) return [];
  return db
    .prepare(
      'SELECT id, name, started_at as startedAt, summary, summary_generated_at as summaryGeneratedAt, long_summary as longSummary, long_summary_generated_at as longSummaryGeneratedAt FROM recording_sessions WHERE started_at < ? ORDER BY started_at DESC LIMIT ?'
    )
    .all(startedAt, limit) as SessionSummary[];
}

export interface RecentCompletedSession {
  id: number;
  name: string;
  startedAt: string;
  transcript: string | null;
  summary: string | null;
  longSummary: string | null;
}

export function listRecentCompletedSessions(limit = 5): RecentCompletedSession[] {
  return db
    .prepare(
      `SELECT id, name, started_at as startedAt, transcript, summary, long_summary as longSummary
       FROM recording_sessions
       WHERE status = 'completed' AND transcript IS NOT NULL AND transcript <> ''
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(limit) as RecentCompletedSession[];
}

export function listSessions(): RecordingSession[] {
  const rows = db
    .prepare(
      `SELECT 
        s.id, s.name, s.status, s.guild_id as guildId, s.channel_id as channelId, 
        s.created_by as createdBy, s.started_at as startedAt, s.stopped_at as stoppedAt, 
        s.directory, NULL as transcript, s.error, s.trim_start_seconds as trimStartSeconds, s.trim_end_seconds as trimEndSeconds,
        s.transcribed_trim_start_seconds as transcribedTrimStartSeconds, s.transcribed_trim_end_seconds as transcribedTrimEndSeconds,
        s.transcript_improved_at as transcriptImprovedAt, s.summary, s.summary_generated_at as summaryGeneratedAt,
        s.long_summary as longSummary, s.long_summary_generated_at as longSummaryGeneratedAt,
        COALESCE((SELECT COUNT(*) FROM recording_files f WHERE f.session_id = s.id AND f.wav_path IS NOT NULL), 0) as hasWavFiles
      FROM recording_sessions s
      ORDER BY started_at DESC`
    )
    .all() as (Omit<RecordingSession, 'hasWavFiles' | 'transcript'> & {
    hasWavFiles: number;
    transcript: null;
  })[];
  return rows.map((row) => ({ ...row, hasWavFiles: !!row.hasWavFiles }));
}

export function listPendingTranscriptionSessions(): RecordingSession[] {
  return db
    .prepare(
      "SELECT id, name, status, guild_id as guildId, channel_id as channelId, created_by as createdBy, started_at as startedAt, stopped_at as stoppedAt, directory, transcript, error, trim_start_seconds as trimStartSeconds, trim_end_seconds as trimEndSeconds, transcribed_trim_start_seconds as transcribedTrimStartSeconds, transcribed_trim_end_seconds as transcribedTrimEndSeconds, transcript_improved_at as transcriptImprovedAt, summary, summary_generated_at as summaryGeneratedAt, long_summary as longSummary, long_summary_generated_at as longSummaryGeneratedAt FROM recording_sessions WHERE status = 'pending_transcription' ORDER BY stopped_at ASC"
    )
    .all() as RecordingSession[];
}

export function listSessionsByStatus(status: RecordingStatus): RecordingSession[] {
  return db
    .prepare(
      'SELECT id, name, status, guild_id as guildId, channel_id as channelId, created_by as createdBy, started_at as startedAt, stopped_at as stoppedAt, directory, transcript, error, trim_start_seconds as trimStartSeconds, trim_end_seconds as trimEndSeconds, transcribed_trim_start_seconds as transcribedTrimStartSeconds, transcribed_trim_end_seconds as transcribedTrimEndSeconds, transcript_improved_at as transcriptImprovedAt, summary, summary_generated_at as summaryGeneratedAt, long_summary as longSummary, long_summary_generated_at as longSummaryGeneratedAt FROM recording_sessions WHERE status = ? ORDER BY started_at ASC'
    )
    .all(status) as RecordingSession[];
}

export function updateSession(
  id: number,
  updates: Partial<
    Pick<
      RecordingSession,
      | 'status'
      | 'stoppedAt'
      | 'transcript'
      | 'error'
      | 'directory'
      | 'trimStartSeconds'
      | 'trimEndSeconds'
      | 'transcribedTrimStartSeconds'
      | 'transcribedTrimEndSeconds'
      | 'transcriptImprovedAt'
      | 'summary'
      | 'summaryGeneratedAt'
      | 'longSummary'
      | 'longSummaryGeneratedAt'
    >
  >
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
  if (updates.trimStartSeconds !== undefined) {
    fields.push('trim_start_seconds = ?');
    values.push(updates.trimStartSeconds);
  }
  if (updates.trimEndSeconds !== undefined) {
    fields.push('trim_end_seconds = ?');
    values.push(updates.trimEndSeconds);
  }
  if (updates.transcribedTrimStartSeconds !== undefined) {
    fields.push('transcribed_trim_start_seconds = ?');
    values.push(updates.transcribedTrimStartSeconds);
  }
  if (updates.transcribedTrimEndSeconds !== undefined) {
    fields.push('transcribed_trim_end_seconds = ?');
    values.push(updates.transcribedTrimEndSeconds);
  }
  if (updates.transcriptImprovedAt !== undefined) {
    fields.push('transcript_improved_at = ?');
    values.push(updates.transcriptImprovedAt);
  }
  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    values.push(updates.summary);
  }
  if (updates.summaryGeneratedAt !== undefined) {
    fields.push('summary_generated_at = ?');
    values.push(updates.summaryGeneratedAt);
  }
  if (updates.longSummary !== undefined) {
    fields.push('long_summary = ?');
    values.push(updates.longSummary);
  }
  if (updates.longSummaryGeneratedAt !== undefined) {
    fields.push('long_summary_generated_at = ?');
    values.push(updates.longSummaryGeneratedAt);
  }

  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());

  values.push(id);
  db.prepare(`UPDATE recording_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function createFile(input: CreateFileInput): RecordingFile {
  const result = db
    .prepare(
      'INSERT INTO recording_files (session_id, user_id, display_name, pcm_path) VALUES (?, ?, ?, ?)'
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
      'SELECT id, session_id as sessionId, user_id as userId, display_name as displayName, pcm_path as pcmPath, wav_path as wavPath, duration, transcript_path as transcriptPath FROM recording_files WHERE session_id = ?'
    )
    .all(sessionId) as RecordingFile[];
}

export interface RecordingConfig {
  channelId: string | null;
}

export function getRecordingConfig(): RecordingConfig {
  const row = db
    .prepare('SELECT channel_id as channelId FROM recording_config WHERE id = 1')
    .get() as { channelId: string | null } | undefined;
  return { channelId: row?.channelId ?? null };
}

export function setRecordingConfig(channelId: string | null): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO recording_config (id, channel_id, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, updated_at = excluded.updated_at'
  ).run(channelId, now);
}

export function deleteSession(id: number): { directory: string | null } {
  const session = getSessionById(id);
  const directory = session?.directory ?? null;
  db.prepare('DELETE FROM recording_sessions WHERE id = ?').run(id);
  return { directory };
}

export function updateFile(
  id: number,
  updates: Partial<Pick<RecordingFile, 'wavPath' | 'duration' | 'transcriptPath'>>
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

export function clearFileTranscriptPathsBySession(sessionId: number): void {
  db.prepare('UPDATE recording_files SET transcript_path = NULL WHERE session_id = ?').run(
    sessionId
  );
}

export interface PendingDiaryTransferSession {
  id: number;
  name: string;
  startedAt: string;
}

export function listPendingSessionToDiaryTransfers(
  userId: string,
  limit?: number
): PendingDiaryTransferSession[] {
  let sql = `SELECT s.id, s.name, s.started_at AS startedAt
       FROM recording_sessions s
       WHERE s.status = 'completed' AND s.transcript IS NOT NULL AND s.transcript <> ''
         AND NOT EXISTS (
           SELECT 1 FROM session_diary_transfers t
           WHERE t.session_id = s.id AND t.user_id = ?
         )
       ORDER BY s.started_at ASC`;
  const params: (string | number)[] = [userId];
  if (limit && Number.isFinite(limit) && limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  const rows = db.prepare(sql).all(...params) as PendingDiaryTransferSession[];
  return rows;
}

export function recordSessionToDiaryTransfer(
  sessionId: number,
  userId: string,
  entryId: number,
  autoAccepted: boolean
): void {
  db.prepare(
    'INSERT OR REPLACE INTO session_diary_transfers (session_id, user_id, entry_id, auto_accepted, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, userId, entryId, autoAccepted ? 1 : 0, new Date().toISOString());
}

export function getSessionToDiaryTransfer(
  sessionId: number,
  userId: string
): SessionDiaryTransfer | null {
  const row = db
    .prepare(
      `SELECT t.entry_id as entryId, t.created_at as transferredAt, t.auto_accepted as autoAccepted,
        CASE WHEN s.updated_at IS NOT NULL AND t.created_at < s.updated_at THEN 1 ELSE 0 END as isOutdated
       FROM session_diary_transfers t
       JOIN recording_sessions s ON s.id = t.session_id
       WHERE t.session_id = ? AND t.user_id = ?`
    )
    .get(sessionId, userId) as
    | { entryId: number; transferredAt: string; autoAccepted: number; isOutdated: number }
    | undefined;
  if (!row) return null;
  return {
    entryId: row.entryId,
    transferredAt: row.transferredAt,
    autoAccepted: !!row.autoAccepted,
    isOutdated: !!row.isOutdated,
  };
}

export function listSessionToDiaryTransfers(userId: string): Record<number, SessionDiaryTransfer> {
  const rows = db
    .prepare(
      `SELECT t.session_id as sessionId, t.entry_id as entryId, t.created_at as transferredAt, t.auto_accepted as autoAccepted,
        CASE WHEN s.updated_at IS NOT NULL AND t.created_at < s.updated_at THEN 1 ELSE 0 END as isOutdated
       FROM session_diary_transfers t
       JOIN recording_sessions s ON s.id = t.session_id
       WHERE t.user_id = ?`
    )
    .all(userId) as {
    sessionId: number;
    entryId: number;
    transferredAt: string;
    autoAccepted: number;
    isOutdated: number;
  }[];
  const result: Record<number, SessionDiaryTransfer> = {};
  for (const row of rows) {
    result[row.sessionId] = {
      entryId: row.entryId,
      transferredAt: row.transferredAt,
      autoAccepted: !!row.autoAccepted,
      isOutdated: !!row.isOutdated,
    };
  }
  return result;
}

export function listAllSessionDiaryEntryLinks(
  currentUserId: string,
  isAdmin: boolean
): Record<number, SessionDiaryEntryLink[]> {
  const sql = `
    SELECT t.session_id AS sessionId, t.entry_id AS entryId, t.user_id AS userId,
           u.display_name AS displayName, d.title, t.auto_accepted AS autoAccepted
    FROM session_diary_transfers t
    JOIN users u ON u.id = t.user_id
    JOIN diary_entries d ON d.id = t.entry_id
    ${isAdmin ? '' : 'WHERE t.user_id = ?'}
    ORDER BY t.created_at DESC
  `;
  const params: string[] = isAdmin ? [] : [currentUserId];
  const rows = db.prepare(sql).all(...params) as {
    sessionId: number;
    entryId: number;
    userId: string;
    displayName: string;
    title: string;
    autoAccepted: number;
  }[];
  const result: Record<number, SessionDiaryEntryLink[]> = {};
  for (const row of rows) {
    if (!result[row.sessionId]) result[row.sessionId] = [];
    result[row.sessionId].push({
      entryId: row.entryId,
      userId: row.userId,
      displayName: row.displayName,
      title: row.title,
      autoAccepted: !!row.autoAccepted,
    });
  }
  return result;
}
