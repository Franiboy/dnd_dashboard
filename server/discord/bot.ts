import { Client, GatewayIntentBits, type VoiceBasedChannel } from 'discord.js';
import { isOpusAvailable, makeSessionDir, ensureDir } from './audio.js';
import { startRecording, stopRecording, isRecording, getActiveRecording } from './recorder.js';
import { createSession, getSessionById, updateSession } from '../repositories/recordings.js';

import type { RecordingChannel, RecordingSession } from '../../shared/types.js';
import { BOT_TOKEN, GUILD_ID, RECORDINGS_DIR, isRecordingFeatureEnabled } from './config.js';

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

  const channels = guild.channels.cache
    .filter((channel) => channel.isVoiceBased())
    .map((channel) => ({ id: channel.id, name: channel.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

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

  await startRecording(guild, channel, session.id, directory);

  return getSessionById(session.id)!;
}

export async function finishRecording(sessionId: number): Promise<RecordingSession> {
  const rec = getActiveRecording();
  if (!rec || rec.sessionId !== sessionId) {
    throw new Error('Diese Session ist nicht aktiv');
  }

  await stopRecording();
  const stoppedAt = new Date().toISOString();
  updateSession(sessionId, { status: 'pending_transcription', stoppedAt });

  return getSessionById(sessionId)!;
}

export { getActiveRecording };
