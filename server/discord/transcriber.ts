import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateFile, updateSession, getSessionById } from '../repositories/recordings.js';
import { emitSessionsUpdated } from './recordingsEvents.js';
import type { RecordingFile } from '../../shared/types.js';

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'de';
const WHISPER_FP16 = process.env.WHISPER_FP16 === 'true';
const PYTHON_COMMAND = process.env.PYTHON_COMMAND || 'python';

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

export interface TranscriptionProgress {
  currentFile: number;
  totalFiles: number;
  fileName: string;
  framesCurrent: number;
  framesTotal: number;
}

const transcriptionProgress = new Map<number, TranscriptionProgress>();

export function getTranscriptionProgress(sessionId: number): TranscriptionProgress | null {
  return transcriptionProgress.get(sessionId) ?? null;
}

function setTranscriptionProgress(sessionId: number, progress: TranscriptionProgress): void {
  transcriptionProgress.set(sessionId, progress);
}

function clearTranscriptionProgress(sessionId: number): void {
  transcriptionProgress.delete(sessionId);
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
): Promise<{ transcript: string | null; transcriptPath: string | null; files: { id: number; userId: string; transcriptPath: string }[]; errors: string[] }> {
  const filesArg = JSON.stringify(
    files
      .filter((f) => f.wavPath)
      .map((f) => ({ id: f.id, userId: f.userId, wavPath: f.wavPath, displayName: f.displayName })),
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
  ];

  if (trimEnd !== Infinity) {
    args.push('--trim-end', String(trimEnd));
  }

  return new Promise((resolve, reject) => {
    let currentFileName = '';
    let currentFileIndex = 0;
    let totalFiles = 0;
    let finalResult: { transcript: string | null; transcriptPath: string | null; files: { id: number; userId: string; transcriptPath: string }[]; errors: string[] } | null = null;

    const child = spawn(PYTHON_COMMAND, args, { stdio: 'pipe' });
    let stderrBuffer = '';

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const event = parseEvent(line);
        if (!event) continue;

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
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderrBuffer || `Python transcription script exited with code ${code}`));
        return;
      }

      if (finalResult) {
        resolve(finalResult);
        return;
      }

      reject(new Error('Transcription script completed without final event'));
    });
  });
}

export async function runTranscription(sessionId: number, files: RecordingFile[]): Promise<void> {
  const session = getSessionById(sessionId);
  if (!session) return;

  updateSession(sessionId, { status: 'processing', error: null });
  emitSessionsUpdated();

  const trimStart = session.trimStartSeconds ?? 0;
  const trimEnd = session.trimEndSeconds ?? Infinity;

  try {
    const result = await runTranscriptionScript(sessionId, session.directory, files, trimStart, trimEnd);

    for (const file of result.files) {
      updateFile(file.id, { transcriptPath: file.transcriptPath });
    }

    if (result.transcript) {
      updateSession(sessionId, { status: 'completed', transcript: result.transcript });
    } else {
      updateSession(sessionId, {
        status: 'error',
        error: result.errors.join('; ') || 'Transkription lieferte keine Ergebnisse',
      });
    }
    emitSessionsUpdated();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateSession(sessionId, { status: 'error', error: `Transkription fehlgeschlagen: ${message}` });
    emitSessionsUpdated();
  } finally {
    clearTranscriptionProgress(sessionId);
  }
}
