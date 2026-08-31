# Architecture

This document describes the high-level structure of the D&D Dashboard.

## Server

| File                          | Purpose                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `server/index.ts`             | Express and Socket.io setup, router mounting, shutdown handler, scheduler/bot startup                  |
| `server/auth.ts`              | JWT creation/validation, auth middleware, admin middleware, rate limiting                              |
| `server/database.ts`          | Central `better-sqlite3` connection (`dnd.db`) with WAL and foreign keys                               |
| `server/encryption.ts`        | Symmetric encryption helpers for sensitive tokens (AES-256-GCM)                                        |
| `server/users.ts`             | SQLite user management, password hashing, account lockout, Discord profile and encrypted token storage |
| `server/env.ts`               | Zod-validated environment configuration and startup validation                                         |
| `server/schema.ts`            | Declarative target database schema (tables, columns, indexes, references)                              |
| `server/migrations.ts`        | Schema-diff engine: applies missing tables/columns/indexes against `schema.ts` + data-level hooks      |
| `server/errors.ts`            | Central `AppError` class, 404 handler and Express error middleware                                     |
| `server/logger.ts`            | Centralized, categorized logger with in-memory buffer and SSE subscription                             |
| `server/version.ts`           | Returns active feature flags (`aiEnabled`, `recordingEnabled`)                                         |
| `server/socket.ts`            | Socket.io event handlers for Bingo                                                                     |
| `server/diaryFiles.ts`        | Stores AI rewrites as files under `rewritten/`                                                         |
| `server/ai/sessionToDiary.ts` | AI prompt and orchestration for transferring a session into a diary draft                              |

### Routes (`server/routes/`)

| File            | Purpose                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `auth.ts`       | Login, Discord callback, `/me`, logout                                                  |
| `admin.ts`      | Admin API, SSE `/admin/users/events`, SSE `/admin/logs/events`, paginated `/admin/logs` |
| `ai.ts`         | `POST /api/execute` – direct execution of AI tool actions (admin/debug only)            |
| `bingo.ts`      | AI bingo suggestions: list, accept, reject, refresh                                     |
| `campaign.ts`   | Central campaign timeline: list days, create/advance a day                              |
| `diary.ts`      | CRUD for diary entries, AI rewrite, summary, entities; SSE for AI status                |
| `entities.ts`   | Entity list, details, aliases, blacklist, knowledge and summary CRUD                    |
| `recordings.ts` | Discord recording sessions, transcripts, trimming and AI session-to-diary draft         |

### Repositories (`server/repositories/`)

| File                  | Purpose                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `games.ts`            | SQLite game state storage (JSON in `games` table)                                       |
| `bingoSuggestions.ts` | Pending, accepted and rejected AI bingo suggestions                                     |
| `diary.ts`            | Diary entries, entities, aliases, search, canonical name resolution                     |
| `entityKnowledge.ts`  | Knowledge entries for entities (CRUD, soft-delete, in-game validity windows)            |
| `entitySummaries.ts`  | AI-generated entity summaries                                                           |
| `gameTimeline.ts`     | Central `campaign_days` timeline, current/next day helpers, session & diary day setters |
| `recordings.ts`       | Recording sessions and files                                                            |

### AI / MCP (`server/ai/` & `server/mcp/`)

| File                     | Purpose                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai/config.ts`           | Checks whether AI is enabled (`AI_PROVIDER=opencode` + valid `AI_MODEL`)                                                                        |
| `ai/bingoSuggestions.ts` | Prompts and pool management for AI bingo suggestions                                                                                            |
| `ai/opencode.ts`         | Spawns `opencode run` with MCP token and scopes; supports the V2 CLI (`opencode2`) via a persistent background server for session reuse/cleanup |
| `ai/rewrite.ts`          | Prompts for rewrite, summary and entity extraction                                                                                              |
| `ai/knowledge.ts`        | Prompts for knowledge distribution and entity summaries                                                                                         |
| `ai/actions.ts`          | Parser and executor for direct AI tool actions                                                                                                  |
| `mcp/index.ts`           | MCP server with tools (`set_diary_*`, `get_entity`, `create_knowledge`, …)                                                                      |
| `mcp/tokens.ts`          | JWT-based MCP session tokens with scopes                                                                                                        |

### Scheduler & Discord (`server/scheduler/` & `server/discord/`)

| File                                                    | Purpose                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `scheduler/bingoSuggestions.ts`                         | Keeps the AI bingo suggestion pool filled in the background    |
| `scheduler/entitySummaries.ts`                          | Starts AI-generated entity summaries in the background         |
| `scheduler/sessionToDiary.ts`                           | Nightly auto-transfer of completed sessions to user diaries    |
| `discord/bot.ts`                                        | Starts the Discord bot and joins voice channels for recordings |
| `discord/recorder.ts`                                   | Records Discord audio and stores PCM files                     |
| `discord/transcriber.ts`                                | Runs Whisper transcription                                     |
| `discord/scheduler.ts`                                  | Processes pending transcriptions                               |
| `discord/oauth.ts`                                      | Discord OAuth2 token exchange, refresh and profile sync        |
| `scheduler/discordTokenRefresh.ts`                      | Periodic refresh of stored Discord OAuth tokens                |
| `discord/audio.ts` / `files.ts` / `recordingsEvents.ts` | Audio processing, file management, events                      |

## Frontend (`src/`)

| File / Directory                                     | Purpose                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                                        | React app entry with router                                                                         |
| `src/main.tsx`                                       | Root render                                                                                         |
| `src/lib/apps.ts`                                    | App metadata (Dashboard, Diary, Bingo, World, Recordings, Admin)                                    |
| `src/pages/`                                         | Pages: Login, AdminLogin, AuthCallback, Home, Bingo, Diary, World, Recordings, Admin                |
| `src/components/`                                    | Reusable components (Layout, ProtectedRoute, ConfirmDialog, Toast, LogPanel, BingoAiSuggestions, …) |
| `src/hooks/useAuth.ts`                               | Auth hook                                                                                           |
| `src/hooks/useSocket.ts`                             | Socket.io hook                                                                                      |
| `src/hooks/useApi.ts`                                | `fetch` wrapper with automatic error toast display                                                  |
| `src/hooks/useError.ts`                              | Access to the global error context                                                                  |
| `src/contexts/ErrorContext.ts` / `ErrorProvider.tsx` | Global error / toast context                                                                        |
| `src/types.ts`                                       | Frontend type alias for the Socket.io client                                                        |

## Shared

- `shared/types.ts` – Shared TypeScript types for frontend and backend.
