# Environment Variables

Copy `.env.example` to `.env` and adjust the values:

```bash
PORT=3001
JWT_SECRET=change-me-in-production
# Number of days until the dashboard login session expires (default: 7)
JWT_EXPIRES_IN_DAYS=7
# Required if Discord OAuth is configured. Must be a base64-encoded 32-byte key.
# Generate with: openssl rand -base64 32
TOKEN_ENCRYPTION_KEY=
# Required: password for the default 'admin' account
ADMIN_PASSWORD=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord

# Discord bot for voice recording (optional)
# Can be the same Discord application as the OAuth2 login. The bot token
# can be found in the "Bot" tab of the app and is not the same as CLIENT_SECRET.
# The bot needs permissions: Connect, Speak, View Channel, Use Voice Activity.
DISCORD_BOT_TOKEN=
# Discord server ID where recordings should take place
DISCORD_GUILD_ID=
# Language for Whisper transcription (de, en, auto, ...)
WHISPER_LANGUAGE=de
# Model size for local Whisper (tiny, base, small, medium, large)
WHISPER_MODEL=base
# Python executable for the Whisper transcription script. Automatically
# detected (python3, python, ...) if not set.
# PYTHON_COMMAND=python3
# Enable FP16 acceleration for Whisper (true/false). Default: false
# WHISPER_FP16=false

# AI (optional)
AI_PROVIDER=opencode
# Set to a real model, e.g. anthropic/claude-sonnet-4-20250514
AI_MODEL=opencode/deepseek-v4-flash-free
# Optional: cheaper model for short AI tasks like diary summaries and bingo suggestions.
# If not set, AI_MODEL is used.
AI_CHEAP_MODEL=opencode/deepseek-v4-flash-free
# OpenCode CLI binary. Defaults to `opencode` (V1 CLI).
# Set to `opencode2` to use the V2 CLI. In V2 mode the CLI talks to a running
# `opencode2` background service (started via `opencode2 service start` or
# `opencode2 serve --service`), enabling reusable and deletable sessions.
# AI runs themselves use `--standalone` (private per-run server) so the
# per-run MCP token and user context keep working; the background service
# serves session listing and cleanup.
# AI_OPENCODE_BIN=opencode

# Bingo AI suggestions (optional)
# Number of suggestions to keep pre-generated in the pool.
# BINGO_SUGGESTION_TARGET=20
# Threshold at which the pool is refilled in the background.
# BINGO_SUGGESTION_THRESHOLD=5
# Number of suggestions generated per refill batch.
# BINGO_SUGGESTION_BATCH=15

# CORS / frontend origin (optional)
# In production, only allows requests from the given origins (comma-separated).
# If not set, no cross-origin requests are allowed in production.
# CORS_ORIGIN=http://localhost:3001,https://example.com

# Logging (optional)
# Maximum number of persistent log entries in the SQLite database.
# Oldest entries are automatically deleted when the limit is exceeded.
# LOG_RETENTION_MAX=100000

# MCP (optional, used for AI tool use)
# If not set, JWT_SECRET is used.
# MCP_TOKEN_SECRET=change-me-in-production
```

## Variable Reference

> All variables validated at server startup against the `zod` schema in `server/env.ts`. Invalid values abort startup with a descriptive error. When unset, variables below use their documented defaults.

- `PORT` is optional, default is `3001`.
- `JWT_SECRET` must be set, otherwise the server will not start.
- `JWT_EXPIRES_IN_DAYS` controls how long a dashboard login session remains valid (default: 7).
- `TOKEN_ENCRYPTION_KEY` is required when Discord OAuth is configured. It is used to encrypt stored Discord access/refresh tokens at rest. It must be a base64-encoded 32-byte key (e.g. the output of `openssl rand -base64 32`).
- `ADMIN_PASSWORD` must be set, otherwise `ensureAdminUser()` will not start.
- `DISCORD_*` must be configured for Discord login.
- `DISCORD_TOKEN_REFRESH_INTERVAL_MS` controls how often stored Discord OAuth tokens are refreshed and profile data is synced (default: 3600000, 1 hour).
- `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` enable the recording bot.
- `WHISPER_*` configure local transcription. `WHISPER_VAD_*` tune the ffmpeg silence detector that removes long pauses before Whisper processes the audio, which greatly reduces repeated hallucinations.
- `AI_PROVIDER` must be `opencode` and `AI_MODEL` must be set to a valid model (e.g. `opencode/deepseek-v4-flash-free`) for AI to be enabled. Values starting with `provider/…` are placeholders and keep AI disabled.
- `AI_CHEAP_MODEL` is used for short AI tasks (summaries, entities).
- `AI_CHEAP_MODEL` is also used for bingo suggestion generation.
- `AI_OPENCODE_BIN` overrides the `opencode` command. Set it to `opencode2` to use the V2 CLI. In V2 mode the CLI uses a running `opencode2` background service so sessions can be reused and cleaned up; start it with `opencode2 service start`.
- Normal and cheap model can also be overridden persistently at runtime in the Admin UI (section "KI-Modelle"). The selected values are stored in the `ai_settings` table and take precedence over `AI_MODEL` / `AI_CHEAP_MODEL`.
- `BINGO_SUGGESTION_TARGET`, `BINGO_SUGGESTION_THRESHOLD`, and `BINGO_SUGGESTION_BATCH` configure the pre-generated suggestion pool (defaults: 20, 5, 15).
- `MCP_TOKEN_SECRET` defaults to `JWT_SECRET`.
- Optional: `CORS_ORIGIN` for allowed cross-origin origins (comma-separated). If not set, development allows only `http://localhost:5173` and `http://localhost:3001`; in production no cross-origin requests are allowed.
- Optional: `VITE_SERVER_URL` for the Socket.io client in the frontend.
- Optional: `DB_PATH=dnd_test.db` for tests or a separate database.
- Optional: `NODE_ENV=production` enables static serving of `dist/`.
- Optional: `LOG_RETENTION_MAX` limits the number of persistent log entries (default: 100,000).
