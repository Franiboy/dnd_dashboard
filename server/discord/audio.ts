import {
  createReadStream,
  createWriteStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readFileSync,
  renameSync,
  writeSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { rm, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// `@discordjs/opus` is a native C++ CommonJS module whose exports are resolved
// dynamically via `module.exports = require(...)`. Node's ESM named-export
// detection cannot see through this, so a static `import { OpusEncoder }` fails
// at runtime. Load it via `createRequire` instead, which works reliably.
const requireModule = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const OpusModule = requireModule('@discordjs/opus') as {
  OpusEncoder: new (
    sampleRate: number,
    channels: number
  ) => {
    encode(buf: Buffer): Buffer;
    decode(buf: Buffer): Buffer;
  };
};
const NativeOpusEncoder = OpusModule.OpusEncoder;

export interface PcmSegment {
  startSample: number;
  length: number;
}

export interface PcmSegmentState {
  version: number;
  segments: PcmSegment[];
  currentStart: number | null;
}

export interface OpusDecoder {
  decode(packet: Buffer): Buffer;
}

export function isOpusAvailable(): boolean {
  try {
    return NativeOpusEncoder !== undefined;
  } catch {
    return false;
  }
}

export function createOpusDecoder(channels = 2): OpusDecoder {
  return new NativeOpusEncoder(48000, channels);
}

export function decodeOpusPacket(decoder: OpusDecoder, packet: Buffer): Buffer {
  return decoder.decode(packet);
}

export function destroyOpusDecoder(decoder: OpusDecoder): void {
  // Native C++ binding is GC'd automatically; nothing to release explicitly.
  void decoder;
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getWavDurationSeconds(
  wavPath: string,
  sampleRate = 48000,
  channels = 2,
  bitDepth = 16
): number {
  const bytesPerSecond = (sampleRate * channels * bitDepth) / 8;
  let fd: number | undefined;
  try {
    fd = openSync(wavPath, 'r');
    const stats = fstatSync(fd);
    if (stats.size < 44) return 0;

    const riff = Buffer.alloc(12);
    let bytesRead = readSync(fd, riff, 0, 12, 0);
    if (
      bytesRead < 12 ||
      riff.toString('ascii', 0, 4) !== 'RIFF' ||
      riff.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      return 0;
    }

    let offset = 12;
    const chunkHeader = Buffer.alloc(8);
    while (offset + 8 <= stats.size) {
      bytesRead = readSync(fd, chunkHeader, 0, 8, offset);
      if (bytesRead < 8) return 0;
      const chunkId = chunkHeader.toString('ascii', 0, 4);
      const chunkSize = chunkHeader.readUInt32LE(4);
      if (chunkId === 'data') {
        return Math.max(0, chunkSize) / bytesPerSecond;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    return 0;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export function buildWavHeader(
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitDepth: number
): Buffer {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export async function writeWavFromPcm(
  pcmPath: string,
  wavPath: string,
  sampleRate = 48000,
  channels = 2,
  bitDepth = 16,
  segments?: PcmSegment[]
): Promise<void> {
  const bytesPerSample = (channels * bitDepth) / 8;
  let dataLength: number;
  let sortedSegments: PcmSegment[] = [];

  if (segments) {
    sortedSegments = [...segments]
      .filter(
        (segment) =>
          segment &&
          Number.isFinite(segment.startSample) &&
          Number.isInteger(segment.startSample) &&
          segment.startSample >= 0 &&
          Number.isFinite(segment.length) &&
          Number.isInteger(segment.length) &&
          segment.length > 0
      )
      .sort((a, b) => a.startSample - b.startSample);
  }

  if (sortedSegments.length > 0) {
    dataLength = sortedSegments.reduce(
      (max, segment) => Math.max(max, (segment.startSample + segment.length) * bytesPerSample),
      0
    );
  } else {
    const fileStat = await stat(pcmPath);
    dataLength = fileStat.size;
  }

  const header = buildWavHeader(dataLength, sampleRate, channels, bitDepth);
  await writeFile(wavPath, header);

  if (sortedSegments.length === 0) {
    const reader = createReadStream(pcmPath);
    const writer = createWriteStream(wavPath, { flags: 'a' });
    await pipeline(reader, writer);
    return;
  }

  const pcmFd = openSync(pcmPath, 'r');
  const wavFd = openSync(wavPath, 'r+');

  try {
    const pcmFileSize = fstatSync(pcmFd).size;
    const wavDataStart = 44;
    const CHUNK = 64 * 1024;
    const silenceChunk = Buffer.alloc(CHUNK, 0);
    const tempChunk = Buffer.alloc(CHUNK);

    let samplesWritten = 0;
    let pcmOffset = 0;

    for (const segment of sortedSegments) {
      if (pcmOffset >= pcmFileSize) {
        // No more PCM data for the remaining segments.
        break;
      }

      let segmentStart = Math.max(0, segment.startSample);
      if (segmentStart < samplesWritten) {
        // Out-of-order or overlapping segment; append after already written samples.
        segmentStart = samplesWritten;
      }

      if (segmentStart > samplesWritten) {
        const silenceSamples = segmentStart - samplesWritten;
        let pos = wavDataStart + samplesWritten * bytesPerSample;
        let remaining = silenceSamples * bytesPerSample;
        while (remaining > 0) {
          const size = Math.min(remaining, silenceChunk.length);
          writeSync(wavFd, silenceChunk, 0, size, pos);
          pos += size;
          remaining -= size;
        }
        samplesWritten = segmentStart;
      }

      let pos = wavDataStart + segmentStart * bytesPerSample;
      const segmentBytes = segment.length * bytesPerSample;
      let remaining = segmentBytes;
      while (remaining > 0) {
        const size = Math.min(remaining, tempChunk.length);
        const bytesRead = readSync(pcmFd, tempChunk, 0, size, pcmOffset);
        if (bytesRead === 0) {
          // PCM file is shorter than expected; stop processing further segments.
          break;
        }
        writeSync(wavFd, tempChunk, 0, bytesRead, pos);
        pos += bytesRead;
        pcmOffset += bytesRead;
        remaining -= bytesRead;
      }

      samplesWritten = segmentStart + (segmentBytes - remaining) / bytesPerSample;
      if (remaining > 0) {
        // Truncated PCM; correct the WAV header below.
        break;
      }
    }

    const actualDataLength = samplesWritten * bytesPerSample;
    if (actualDataLength !== dataLength) {
      const correctedHeader = buildWavHeader(actualDataLength, sampleRate, channels, bitDepth);
      writeSync(wavFd, correctedHeader, 0, correctedHeader.length, 0);
    }
  } finally {
    closeSync(pcmFd);
    closeSync(wavFd);
  }
}

export async function removePcmFile(pcmPath: string): Promise<void> {
  try {
    await rm(pcmPath);
  } catch {
    // ignore
  }
}

export function getSegmentPath(pcmPath: string): string {
  return `${pcmPath}.segments`;
}

export function readSegmentState(pcmPath: string): PcmSegmentState | null {
  try {
    const raw = readFileSync(getSegmentPath(pcmPath), 'utf8');
    return JSON.parse(raw) as PcmSegmentState;
  } catch {
    return null;
  }
}

export function writeSegmentState(pcmPath: string, state: PcmSegmentState): void {
  const segmentPath = getSegmentPath(pcmPath);
  const tempPath = `${segmentPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state));
  renameSync(tempPath, segmentPath);
}

export function removeSegmentFile(pcmPath: string): void {
  try {
    rmSync(getSegmentPath(pcmPath), { force: true });
  } catch {
    // ignore
  }
}

export function makeSessionDir(baseDir: string, sessionId: number): string {
  const dir = join(baseDir, `session-${sessionId}`);
  ensureDir(dir);
  return dir;
}
