import { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import type { AudioReceiveStream, VoiceConnection } from '@discordjs/voice';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import { openSync, closeSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createOpusDecoder, decodeOpusPacket, destroyOpusDecoder, writeWavFromPcm, removePcmFile, type PcmSegment } from './audio.js';
import { createFile, updateFile } from '../repositories/recordings.js';
import type { RecordingFile } from '../../shared/types.js';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const BYTES_PER_SAMPLE = (CHANNELS * BIT_DEPTH) / 8;
const JITTER_MS = 50;
const JITTER_SAMPLES = Math.ceil((JITTER_MS * SAMPLE_RATE) / 1000);

interface ActiveUser {
  userId: string;
  displayName: string;
  fileId: number;
  pcmPath: string;
  fd: number;
  decoder: ReturnType<typeof createOpusDecoder>;
  subscribed: boolean;
  audioStream?: AudioReceiveStream;
  currentSegmentStart: number | null;
  currentSegmentLength: number;
  segments: PcmSegment[];
}

interface ActiveRecording {
  sessionId: number;
  connection: VoiceConnection;
  guildId: string;
  channelId: string;
  directory: string;
  users: Map<string, ActiveUser>;
  stopping: boolean;
  startTime: bigint;
  onDisconnect?: (sessionId: number) => void;
}

let activeRecording: ActiveRecording | null = null;

export function isRecording(): boolean {
  return activeRecording !== null;
}

export function getActiveRecording(): { sessionId: number; channelId: string } | null {
  return activeRecording ? { sessionId: activeRecording.sessionId, channelId: activeRecording.channelId } : null;
}

function getDisplayName(guild: Guild, userId: string): string {
  const cachedUser = guild.client.users.cache.get(userId);
  const member = guild.members.cache.get(userId);
  return member?.displayName ?? member?.user.username ?? cachedUser?.username ?? userId;
}

function getWavDurationSeconds(wavFileSize: number): number {
  const pcmBytes = Math.max(0, wavFileSize - 44);
  const bytesPerSecond = (SAMPLE_RATE * CHANNELS * BIT_DEPTH) / 8;
  return pcmBytes / bytesPerSecond;
}

export async function startRecording(
  guild: Guild,
  channel: VoiceBasedChannel,
  sessionId: number,
  directory: string,
  onDisconnect?: (sessionId: number) => void,
): Promise<void> {
  if (activeRecording) {
    throw new Error('Es läuft bereits eine Aufnahme');
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    connection.destroy();
    throw new Error('Voice-Channel-Beitritt fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err)));
  }

  activeRecording = {
    sessionId,
    connection,
    guildId: guild.id,
    channelId: channel.id,
    directory,
    users: new Map(),
    stopping: false,
    startTime: process.hrtime.bigint(),
    onDisconnect,
  };

  connection.on('stateChange', (oldState, newState) => {
    console.log(
      `Voice connection state changed from ${oldState.status} to ${newState.status}` +
        ('reason' in newState && newState.reason ? ` (reason: ${newState.reason})` : ''),
    );
    if (!activeRecording || activeRecording.stopping) return;
    if (
      newState.status === VoiceConnectionStatus.Disconnected ||
      newState.status === VoiceConnectionStatus.Destroyed
    ) {
      activeRecording.stopping = true;
      try {
        activeRecording.onDisconnect?.(activeRecording.sessionId);
      } catch (err) {
        console.error('Disconnect callback failed:', err);
      }
    }
  });

  connection.receiver.speaking.on('start', (userId) => {
    try {
      handleSpeakingStart(guild, userId);
    } catch (err) {
      console.error('Error handling speaking start:', err);
    }
  });
}

function handleSpeakingStart(guild: Guild, userId: string): void {
  const rec = activeRecording;
  if (!rec || rec.stopping) return;

  let user = rec.users.get(userId);
  if (!user) {
    const displayName = getDisplayName(guild, userId);
    const pcmPath = join(rec.directory, `user-${userId}.pcm`);
    const fd = openSync(pcmPath, 'w');
    const decoder = createOpusDecoder(CHANNELS);
    const fileRow = createFile({
      sessionId: rec.sessionId,
      userId,
      displayName,
      pcmPath,
    });
    user = {
      userId,
      displayName,
      fileId: fileRow.id,
      pcmPath,
      fd,
      decoder,
      subscribed: false,
      currentSegmentStart: null,
      currentSegmentLength: 0,
      segments: [],
    };
    rec.users.set(userId, user);
  }

  if (user.subscribed) return;

  user.subscribed = true;
  const audioStream = rec.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  user.audioStream = audioStream;

  audioStream.on('data', (chunk: Buffer) => {
    if (!activeRecording || activeRecording.stopping) return;
    try {
      const elapsedMs = Number(process.hrtime.bigint() - activeRecording.startTime) / 1_000_000;
      const currentSample = Math.floor((elapsedMs * SAMPLE_RATE) / 1000);
      const pcm = decodeOpusPacket(user.decoder, chunk);
      const samples = pcm.length / BYTES_PER_SAMPLE;

      if (user.currentSegmentStart === null) {
        user.currentSegmentStart = currentSample;
        user.currentSegmentLength = 0;
      } else {
        const expectedSample = user.currentSegmentStart + user.currentSegmentLength;
        if (currentSample > expectedSample + JITTER_SAMPLES) {
          user.segments.push({ startSample: user.currentSegmentStart, length: user.currentSegmentLength });
          user.currentSegmentStart = currentSample;
          user.currentSegmentLength = 0;
        }
      }

      writeSync(user.fd, pcm);
      user.currentSegmentLength += samples;
    } catch (err) {
      console.error(`Opus decode error for ${user.displayName}:`, err);
      // Replace the decoder in case its internal state is corrupted, so
      // subsequent packets have a chance to decode successfully instead of
      // repeating the same failure and eventually crashing the process.
      try {
        destroyOpusDecoder(user.decoder);
      } catch {
        // ignore
      }
      user.decoder = createOpusDecoder(CHANNELS);
    }
  });

  audioStream.on('end', () => {
    user.subscribed = false;
    user.audioStream = undefined;
  });

  audioStream.on('error', (err) => {
    console.error(`Audio stream error for ${user.displayName}:`, err);
    user.subscribed = false;
    user.audioStream = undefined;
  });
}

export async function stopRecording(): Promise<RecordingFile[]> {
  const rec = activeRecording;
  if (!rec) {
    throw new Error('Es läuft keine Aufnahme');
  }
  if (rec.stopping) {
    return [];
  }

  rec.stopping = true;
  rec.connection.receiver.speaking.removeAllListeners();
  rec.connection.destroy();

  const files: RecordingFile[] = [];

  for (const user of rec.users.values()) {
    if (user.audioStream && !user.audioStream.destroyed) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 500);
        user.audioStream!.once('end', () => {
          clearTimeout(timeout);
          resolve();
        });
      }).catch(() => {
        // ignore
      });
    }

    if (user.currentSegmentStart !== null && user.currentSegmentLength > 0) {
      user.segments.push({ startSample: user.currentSegmentStart, length: user.currentSegmentLength });
    }

    closeSync(user.fd);
    destroyOpusDecoder(user.decoder);

    const wavPath = user.pcmPath.replace(/\.pcm$/, '.wav');
    await writeWavFromPcm(user.pcmPath, wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH, user.segments);
    await removePcmFile(user.pcmPath);

    const fileStat = await import('node:fs/promises').then((m) => m.stat(wavPath));
    const duration = getWavDurationSeconds(fileStat.size);

    updateFile(user.fileId, { wavPath, duration });

    files.push({
      id: user.fileId,
      sessionId: rec.sessionId,
      userId: user.userId,
      displayName: user.displayName,
      pcmPath: user.pcmPath,
      wavPath,
      duration,
      transcriptPath: null,
    });
  }

  activeRecording = null;
  return files;
}
