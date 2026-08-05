import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateFile, updateSession, getSessionById, listSessionsByStatus, clearFileTranscriptPathsBySession } from '../repositories/recordings.js';
import { emitSessionsUpdated, emitProgressUpdated } from './recordingsEvents.js';
import { createLogger } from '../logger.js';
import type { RecordingFile, RecordingSession, TranscriptionProgress } from '../../shared/types.js';

const log = createLogger('transcriber');

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'de';
const WHISPER_FP16 = process.env.WHISPER_FP16 === 'true';
const WHISPER_INITIAL_PROMPT = process.env.WHISPER_INITIAL_PROMPT || undefined;
const WHISPER_NOISE_REDUCE = process.env.WHISPER_NOISE_REDUCE !== 'false';
function envNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

const WHISPER_VAD_NOISE_DB = envNumber('WHISPER_VAD_NOISE_DB', -40);
const WHISPER_VAD_MIN_SILENCE = envNumber('WHISPER_VAD_MIN_SILENCE', 0.5);
const WHISPER_VAD_MIN_SPEECH = envNumber('WHISPER_VAD_MIN_SPEECH', 0.3);
const WHISPER_VAD_GAP_MERGE = envNumber('WHISPER_VAD_GAP_MERGE', 0);
const WHISPER_FILTER_NO_SPEECH_PROB = envNumber('WHISPER_FILTER_NO_SPEECH_PROB', 0.9);
const MAX_STDERR_LENGTH = 5000;

function appendStderr(buffer: string, chunk: string, maxLength: number): string {
  const combined = buffer + chunk;
  if (combined.length <= maxLength) return combined;
  // Keep the tail of the output; the most recent error lines are usually the most useful.
  return combined.slice(-maxLength);
}

function findPythonCommand(): string {
  const candidates = [process.env.PYTHON_COMMAND, 'python3', 'python'].filter((cmd): cmd is string => Boolean(cmd));
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (result.status === 0 && !result.error) {
      return cmd;
    }
  }
  return process.env.PYTHON_COMMAND || 'python3';
}

const PYTHON_COMMAND = findPythonCommand();
log.info(`Using Python command: ${PYTHON_COMMAND}`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findTranscribeScript(): string {
  const candidates = [
    join(__dirname, 'transcribe.py'),
    join(process.cwd(), 'server', 'discord', 'transcribe.py'),
    join(process.cwd(), 'dist-server', 'server', 'discord', 'transcribe.py'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

const TRANSCRIBE_SCRIPT = findTranscribeScript();

const transcriptionProgress = new Map<number, TranscriptionProgress>();
const activeChildren = new Set<ChildProcess>();
let shuttingDown = false;

export function getTranscriptionProgress(sessionId: number): TranscriptionProgress | null {
  return transcriptionProgress.get(sessionId) ?? null;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

function setTranscriptionProgress(sessionId: number, progress: TranscriptionProgress): void {
  transcriptionProgress.set(sessionId, progress);
  emitProgressUpdated(sessionId, progress);
}

function clearTranscriptionProgress(sessionId: number): void {
  transcriptionProgress.delete(sessionId);
  emitProgressUpdated(sessionId, null);
}

export function resetInterruptedTranscriptions(): number {
  let sessions: RecordingSession[];
  try {
    sessions = listSessionsByStatus('processing');
  } catch (err) {
    log.error('Failed to list processing transcription sessions:', err);
    return 0;
  }

  if (sessions.length === 0) {
    return 0;
  }

  for (const session of sessions) {
    updateSession(session.id, { status: 'pending_transcription', error: null });
  }

  log.info(`Reset ${sessions.length} interrupted transcription session(s) to pending`);
  emitSessionsUpdated();
  return sessions.length;
}

export async function stopAllTranscriptions(): Promise<void> {
  shuttingDown = true;

  if (activeChildren.size === 0) {
    return;
  }

  log.info(`Stopping ${activeChildren.size} active transcription process(es)`);

  const children = Array.from(activeChildren);
  const promises: Promise<void>[] = [];
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      promises.push(waitForChildExit(child));
    } else {
      activeChildren.delete(child);
    }
  }

  await Promise.all(promises).catch((err) => {
    log.error('Error stopping transcription processes:', err);
  });
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      activeChildren.delete(child);
      resolve();
    };

    if (child.exitCode !== null || child.signalCode !== null) {
      settle();
      return;
    }

    let killTimeout: NodeJS.Timeout | null = null;
    const termTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        killTimeout = setTimeout(settle, 1000);
      } else {
        settle();
      }
    }, 2000);

    child.once('exit', () => {
      clearTimeout(termTimeout);
      if (killTimeout) clearTimeout(killTimeout);
      settle();
    });
  });
}

async function isTranscriptFileValid(transcriptPath: string): Promise<boolean> {
  try {
    const fileStat = await stat(transcriptPath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

function trimValuesChanged(session: RecordingSession, trimStart: number, trimEnd: number): boolean {
  return (
    session.transcribedTrimStartSeconds === null ||
    session.transcribedTrimEndSeconds === null ||
    session.transcribedTrimStartSeconds !== trimStart ||
    session.transcribedTrimEndSeconds !== trimEnd
  );
}

async function buildResumePlan(
  files: RecordingFile[],
): Promise<{ completedFiles: RecordingFile[]; pendingFiles: RecordingFile[] }> {
  const completedFiles: RecordingFile[] = [];
  const pendingFiles: RecordingFile[] = [];

  for (const file of files) {
    if (!file.wavPath) {
      continue;
    }
    if (file.transcriptPath && (await isTranscriptFileValid(file.transcriptPath))) {
      completedFiles.push(file);
    } else {
      pendingFiles.push(file);
    }
  }

  return { completedFiles, pendingFiles };
}

type ScriptEvent =
  | { type: 'file_start'; index: number; total: number; name: string }
  | { type: 'progress'; current: number; total: number }
  | { type: 'file_complete'; index: number; id: number; userId: string; transcriptPath: string }
  | { type: 'file_error'; index: number; error: string }
  | { type: 'complete'; transcript: string; transcriptPath: string; files: { id: number; userId: string; transcriptPath: string }[]; errors: string[] }
  | { type: 'error'; error: string };

function parseEvent(line: string): ScriptEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ScriptEvent;
  } catch {
    return null;
  }
}

function runTranscriptionScript(
  sessionId: number,
  outputDir: string,
  files: RecordingFile[],
  trimStart: number,
  trimEnd: number,
  completedFiles: RecordingFile[],
): Promise<{ transcript: string | null; transcriptPath: string | null; files: { id: number; userId: string; transcriptPath: string }[]; errors: string[] }> {
  const filesArg = JSON.stringify(
    files
      .filter((f) => f.wavPath)
      .map((f) => ({ id: f.id, userId: f.userId, wavPath: f.wavPath, displayName: f.displayName })),
  );

  const completedFilesArg = JSON.stringify(
    completedFiles
      .filter((f) => f.wavPath && f.transcriptPath)
      .map((f) => ({ id: f.id, userId: f.userId, wavPath: f.wavPath, displayName: f.displayName, transcriptPath: f.transcriptPath })),
  );

  const args = [
    TRANSCRIBE_SCRIPT,
    '--model',
    WHISPER_MODEL,
    '--language',
    WHISPER_LANGUAGE,
    '--fp16',
    String(WHISPER_FP16),
    '--trim-start',
    String(trimStart),
    '--output-dir',
    outputDir,
    '--files',
    filesArg,
    '--completed-files',
    completedFilesArg,
    '--noise-reduce',
    String(WHISPER_NOISE_REDUCE),
    '--vad-noise-db',
    String(WHISPER_VAD_NOISE_DB),
    '--vad-min-silence',
    String(WHISPER_VAD_MIN_SILENCE),
    '--vad-min-speech',
    String(WHISPER_VAD_MIN_SPEECH),
    '--vad-gap-merge',
    String(WHISPER_VAD_GAP_MERGE),
    '--filter-no-speech-prob',
    String(WHISPER_FILTER_NO_SPEECH_PROB),
  ];

  if (trimEnd !== Infinity) {
    args.push('--trim-end', String(trimEnd));
  }

  if (WHISPER_INITIAL_PROMPT) {
    args.push('--initial-prompt', WHISPER_INITIAL_PROMPT);
  }

  return new Promise((resolve, reject) => {
    let currentFileName = '';
    let currentFileIndex = 0;
    let totalFiles = 0;
    let finalResult: { transcript: string | null; transcriptPath: string | null; files: { id: number; userId: string; transcriptPath: string }[]; errors: string[] } | null = null;

    const child = spawn(PYTHON_COMMAND, args, { stdio: 'pipe' });
    activeChildren.add(child);
    let stderrBuffer = '';
    let stdoutBuffer = '';

    const handleEvent = (event: ScriptEvent) => {
      if (event.type === 'file_start') {
        currentFileIndex = event.index + 1;
        totalFiles = event.total;
        currentFileName = event.name;
        setTranscriptionProgress(sessionId, {
          currentFile: currentFileIndex,
          totalFiles,
          fileName: currentFileName,
          framesCurrent: 0,
          framesTotal: 0,
        });
      } else if (event.type === 'progress') {
        setTranscriptionProgress(sessionId, {
          currentFile: currentFileIndex,
          totalFiles,
          fileName: currentFileName,
          framesCurrent: event.current,
          framesTotal: event.total,
        });
      } else if (event.type === 'file_complete') {
        updateFile(event.id, { transcriptPath: event.transcriptPath });
      } else if (event.type === 'file_error') {
        log.error(`Transcription error for file ${currentFileIndex} (${currentFileName}): ${event.error}`);
      } else if (event.type === 'complete') {
        finalResult = {
          transcript: event.transcript,
          transcriptPath: event.transcriptPath,
          files: event.files,
          errors: event.errors,
        };
      } else if (event.type === 'error') {
        finalResult = {
          transcript: null,
          transcriptPath: null,
          files: [],
          errors: [event.error],
        };
      }
    };

    const processStdoutChunk = (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        const event = parseEvent(line);
        if (event) handleEvent(event);
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      processStdoutChunk(data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrBuffer = appendStderr(stderrBuffer, data.toString(), MAX_STDERR_LENGTH);
    });

    child.on('error', (err) => {
      activeChildren.delete(child);
      reject(err);
    });

    child.on('close', (code) => {
      activeChildren.delete(child);
      if (code !== 0) {
        reject(new Error(stderrBuffer || `Python transcription script exited with code ${code}`));
        return;
      }

      processStdoutChunk('');
      if (stdoutBuffer.trim()) {
        const event = parseEvent(stdoutBuffer);
        if (event) handleEvent(event);
      }

      if (finalResult) {
        resolve(finalResult);
        return;
      }

      reject(new Error('Transcription script completed without final event'));
    });
  });
}

export async function runTranscription(
  sessionId: number,
  files: RecordingFile[],
  options?: { force?: boolean },
): Promise<void> {
  const session = getSessionById(sessionId);
  if (!session) return;
  const originalStatus = session.status;
  const originalError = session.error;
  const resetStatus = originalStatus === 'processing' ? 'pending_transcription' : originalStatus;
  const force = options?.force ?? false;

  if (shuttingDown) {
    if (originalStatus === 'processing') {
      updateSession(sessionId, { status: resetStatus, error: null });
      emitSessionsUpdated();
    }
    clearTranscriptionProgress(sessionId);
    return;
  }

  const trimStart = session.trimStartSeconds ?? 0;
  const trimEnd = session.trimEndSeconds ?? Infinity;

  if (force || trimValuesChanged(session, trimStart, trimEnd)) {
    clearFileTranscriptPathsBySession(session.id);
    files = files.map((file) => ({ ...file, transcriptPath: null }));
  }

  updateSession(sessionId, {
    status: 'processing',
    error: null,
    transcribedTrimStartSeconds: trimStart,
    transcribedTrimEndSeconds: trimEnd,
  });
  emitSessionsUpdated();

  try {
    const { completedFiles, pendingFiles } = force
      ? { completedFiles: [] as RecordingFile[], pendingFiles: files.filter((f) => f.wavPath) }
      : await buildResumePlan(files);

    if (completedFiles.length === 0 && pendingFiles.length === 0) {
      updateSession(sessionId, {
        status: 'error',
        error: 'Keine Audio-Dateien für diese Session vorhanden',
      });
      emitSessionsUpdated();
      return;
    }

    log.info(`Transcription session ${sessionId}: ${completedFiles.length} completed, ${pendingFiles.length} pending`);

    const result = await runTranscriptionScript(sessionId, session.directory, files, trimStart, trimEnd, completedFiles);

    for (const file of result.files) {
      updateFile(file.id, { transcriptPath: file.transcriptPath });
    }

    if (result.transcript !== null) {
      if (result.errors.length > 0) {
        log.warn(`Transcription session ${sessionId} completed with errors: ${result.errors.join('; ')}`);
      }
      updateSession(sessionId, {
        status: 'completed',
        transcript: result.transcript,
        transcribedTrimStartSeconds: trimStart,
        transcribedTrimEndSeconds: trimEnd,
      });
    } else {
      updateSession(sessionId, {
        status: 'error',
        error: result.errors.join('; ') || 'Transkription lieferte keine Ergebnisse',
      });
    }
    emitSessionsUpdated();
  } catch (err) {
    if (shuttingDown) {
      updateSession(sessionId, { status: resetStatus, error: originalError });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      updateSession(sessionId, { status: 'error', error: `Transkription fehlgeschlagen: ${message}` });
    }
    emitSessionsUpdated();
  } finally {
    clearTranscriptionProgress(sessionId);
  }
}
