export const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
export const GUILD_ID = process.env.DISCORD_GUILD_ID;
export const RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'recordings';

export function isRecordingFeatureEnabled(): boolean {
  return !!BOT_TOKEN && !!GUILD_ID;
}
