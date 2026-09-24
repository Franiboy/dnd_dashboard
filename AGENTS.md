# AGENTS.md – D&D Dashboard

This file describes the project, important conventions and working rules for assistants/developers. **Last updated:** 2026-09-24.

## Critical Working Rules for Assistants

These rules take precedence before every code change.

- **Clarify before implementing.** Question every requirement for understanding and completeness and ask follow-up questions until the full context is clear (see "Requirements & Clarification Before Implementation" below).
- **Finish every task with commit, push and pull request after coordinating with the user.** Commits and pushes each require explicit user approval; then open a PR against `main` so CI and the trusted AI review pipeline can validate the change. Never push directly to `main`.
- **Watch CI on every PR until it is merged or blocked.** After opening a PR, actively monitor the pipeline (e.g. `gh pr checks --watch`); the trusted AI job may auto-merge same-repository PRs from the configured maintainer, while public fork PRs remain human-reviewed (see [`docs/ci-cd.md`](./docs/ci-cd.md)).
- **No commits without explicit user approval.**
- **No push without explicit user approval.**
- **No force-push, branch deletions or history rewrites without approval.**
- Check `git diff` before every approved commit.
- **Check for changes on `main` before every commit.** Run `git fetch origin` and rebase/merge the latest `origin/main` into the feature branch before each commit (not just at the start of a task), resolve conflicts locally, and re-run guardrails if new commits came in.
- Never commit `.env`, databases (`*.db`), secrets or build artifacts (`dist/`, `dist-server/`).
- Do not push changes to `main` on production environments without approval.
- Ask the user before committing/pushing if anything is unclear.
- Give a short summary of changes after completing a task.
- **All commit messages and code comments must be in English.**

## Requirements & Clarification Before Implementation

Every requirement or proposed implementation must first be questioned for understanding and completeness. Never start coding on assumptions.

- **Understand before acting:** Analyze what the user actually wants, why it is needed, and which modules, data flows or edge cases are affected.
- **Ask clarifying questions:** Whenever goal, scope, acceptance criteria, expected behavior or constraints are unclear, ask targeted follow-up questions instead of guessing. Asking is always preferred over assuming.
- **Grasp the full context:** Collect missing information (affected features, UI behavior, API contracts, security implications) before proposing a solution.
- **Confirm understanding:** For non-trivial tasks, briefly summarize your understanding of the requirement back to the user and let them confirm before implementing.

## Project Overview

D&D Dashboard is a web application for Dungeons & Dragons sessions with several modules:

- **Bingo:** Shared, password-protected real-time bingo mode.
- **Diary & World:** Diary entries with AI-assisted rewriting, summarizing, entity extraction and a knowledge graph for people, organizations and places.
- **Recordings:** Discord-bot based voice recordings with Whisper transcription.
- **Admin:** User management, app permissions and live logs.

### Tech Stack

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS 4, Socket.io Client
- **Backend:** Node.js 24.15+ (Node 24 release line), Express 5, SQLite (better-sqlite3), Socket.io
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
npm run db:migrate       # Apply database migrations without starting the server
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
- **Refresh cadence:** husky hooks (`post-commit`, `post-merge`) run `projectatlas watch --once` automatically after every commit and pull; run it manually (MCP: `atlas_watch_once`) after larger edit batches before committing; a continuous `projectatlas watch` may run during long sessions.
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
- [`docs/ci-cd.md`](./docs/ci-cd.md) – CI, trusted AI review, immutable releases and local deployment
- [`docs/edge-cases.md`](./docs/edge-cases.md) – Known edge cases and protected files
- [`CodingStandards.md`](./CodingStandards.md) – Code style, import conventions and quality guidelines
- [`README.md`](./README.md) – End-user setup and feature overview

Update these files when architecture, features, environment variables or security rules change significantly.
