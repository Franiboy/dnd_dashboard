import { Client, GatewayIntentBits, type VoiceBasedChannel, type VoiceState } from 'discord.js';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isOpusAvailable,
  makeSessionDir,
  ensureDir,
  writeWavFromPcm,
  removePcmFile,
  removeSegmentFile,
  getWavDurationSeconds,
  readSegmentState,
  type PcmSegment,
} from './audio.js';
import { startRecording, stopRecording, isRecording, getActiveRecording } from './recorder.js';
import {
  createSession,
  getSessionById,
  updateSession,
  getFilesBySessionId,
  createFile,
  updateFile,
  getRecordingConfig,
  listSessionsByStatus,
} from '../repositories/recordings.js';

import type { RecordingChannel, RecordingSession } from '../../shared/types.js';
import { BOT_TOKEN, GUILD_ID, RECORDINGS_DIR, isRecordingFeatureEnabled } from './config.js';
import { emitSessionsUpdated, emitStatusUpdated } from './recordingsEvents.js';
import { createLogger } from '../logger.js';

const log = createLogger('discord-bot');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

let botReady = false;
let botLoginStopped = false;
let cachedChannels: RecordingChannel[] | null = null;
let channelsCachedAt = 0;
const CHANNEL_CACHE_TTL = 60_000;

export function isBotEnabled(): boolean {
  return isRecordingFeatureEnabled();
}

export function startBot(): void {
  if (!isRecordingFeatureEnabled()) {
    log.info('Discord bot not configured; voice recording disabled.');
    return;
  }

  if (!isOpusAvailable()) {
    log.warn('@discordjs/opus is not installed; voice recording will not work.');
  }

  ensureDir(RECORDINGS_DIR);

  client.once('clientReady', () => {
    botReady = true;
    log.info(`Discord bot logged in as ${client.user?.tag}`);
  });

  client.on('error', (err) => {
    log.error('Discord bot error:', err);
  });

  client.on('voiceStateUpdate', (_oldState, _newState) => {
    handleVoiceStateUpdate(_oldState, _newState).catch((err) => {
      log.error('Voice state update handler failed:', err);
    });
  });

  void loginWithRetry();
}

const LOGIN_RETRY_MAX_DELAY_MS = 60_000;

async function loginWithRetry(): Promise<void> {
  let delayMs = 5_000;
  let attempt = 1;

  while (!botLoginStopped) {
    if (client.isReady()) {
      return;
    }

    try {
      await client.login(BOT_TOKEN);
      return;
    } catch (err) {
      if (botLoginStopped) return;
      log.error(
        `Discord bot login failed (attempt ${attempt}), retrying in ${Math.round(delayMs / 1000)}s:`,
        err
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, LOGIN_RETRY_MAX_DELAY_MS);
      attempt += 1;
    }
  }
}

export function getBotStatus(): { ready: boolean; enabled: boolean } {
  return { ready: botReady, enabled: isBotEnabled() };
}

export async function stopBot(): Promise<void> {
  botLoginStopped = true;
  try {
    await client.destroy();
  } catch (err) {
    log.error('Discord client destroy failed:', err);
  } finally {
    botReady = false;
  }
}

export function getMonitoredChannel(): { channelId: string | null; channelName: string | null } {
  const config = getRecordingConfig();
  if (!config.channelId) return { channelId: null, channelName: null };

  const guild = getGuild();
  if (!guild) return { channelId: config.channelId, channelName: null };

  const channel = guild.channels.cache.get(config.channelId) as VoiceBasedChannel | undefined;
  return {
    channelId: config.channelId,
    channelName: channel?.name ?? null,
  };
}

function getGuild() {
  if (!GUILD_ID) return undefined;
  return client.guilds.cache.get(GUILD_ID);
}

export async function getVoiceChannels(): Promise<RecordingChannel[]> {
  const guild = getGuild();
  if (!guild) return [];

  if (cachedChannels && Date.now() - channelsCachedAt < CHANNEL_CACHE_TTL) {
    return cachedChannels;
  }

  try {
    await guild.channels.fetch();
  } catch {
    // ignore fetch errors, use cache
  }

  const voiceChannels = guild.channels.cache.filter((channel) => channel.isVoiceBased());
  const channels: RecordingChannel[] = [];

  for (const channel of voiceChannels.values()) {
    const voiceStates = guild.voiceStates.cache.filter((state) => state.channelId === channel.id);
    if (voiceStates.size === 0) continue;

    const participants: string[] = [];
    for (const state of voiceStates.values()) {
      let member = state.member ?? guild.members.cache.get(state.id);
      if (!member) {
        try {
          member = await guild.members.fetch(state.id);
        } catch {
          // member not fetchable, fallback below
        }
      }
      const displayName =
        member?.displayName ??
        member?.user.username ??
        client.users.cache.get(state.id)?.username ??
        state.id;
      participants.push(displayName);
    }

    participants.sort((a, b) => a.localeCompare(b));
    channels.push({ id: channel.id, name: channel.name, participants });
  }

  channels.sort((a, b) => a.name.localeCompare(b.name));

  cachedChannels = channels;
  channelsCachedAt = Date.now();
  return channels;
}

export async function getAllVoiceChannels(): Promise<RecordingChannel[]> {
  const guild = getGuild();
  if (!guild) return [];

  try {
    await guild.channels.fetch();
  } catch {
    // ignore fetch errors, use cache
  }

  const voiceChannels = guild.channels.cache.filter((channel) => channel.isVoiceBased());
  const channels: RecordingChannel[] = [];

  for (const channel of voiceChannels.values()) {
    const voiceStates = guild.voiceStates.cache.filter((state) => state.channelId === channel.id);
    const participants: string[] = [];
    for (const state of voiceStates.values()) {
      const member = state.member;
      const displayName =
        member?.displayName ??
        member?.user.username ??
        client.users.cache.get(state.id)?.username ??
        state.id;
      participants.push(displayName);
    }
    participants.sort((a, b) => a.localeCompare(b));
    channels.push({ id: channel.id, name: channel.name, participants });
  }

  channels.sort((a, b) => a.name.localeCompare(b.name));
  return channels;
}

function isBotUser(userId: string): boolean {
  return client.user?.id === userId;
}

function isChannelEmpty(channel: VoiceBasedChannel): boolean {
  return channel.members.filter((member) => !member.user.bot).size === 0;
}

function generateAutoSessionName(): string {
  const now = new Date();
  return `DnD Session ${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE')}`;
}

async function autoStartRecording(channel: VoiceBasedChannel): Promise<void> {
  if (isRecording()) return;

  try {
    await beginRecording(channel.id, generateAutoSessionName(), 'auto');
    log.info(`Auto-started recording in channel ${channel.name}`);
  } catch (err) {
    log.error(`Auto-start recording failed for channel ${channel.id}:`, err);
  }
}

async function autoStopRecordingIfEmpty(channelId: string): Promise<void> {
  const active = getActiveRecording();
  if (!active || active.channelId !== channelId) return;

  const guild = getGuild();
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
  if (!channel) return;

  if (!isChannelEmpty(channel)) return;

  try {
    await finishRecording(active.sessionId);
    log.info(`Auto-stopped recording in channel ${channel.name}`);
  } catch (err) {
    log.error(`Auto-stop recording failed for session ${active.sessionId}:`, err);
  }
}

async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
  if (!isRecordingFeatureEnabled() || !botReady) return;

  const config = getRecordingConfig();
  if (!config.channelId) return;

  const monitoredChannelId = config.channelId;
  const userId = oldState.id ?? newState.id;
  if (!userId || isBotUser(userId)) return;

  const guild = getGuild();
  if (!guild) return;

  const joinedMonitored =
    newState.channelId === monitoredChannelId && oldState.channelId !== monitoredChannelId;
  const leftMonitored =
    oldState.channelId === monitoredChannelId && newState.channelId !== monitoredChannelId;

  if (!joinedMonitored && !leftMonitored) return;

  if (joinedMonitored) {
    const channel = guild.channels.cache.get(monitoredChannelId) as VoiceBasedChannel | undefined;
    if (channel) {
      await autoStartRecording(channel);
    }
  }

  if (leftMonitored) {
    await autoStopRecordingIfEmpty(monitoredChannelId);
  }
}

export async function beginRecording(
  channelId: string,
  sessionName: string,
  createdBy: string
): Promise<RecordingSession> {
  if (isRecording()) {
    throw new Error('Es läuft bereits eine Aufnahme');
  }

  const guild = getGuild();
  if (!guild) {
    throw new Error('Discord-Server nicht gefunden; überprüfe DISCORD_GUILD_ID');
  }

  let channel: VoiceBasedChannel | undefined;
  try {
    const fetched = await guild.channels.fetch(channelId);
    if (fetched?.isVoiceBased()) {
      channel = fetched;
    }
  } catch {
    // ignore
  }

  if (!channel) {
    channel = guild.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
  }

  if (!channel) {
    throw new Error('Voice-Channel nicht gefunden');
  }

  const session = createSession({
    name: sessionName,
    guildId: guild.id,
    channelId: channel.id,
    createdBy,
    directory: RECORDINGS_DIR,
  });

  const directory = makeSessionDir(RECORDINGS_DIR, session.id);
  updateSession(session.id, { directory });

  await startRecording(guild, channel, session.id, directory, async (disconnectedSessionId) => {
    try {
      await finishRecording(disconnectedSessionId);
    } catch (err) {
      log.error(
        `Failed to finish recording after disconnect for session ${disconnectedSessionId}:`,
        err
      );
    }
  });

  emitStatusUpdated();
  emitSessionsUpdated();

  return getSessionById(session.id)!;
}

function reconstructSegments(
  pcmPath: string,
  pcmSize: number,
  sampleRate: number,
  channels: number,
  bitDepth: number
): PcmSegment[] | undefined {
  const state = readSegmentState(pcmPath);
  if (!state || state.version !== 1 || !Array.isArray(state.segments)) {
    return undefined;
  }

  const validSegments: PcmSegment[] = [];
  for (const segment of state.segments) {
    if (
      segment &&
      Number.isFinite(segment.startSample) &&
      Number.isInteger(segment.startSample) &&
      segment.startSample >= 0 &&
      Number.isFinite(segment.length) &&
      Number.isInteger(segment.length) &&
      segment.length > 0
    ) {
      validSegments.push({ startSample: segment.startSample, length: segment.length });
    }
  }

  if (validSegments.length === 0) {
    return undefined;
  }

  validSegments.sort((a, b) => a.startSample - b.startSample);

  const bytesPerSample = (channels * bitDepth) / 8;
  const totalSamples = Math.floor(pcmSize / bytesPerSample);
  const closedSamples = validSegments.reduce((sum, segment) => sum + segment.length, 0);
  const currentLength = Math.max(0, totalSamples - closedSamples);

  if (currentLength > 0) {
    const maxEnd =
      validSegments.length > 0
        ? validSegments[validSegments.length - 1].startSample +
          validSegments[validSegments.length - 1].length
        : 0;
    let currentStart = state.currentStart;
    if (
      typeof currentStart !== 'number' ||
      !Number.isFinite(currentStart) ||
      !Number.isInteger(currentStart) ||
      currentStart < 0
    ) {
      currentStart = maxEnd;
    } else if (currentStart < maxEnd) {
      currentStart = maxEnd;
    }
    return [...validSegments, { startSample: currentStart, length: currentLength }];
  }

  return validSegments;
}

async function recoverRecording(sessionId: number): Promise<RecordingSession> {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error('Aufnahme nicht gefunden');
  }
  if (session.status !== 'recording') {
    return session;
  }

  const directory = session.directory;
  if (!directory) {
    updateSession(sessionId, { status: 'error', error: 'Kein Aufnahmeverzeichnis hinterlegt.' });
    emitSessionsUpdated();
    throw new Error('Kein Aufnahmeverzeichnis hinterlegt');
  }

  ensureDir(directory);

  const SAMPLE_RATE = 48000;
  const CHANNELS = 2;
  const BIT_DEPTH = 16;

  const dbFiles = getFilesBySessionId(sessionId);
  const recovered: { id: number; wavPath: string; duration: number }[] = [];

  for (const file of dbFiles) {
    try {
      const wavPath = file.pcmPath.replace(/\.pcm$/, '.wav');
      let resolvedWavPath: string | null = null;
      let resolvedDuration: number | null = null;

      // Prefer the source PCM if it still exists: re-convert to ensure the WAV is fresh.
      let pcmStat: { size: number } | null = null;
      try {
        pcmStat = await stat(file.pcmPath);
      } catch {
        // pcm missing
      }

      if (pcmStat) {
        const segments = reconstructSegments(
          file.pcmPath,
          pcmStat.size,
          SAMPLE_RATE,
          CHANNELS,
          BIT_DEPTH
        );
        await writeWavFromPcm(file.pcmPath, wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH, segments);
        await removePcmFile(file.pcmPath);
        removeSegmentFile(file.pcmPath);
        await stat(wavPath);
        resolvedDuration = getWavDurationSeconds(wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
        resolvedWavPath = wavPath;
      } else if (file.wavPath) {
        try {
          await stat(file.wavPath);
          resolvedWavPath = file.wavPath;
          resolvedDuration = getWavDurationSeconds(file.wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
        } catch {
          // recorded wav missing too
        }
      } else {
        try {
          await stat(wavPath);
          resolvedWavPath = wavPath;
          resolvedDuration = getWavDurationSeconds(wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
        } catch {
          // no audio data for this file
        }
      }

      if (resolvedWavPath !== null) {
        if (resolvedWavPath !== file.wavPath || resolvedDuration !== file.duration) {
          updateFile(file.id, { wavPath: resolvedWavPath, duration: resolvedDuration });
        }
        recovered.push({ id: file.id, wavPath: resolvedWavPath, duration: resolvedDuration ?? 0 });
      }
    } catch (err) {
      log.error(`Failed to recover file ${file.id} for session ${sessionId}:`, err);
    }
  }

  let filesOnDisk: string[] = [];
  try {
    filesOnDisk = await readdir(directory);
  } catch {
    filesOnDisk = [];
  }
  const knownPcmPaths = new Set(dbFiles.map((f) => f.pcmPath));
  for (const fileName of filesOnDisk) {
    if (!fileName.endsWith('.pcm')) continue;
    const pcmPath = join(directory, fileName);
    if (knownPcmPaths.has(pcmPath)) continue;
    try {
      const match = fileName.match(/^user-(.+)\.pcm$/);
      const userId = match ? match[1] : fileName.replace(/\.pcm$/, '');
      const fileRow = createFile({ sessionId, userId, displayName: userId, pcmPath });
      const wavPath = pcmPath.replace(/\.pcm$/, '.wav');
      const pcmStat = await stat(pcmPath);
      const segments = reconstructSegments(pcmPath, pcmStat.size, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
      await writeWavFromPcm(pcmPath, wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH, segments);
      await removePcmFile(pcmPath);
      removeSegmentFile(pcmPath);
      const duration = getWavDurationSeconds(wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
      updateFile(fileRow.id, { wavPath, duration });
      recovered.push({ id: fileRow.id, wavPath, duration });
    } catch (err) {
      log.error(`Failed to recover on-disk file ${fileName} for session ${sessionId}:`, err);
    }
  }

  const stoppedAt = new Date().toISOString();
  if (recovered.length === 0) {
    updateSession(sessionId, {
      status: 'error',
      stoppedAt,
      error: 'Aufnahme wurde unterbrochen; keine Audio-Daten gefunden.',
    });
    emitSessionsUpdated();
    throw new Error('Aufnahme wurde unterbrochen; keine Audio-Daten gefunden');
  }

  updateSession(sessionId, { status: 'pending_transcription', stoppedAt });
  emitStatusUpdated();
  emitSessionsUpdated();

  const updated = getSessionById(sessionId);
  if (!updated) {
    throw new Error('Aufnahme nicht gefunden');
  }
  return updated;
}

export async function recoverAllRecordings(): Promise<void> {
  let recordingSessions: RecordingSession[];
  try {
    recordingSessions = listSessionsByStatus('recording');
  } catch (err) {
    log.error('Failed to list recording sessions for recovery:', err);
    return;
  }

  if (recordingSessions.length === 0) {
    return;
  }

  log.info(`Recovering ${recordingSessions.length} recording session(s) after restart/shutdown`);

  for (const session of recordingSessions) {
    try {
      const active = getActiveRecording();
      if (active && active.sessionId === session.id) {
        await finishRecording(session.id);
      } else {
        await recoverRecording(session.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to recover recording session ${session.id}:`, err);
      updateSession(session.id, {
        status: 'error',
        stoppedAt: new Date().toISOString(),
        error: message,
      });
      emitSessionsUpdated();
    }
  }
}

export async function finishRecording(sessionId: number): Promise<RecordingSession> {
  const rec = getActiveRecording();
  if (!rec) {
    return recoverRecording(sessionId);
  }
  if (rec.sessionId !== sessionId) {
    throw new Error('Diese Session ist nicht aktiv');
  }

  const files = await stopRecording();

  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error('Aufnahme nicht gefunden');
  }
  if (session.status !== 'recording') {
    return session;
  }

  const stoppedAt = new Date().toISOString();
  if (files.length === 0) {
    updateSession(sessionId, {
      status: 'error',
      stoppedAt,
      error: 'Keine Audio-Daten aufgezeichnet.',
    });
    emitSessionsUpdated();
    throw new Error('Keine Audio-Daten aufgezeichnet');
  }

  updateSession(sessionId, { status: 'pending_transcription', stoppedAt });

  emitStatusUpdated();
  emitSessionsUpdated();

  const updated = getSessionById(sessionId);
  if (!updated) {
    throw new Error('Aufnahme nicht gefunden');
  }
  return updated;
}

export { getActiveRecording };
