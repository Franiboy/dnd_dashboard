# D&D Dashboard

Web-based dashboard for Dungeons & Dragons with multiple modules: Bingo, Diary/World (AI-assisted), Discord voice recordings and admin management.

## Features

- Discord OAuth2 login
- Admin approval for new Discord users
- JWT authentication via cookie and auth header
- Admin panel for user management (approve, lock, admin rights, delete, app permissions)
- Admin login via Easter egg (click the title 5 times)
- Real-time Bingo with Socket.io (game start, grid size, reset)
- Shared task pool
- Player list
- Brute-force protection via rate limiting and account lockout
- Diary entries with AI-assisted rewriting, summarizing and entity extraction
- Knowledge graph for people, organizations and places
- Discord bot for voice recordings with Whisper transcription

## Tech Stack

- **Backend:** Node.js 22+, Express 5, SQLite (better-sqlite3), Socket.io
- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS 4
- **Realtime:** Socket.io, Server-Sent Events (SSE)
- **Auth:** JWT, bcrypt, Discord OAuth2
- **AI/MCP:** OpenCode-CLI, `@modelcontextprotocol/sdk`, custom MCP server
- **Discord:** discord.js, @discordjs/voice

## Requirements

- Node.js >= 22
- npm
- For AI: [OpenCode](https://github.com/opencode-ai/opencode) CLI installed and in PATH
- For AI: [ProjectAtlas](https://github.com/styler-ai/ProjectAtlas) repository intelligence (installed automatically by `npm run setup:atlas`)
- For recordings: Discord bot token, Python + ffmpeg + OpenAI Whisper

## Installation

```bash
npm install
```

Install the standard local repository intelligence for AI agents
(ProjectAtlas: index, MCP config merged into `opencode.json`):

```bash
npm run setup:atlas
```

Copy the example environment variables:

```bash
cp .env.example .env
```

Adjust `.env`:

```bash
PORT=3001
JWT_SECRET=change-me-in-production
ADMIN_PASSWORD=your-very-secure-password
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord
```

## Development

Start server and client together:

```bash
npm run dev
```

- Client runs on http://localhost:5173
- Server runs on http://localhost:3001

Start individually:

```bash
npm run server
npm run client
```

## Build

```bash
npm run build
```

Generates `dist/` (client) and `dist-server/` (server).

## Production

```bash
npm run build
npm start
```

The server then serves `dist/` and is reachable on the port configured in `PORT` (default 3001).

## Discord OAuth2

For Discord login you need to create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and set these values in `.env`:

```bash
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_REDIRECT_URI=http://localhost:5173/auth/discord
# Must be set for Discord OAuth; generate with: openssl rand -base64 32
TOKEN_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
```

Add `http://localhost:5173/auth/discord` under `OAuth2 → Redirects`.

Profile data (display name and avatar) and access/refresh tokens are refreshed automatically in the background; `DISCORD_TOKEN_REFRESH_INTERVAL_MS` controls the interval (default: 3600000 ms = 1 hour).

## Default Admin

An admin account is created on first start. The password is read from the environment variable `ADMIN_PASSWORD`.

- Username: `admin`
- Password: value of `ADMIN_PASSWORD` in `.env`

The default admin can be reached via an Easter egg: on the login page click the title 5 times, then the admin login link appears. The admin can approve, delete, grant admin rights and disable individual apps per user in the admin panel.

## Database

The SQLite database is created as `dnd.db` in the project root. It contains user, game, diary, entity and recording data and is listed in `.gitignore`.

For tests a separate database can be used:

```bash
DB_PATH=dnd_test.db npm run server
```

Or via script:

```bash
npm run test:server
```

## AI / Diary & World

The AI features require `AI_PROVIDER=opencode` and a valid `AI_MODEL`, e.g.:

```bash
AI_PROVIDER=opencode
AI_MODEL=anthropic/claude-sonnet-4-20250514
```

Optionally `AI_OPENCODE_BIN` can set the path to the OpenCode CLI. The model can also be changed at runtime in the Admin UI (SideDrawer section "KI-Modell"); that choice is stored in the database and takes precedence over `AI_MODEL`.

The AI uses a custom MCP server to call tools like `get_entity`, `set_diary_summary` and `create_knowledge`. The token for it is automatically generated from `JWT_SECRET` (or `MCP_TOKEN_SECRET`).

## Recordings

For the Discord voice recording bot:

```bash
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-guild-id
WHISPER_LANGUAGE=de
WHISPER_MODEL=base
```

The bot joins voice channels and stores recordings under `recordings/`. The scheduler automatically transcribes completed recordings with OpenAI Whisper.

## Tests

Tests run with [Vitest](https://vitest.dev). The server tests use an in-memory SQLite database (`DB_PATH=:memory:`); the client tests run in a `jsdom` environment.

```bash
npm test        # run all tests once
npm run test:watch  # run tests in watch mode
npm run test:server # start the server with a separate test database
```

Server and client test files live next to the code they test and use the `*.test.ts` or `*.test.tsx` extension. Shared setup and environment configuration is in `vitest.config.ts`.

## Important Files

- `server/index.ts` – Express and Socket.io setup, API routes
- `server/auth.ts` – JWT handling and middleware
- `server/users.ts` – user database and authentication
- `server/database.ts` – SQLite connection
- `server/game.ts` – Bingo game logic
- `server/socket.ts` – Socket.io handlers
- `server/routes/` – API routes (auth, admin, diary, entities, recordings, ai)
- `server/ai/` – AI prompts and OpenCode integration
- `server/mcp/` – MCP server for AI tools
- `server/discord/` – Discord bot and recording processing
- `shared/types.ts` – shared TypeScript types
- `src/App.tsx` – React app entry
- `src/lib/apps.ts` – app definitions
- `AGENTS.md` – developer working rules and documentation index
- `docs/` – detailed developer documentation (architecture, security, features, etc.)
