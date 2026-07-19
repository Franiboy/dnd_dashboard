import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, closeSync, readSync, writeSync } from 'node:fs';
import { rm, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import OpusScript from 'opusscript';

export interface PcmSegment {
  startSample: number;
  length: number;
}

export function isOpusAvailable(): boolean {
  try {
    return OpusScript !== undefined;
  } catch {
    return false;
  }
}

export function createOpusDecoder(channels = 2): InstanceType<typeof OpusScript> {
  return new OpusScript(48000, channels, OpusScript.Application.AUDIO);
}

export function decodeOpusPacket(decoder: InstanceType<typeof OpusScript>, packet: Buffer): Buffer {
  return decoder.decode(packet);
}

export function destroyOpusDecoder(decoder: InstanceType<typeof OpusScript>): void {
  decoder.delete();
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function buildWavHeader(dataLength: number, sampleRate: number, channels: number, bitDepth: number): Buffer {
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
  segments?: PcmSegment[],
): Promise<void> {
  const bytesPerSample = (channels * bitDepth) / 8;
  let dataLength: number;

  if (segments && segments.length > 0) {
    const last = segments[segments.length - 1];
    dataLength = (last.startSample + last.length) * bytesPerSample;
  } else {
    const fileStat = await stat(pcmPath);
    dataLength = fileStat.size;
  }

  const header = buildWavHeader(dataLength, sampleRate, channels, bitDepth);
  await writeFile(wavPath, header);

  if (!segments || segments.length === 0) {
    const reader = createReadStream(pcmPath);
    const writer = createWriteStream(wavPath, { flags: 'a' });
    await pipeline(reader, writer);
    return;
  }

  const pcmFd = openSync(pcmPath, 'r');
  const wavFd = openSync(wavPath, 'r+');

  try {
    const wavDataStart = 44;
    const CHUNK = 64 * 1024;
    const silenceChunk = Buffer.alloc(CHUNK, 0);
    const tempChunk = Buffer.alloc(CHUNK);

    let samplesWritten = 0;
    let pcmOffset = 0;

    for (const segment of segments) {
      if (segment.startSample > samplesWritten) {
        const silenceSamples = segment.startSample - samplesWritten;
        let pos = wavDataStart + samplesWritten * bytesPerSample;
        let remaining = silenceSamples * bytesPerSample;
        while (remaining > 0) {
          const size = Math.min(remaining, silenceChunk.length);
          writeSync(wavFd, silenceChunk, 0, size, pos);
          pos += size;
          remaining -= size;
        }
        samplesWritten = segment.startSample;
      }

      let pos = wavDataStart + segment.startSample * bytesPerSample;
      const segmentBytes = segment.length * bytesPerSample;
      let remaining = segmentBytes;
      while (remaining > 0) {
        const size = Math.min(remaining, tempChunk.length);
        const bytesRead = readSync(pcmFd, tempChunk, 0, size, pcmOffset);
        if (bytesRead === 0) break;
        writeSync(wavFd, tempChunk, 0, bytesRead, pos);
        pos += bytesRead;
        pcmOffset += bytesRead;
        remaining -= bytesRead;
      }

      samplesWritten = segment.startSample + segment.length;
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

export function makeSessionDir(baseDir: string, sessionId: number): string {
  const dir = join(baseDir, `session-${sessionId}`);
  ensureDir(dir);
  return dir;
}
