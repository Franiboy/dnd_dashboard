# AGENTS.md – D&D Dashboard

This file describes the project, important conventions and working rules for assistants/developers. **Last updated:** 2026-08-13.

## Critical Working Rules for Assistants

These rules take precedence before every code change.

- **If you are already in a Git worktree, use it; otherwise work in the current branch.** Check whether the current directory is a worktree (e.g. with `git worktree list`).
- **If you are in a worktree, clean it up after a successful merge and push.** After explicit user confirmation, merge the branch into `main`, then delete the merged feature branch (local and remote) and remove the worktree used for development.
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
npm run test             # Run all Vitest tests
npm run test:watch       # Run Vitest in watch mode
npm run test:server      # Start server with separate test DB
npm run format           # Format all files with Prettier
npm run format:check     # Check Prettier formatting
npm run check            # Guardrail: auto-format, auto-fix lint, run tests
npx oxlint               # Optional: run Oxlint manually
```

**Dev URLs:**

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`
- Vite proxies `/api` and `/socket.io` to the server.

## Guardrails for AI Assistants

Before committing any code change, run the guardrail command:

```bash
npm run check
```

This executes in sequence and modifies files in place:

1. `prettier --write .` – format all supported files
2. `oxlint --fix` – auto-fix lint issues
3. `vitest run` – unit and integration tests

After running `npm run check`, re-stage any changed files. The pre-commit hook also runs `lint-staged` (Prettier + `oxlint --fix`) on every commit.

For larger refactorings or before releases, also run:

```bash
npm run build
```

## ProjectAtlas (Repository Intelligence)

ProjectAtlas is the standard local repository-intelligence tool for coding agents in this project. It keeps a persistent SQLite map of folders, files, purposes, summaries, symbols and relations in the gitignored `.projectatlas/` directory. The shared scan configuration is committed in `projectatlas.toml`.

- **First-run setup:** after `npm install`, run `npm run setup:atlas`. It installs the pinned native runtime (v0.4.4), builds the index and merges the `projectatlas` MCP server into the local, git-ignored `opencode.json`.
- **Atlas-first workflow:** when the `atlas_*` MCP tools are available, use them before broad file reads – start with one compact `atlas_session_brief`, then follow its returned selectors down to the smallest exact source slice.
- **Refresh cadence:** run `projectatlas watch --once` (MCP: `atlas_watch_once`) after a batch of edits; a continuous `projectatlas watch` may run during long sessions.
- **Structure checks:** `projectatlas lint --purpose-level low` flags stale/duplicate purposes. Curate folder and high-impact file purposes during normal work with `projectatlas purpose set` / `atlas_purpose_set`.
- **Token impact:** `projectatlas token --view tui` shows the local saved-tokens dashboard.
- Never commit `.projectatlas/` (gitignored). Scan/ignore changes belong in the committed `projectatlas.toml`; ProjectAtlas inherits `.gitignore` dynamically.

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
