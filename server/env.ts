import { z, ZodError } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const positiveIntFromEnv = z
  .string()
  .optional()
  .transform((v) => {
    if (!v || v.trim() === '') return undefined;
    const num = Number(v);
    return Number.isInteger(num) && num > 0 ? num : undefined;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DND_RUN_MIGRATIONS_ON_STARTUP: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  PORT: z.coerce.number().int().positive().default(3001),
  LISTEN_FDS: z.coerce.number().int().nonnegative().default(0),
  DB_PATH: z.string().default('dnd.db'),
  RECORDINGS_DIR: z.string().default('recordings'),
  WHITEBOARD_UPLOAD_DIR: z.string().default('data/whiteboard'),
  TRUST_PROXY: booleanFromEnv,
  CORS_ORIGIN: z.string().optional(),

  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN_DAYS: positiveIntFromEnv,
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  MCP_TOKEN_SECRET: z.string().optional(),
  MCP_SESSION_TOKEN: z.string().optional(),
  DEV_AUTO_LOGIN: booleanFromEnv,

  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_REDIRECT_URI: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_TOKEN_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),

  AI_PROVIDER: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_OPENCODE_BIN: z.string().optional(),

  BINGO_SUGGESTION_TARGET: z.coerce.number().int().positive().optional(),
  BINGO_SUGGESTION_THRESHOLD: z.coerce.number().int().positive().optional(),
  BINGO_SUGGESTION_BATCH: z.coerce.number().int().positive().optional(),

  // Bootstrap fallback only; the persisted Admin UI language is authoritative.
  // `auto` remains accepted as a legacy compatibility alias and normalizes to
  // the safe German default when no persisted setting exists.
  WHISPER_LANGUAGE: z.enum(['de', 'en', 'auto']).default('de'),
  WHISPER_MODEL: z.string().default('base'),
  PYTHON_COMMAND: z.string().optional(),
  WHISPER_FP16: booleanFromEnv,
  WHISPER_INITIAL_PROMPT: z.string().optional(),
  WHISPER_NOISE_REDUCE: booleanFromEnv,
  WHISPER_VAD_MIN_SILENCE: z.coerce.number().optional(),
  WHISPER_VAD_MIN_SPEECH: z.coerce.number().optional(),
  WHISPER_FILTER_NO_SPEECH_PROB: z.coerce.number().optional(),
  WHISPER_COMPUTE_TYPE: z.enum(['int8', 'int8_float16', 'float16', 'float32']).optional(),

  LOG_RETENTION_MAX: z.coerce.number().int().positive().default(100000),
});

let parsedEnv: { success: true; data: z.infer<typeof envSchema> } | { success: false } | null =
  null;

export function parseEnv(source: Record<string, string | undefined>): {
  success: boolean;
  data?: z.infer<typeof envSchema>;
  error?: ZodError;
} {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

export function validateEnv(): void {
  if (parsedEnv) return;
  const result = parseEnv(process.env);
  if (!result.success) {
    const issues = result
      .error!.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  parsedEnv = { success: true, data: result.data! };
}

export function getEnv(): z.infer<typeof envSchema> {
  validateEnv();
  if (parsedEnv && parsedEnv.success) {
    return parsedEnv.data;
  }
  const result = parseEnv(process.env);
  if (result.success && result.data) return result.data;
  throw new Error('Invalid environment configuration');
}

/**
 * Local development convenience switch. The automatic admin login is only
 * offered when explicitly enabled and never in production.
 */
export function isDevAutoLoginEnabled(): boolean {
  return getEnv().NODE_ENV !== 'production' && getEnv().DEV_AUTO_LOGIN;
}
