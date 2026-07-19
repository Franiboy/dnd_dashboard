import { Client, GatewayIntentBits, type VoiceBasedChannel } from 'discord.js';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isOpusAvailable, makeSessionDir, ensureDir, writeWavFromPcm } from './audio.js';
import { startRecording, stopRecording, isRecording, getActiveRecording } from './recorder.js';
import { createSession, getSessionById, updateSession, getFilesBySessionId, createFile, updateFile } from '../repositories/recordings.js';

import type { RecordingChannel, RecordingSession } from '../../shared/types.js';
import { BOT_TOKEN, GUILD_ID, RECORDINGS_DIR, isRecordingFeatureEnabled } from './config.js';
import { emitSessionsUpdated, emitStatusUpdated } from './recordingsEvents.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

let botReady = false;
let cachedChannels: RecordingChannel[] | null = null;
let channelsCachedAt = 0;
const CHANNEL_CACHE_TTL = 60_000;

export function isBotEnabled(): boolean {
  return isRecordingFeatureEnabled();
}

export function startBot(): void {
  if (!isRecordingFeatureEnabled()) {
    console.log('Discord bot not configured; voice recording disabled.');
    return;
  }

  if (!isOpusAvailable()) {
    console.warn('opusscript is not installed; voice recording will not work.');
  }

  ensureDir(RECORDINGS_DIR);

  client.once('ready', () => {
    botReady = true;
    console.log(`Discord bot logged in as ${client.user?.tag}`);
  });

  client.on('error', (err) => {
    console.error('Discord bot error:', err);
  });

  client.login(BOT_TOKEN).catch((err) => {
    console.error('Discord bot login failed:', err);
  });
}

export function getBotStatus(): { ready: boolean; enabled: boolean } {
  return { ready: botReady, enabled: isBotEnabled() };
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
      const displayName = member?.displayName ?? member?.user.username ?? client.users.cache.get(state.id)?.username ?? state.id;
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

export async function beginRecording(
  channelId: string,
  sessionName: string,
  createdBy: string,
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
      console.error(`Failed to finish recording after disconnect for session ${disconnectedSessionId}:`, err);
    }
  });

  emitStatusUpdated();
  emitSessionsUpdated();

  return getSessionById(session.id)!;
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
  const bytesPerSecond = (SAMPLE_RATE * CHANNELS * BIT_DEPTH) / 8;

  const dbFiles = getFilesBySessionId(sessionId);
  const recovered: { id: number; wavPath: string; duration: number }[] = [];

  for (const file of dbFiles) {
    if (file.wavPath) continue;
    try {
      await stat(file.pcmPath);
    } catch {
      continue;
    }
    const wavPath = file.pcmPath.replace(/\.pcm$/, '.wav');
    await writeWavFromPcm(file.pcmPath, wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
    const fileStat = await stat(wavPath);
    const duration = Math.max(0, fileStat.size - 44) / bytesPerSecond;
    updateFile(file.id, { wavPath, duration });
    recovered.push({ id: file.id, wavPath, duration });
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
    const match = fileName.match(/^user-(.+)\.pcm$/);
    const userId = match ? match[1] : fileName.replace(/\.pcm$/, '');
    const fileRow = createFile({ sessionId, userId, displayName: userId, pcmPath });
    const wavPath = pcmPath.replace(/\.pcm$/, '.wav');
    await writeWavFromPcm(pcmPath, wavPath, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
    const fileStat = await stat(wavPath);
    const duration = Math.max(0, fileStat.size - 44) / bytesPerSecond;
    updateFile(fileRow.id, { wavPath, duration });
    recovered.push({ id: fileRow.id, wavPath, duration });
  }

  const stoppedAt = new Date().toISOString();
  if (recovered.length === 0) {
    updateSession(sessionId, { status: 'error', stoppedAt, error: 'Aufnahme wurde unterbrochen; keine Audio-Daten gefunden.' });
    emitSessionsUpdated();
    throw new Error('Aufnahme wurde unterbrochen; keine Audio-Daten gefunden');
  }

  updateSession(sessionId, { status: 'pending_transcription', stoppedAt });
  emitStatusUpdated();
  emitSessionsUpdated();

  return getSessionById(sessionId)!;
}

export async function finishRecording(sessionId: number): Promise<RecordingSession> {
  const rec = getActiveRecording();
  if (!rec) {
    return recoverRecording(sessionId);
  }
  if (rec.sessionId !== sessionId) {
    throw new Error('Diese Session ist nicht aktiv');
  }

  await stopRecording();
  const stoppedAt = new Date().toISOString();
  updateSession(sessionId, { status: 'pending_transcription', stoppedAt });

  emitStatusUpdated();
  emitSessionsUpdated();

  return getSessionById(sessionId)!;
}

export { getActiveRecording };
