# AGENTS.md – D&D Dashboard

This file describes the project, important conventions and working rules for assistants/developers. **Last updated:** 2026-07-29.

## Critical Working Rules for Assistants

These rules take precedence before every code change.

- **Develop every change in a separate Git worktree on its own branch.** Do not work directly in `main`. Create a worktree with `git worktree add <path> -b <branch-name>`, develop and commit in it; after explicit user confirmation merge the branch into `main` and remove the worktree.
- **No commits without explicit user approval.**
- **No push without explicit user approval.**
- **No force-push, branch deletions or history rewrites without approval.**
- Check `git diff` before every approved commit.
- Never commit `.env`, databases (`*.db`), secrets or build artifacts (`dist/`, `dist-server/`).
- Do not push changes to `main` on production environments without approval.
- Ask the user before committing/pushing if anything is unclear.
- Give a short summary of changes after completing a task.
- **All commit messages and code comments must be in English.**

## Project Overview

D&D Dashboard is a web application for Dungeons & Dragons sessions with several modules:

- **Bingo:** Shared, password-protected real-time bingo mode.
- **Diary & World:** Diary entries with AI-assisted rewriting, summarizing, entity extraction and a knowledge graph for people, organizations and places.
- **Recordings:** Discord-bot based voice recordings with Whisper transcription.
- **Admin:** User management, app permissions and live logs.

### Tech Stack

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS 4, Socket.io Client
- **Backend:** Node.js 22+, Express 5, SQLite (better-sqlite3), Socket.io
- **Auth:** JWT (`httpOnly` cookie + Bearer header), bcrypt, Discord OAuth2
- **AI/MCP:** OpenCode-CLI, `@modelcontextprotocol/sdk`, custom MCP server with dynamic scopes (`server/mcp/`)
- **Discord:** `discord.js` + `@discordjs/voice` for voice recordings
- **Realtime:** Socket.io (Bingo), SSE (Admin-Users, Admin-Logs)
- **Module system:** ESM (`"type": "module"` in `package.json`)

## Important Commands

```bash
npm install              # Install dependencies
npm run dev              # Server + client in dev mode (concurrently)
npm run server           # Server with tsx (single run)
npm run server:watch     # Server with tsx and Node --watch
npm run client           # Vite dev server only
npm run build            # Client (tsc + vite build) + server + version.json
npm run build:server     # Build server only
npm run build:version    # Writes dist-server/version.json from Git commit count
npm run start            # Production server (requires prior build)
npm run preview          # Vite production preview
npm run test:server      # Start server with separate test DB
npx oxlint               # Optional: run Oxlint manually
```

**Dev URLs:**

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`
- Vite proxies `/api` and `/socket.io` to the server.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) – File structure and architecture overview
- [`docs/environment.md`](./docs/environment.md) – `.env` variables and their meaning
- [`docs/security.md`](./docs/security.md) – Security rules
- [`docs/conventions.md`](./docs/conventions.md) – Project conventions
- [`docs/apps.md`](./docs/apps.md) – App navigator and admin/user rules
- [`docs/features.md`](./docs/features.md) – Bingo, diary/world and recording modules
- [`docs/sse.md`](./docs/sse.md) – Server-Sent Events pattern and endpoints
- [`docs/edge-cases.md`](./docs/edge-cases.md) – Known edge cases and protected files
- [`CodingStandards.md`](./CodingStandards.md) – Code style, import conventions and quality guidelines
- [`README.md`](./README.md) – End-user setup and feature overview

Update these files when architecture, features, environment variables or security rules change significantly.
