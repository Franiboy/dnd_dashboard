import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { updateFile, updateSession, getSessionById } from '../repositories/recordings.js';
import { emitSessionsUpdated } from './recordingsEvents.js';
import type { RecordingFile } from '../../shared/types.js';

const WHISPER_COMMAND = process.env.WHISPER_COMMAND || 'whisper';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'de';

interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface WhisperOutput {
  segments: WhisperSegment[];
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker: string;
}

function runCommand(command: string, args: string[]): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'pipe' });
    let output = '';
    let errorOutput = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    child.on('error', (err) => {
      resolve({ success: false, output: err.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        const combined = [errorOutput, output].filter(Boolean).join('\n---\n');
        resolve({ success: false, output: combined || `exit code ${code}` });
      }
    });
  });
}

async function transcribeFile(
  wavPath: string,
  outputDir: string,
  displayName: string,
): Promise<TranscriptSegment[]> {
  const args = [
    wavPath,
    '--model',
    WHISPER_MODEL,
    '--language',
    WHISPER_LANGUAGE,
    '--output_format',
    'json',
    '--output_dir',
    outputDir,
    '--fp16',
    'False',
  ];

  const result = await runCommand(WHISPER_COMMAND, args);
  if (!result.success) {
    throw new Error(`Whisper failed for ${displayName}: ${result.output}`);
  }

  const baseName = basename(wavPath, extname(wavPath));
  const jsonPath = join(outputDir, `${baseName}.json`);
  const raw = await readFile(jsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as WhisperOutput;

  if (!parsed.segments || !Array.isArray(parsed.segments)) {
    return [];
  }

  return parsed.segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text.trim(),
    speaker: displayName,
  }));
}

function formatTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function buildTranscript(segments: TranscriptSegment[]): string {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  return sorted.map((s) => `[${formatTimestamp(s.start)}] ${s.speaker}: ${s.text}`).join('\n');
}

export async function runTranscription(sessionId: number, files: RecordingFile[]): Promise<void> {
  const session = getSessionById(sessionId);
  if (!session) return;

  updateSession(sessionId, { status: 'processing', error: null });
  emitSessionsUpdated();

  const allSegments: TranscriptSegment[] = [];
  const errors: string[] = [];

  const trimStart = session.trimStartSeconds ?? 0;
  const trimEnd = session.trimEndSeconds ?? Infinity;

  for (const file of files) {
    if (!file.wavPath) continue;

    const transcriptPath = join(session.directory, `speaker-${file.userId}.txt`);
    try {
      const segments = (await transcribeFile(file.wavPath, session.directory, file.displayName))
        .filter((s) => s.end > trimStart && s.start < trimEnd)
        .map((s) => ({
          ...s,
          start: Math.max(s.start, trimStart),
          end: Math.min(s.end, trimEnd),
        }));
      const speakerText = segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join('\n');
      await writeFile(transcriptPath, speakerText);
      updateFile(file.id, { transcriptPath });
      allSegments.push(...segments);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${file.displayName}: ${message}`);
    }
  }

  if (allSegments.length === 0) {
    updateSession(sessionId, { status: 'error', error: errors.join('; ') || 'Transkription lieferte keine Ergebnisse' });
    emitSessionsUpdated();
    return;
  }

  try {
    const transcript = buildTranscript(allSegments);
    const transcriptPath = join(session.directory, 'transcript.txt');
    await writeFile(transcriptPath, transcript);

    updateSession(sessionId, { status: 'completed', transcript });
    emitSessionsUpdated();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateSession(sessionId, { status: 'error', error: `Transkript erstellung fehlgeschlagen: ${message}` });
    emitSessionsUpdated();
  }
}
