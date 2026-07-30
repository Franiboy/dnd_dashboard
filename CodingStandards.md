# Coding Standards – D&D Dashboard

This file summarizes the most important code conventions and quality guidelines for the project. It complements `AGENTS.md` and applies to client and server code.

## General

- **Language:** TypeScript with `strict: true` in all `tsconfig.*.json`.
- **Modules:** ESM (`"type": "module"` in `package.json`).
- **Formatting:** Consistent indentation (2 spaces) and semantic blank lines. No explicit linter rules besides `oxlint`.
- **Comments:** No superfluous comments. Code should be self-explanatory. Only briefly explain complex business rules or workarounds.
- **Natural language:** All comments and commit messages must be in English.

## Server (`server/`)

### Imports

- Server imports **always use `.js` suffixes** (ESM / NodeNext), even for `.ts` source files:

  ```ts
  import { db } from './database.js';
  import type { User } from '../shared/types.js';
  ```

- Use `import type` for pure type imports.

### Architecture

- Prefer the **repository pattern** for database access (see `server/repositories/`).
- Do not put business logic directly in routes; move it to repositories or dedicated service files.
- Express routes export a `Router` as default export.

### Error Handling

- Explicit error responses with meaningful but not overly detailed messages.
- Use `try/catch` only where things can actually fail (database, file system, external processes).
- Do not send stack traces or internal error details to the client.

### Logging

- Always use `createLogger('category')` from `server/logger.ts`.
- No `console.log`/`console.error` in production code (exceptions: startup and shutdown messages in `index.ts`).
- Choose short, concise log categories, e.g. `diaryRoutes`, `opencode`, `mcp-server`.

### Database

- Use `db.prepare(...)` with parameterized queries; no string concatenation for conditions, except for dynamically composed `IN` lists.
- Put migrations in `server/migrations.ts`, never make manual schema changes outside of migrations.

### AI / MCP

- Maintain AI prompts centrally in `server/ai/rewrite.ts` or `server/ai/knowledge.ts`.
- Prompts must clearly separate: role → task → tools → rules → input.
- Register new MCP tools in `server/mcp/index.ts` and assign them to the correct scope group (`server/mcp/tokens.ts`).
- Use `zod` for parameter validation in MCP tools.

### Security

- Never log or send secrets to the client.
- Use auth middleware (`authMiddleware`, `requireAdmin`, `requireApproved`) consistently.
- Do not disable or loosen rate limiting.

## Client (`src/`)

### Imports

- Client imports **do not use `.js` suffixes**:

  ```ts
  import { useAuth } from './hooks/useAuth';
  ```

- Absolute imports via `@/` are not configured; use relative paths.

### Components

- Write components as function components with TypeScript types.
- Shared components in `src/components/`, pages in `src/pages/`.
- Custom hooks in `src/hooks/`.
- Global states in `src/contexts/`.

### Tailwind CSS

- Prefer utility classes; custom CSS files only when necessary.
- Use consistent spacing and colors via Tailwind defaults.

### API Calls

- Use `useApi` for HTTP requests so errors are automatically shown as toasts.
- Subscribe to SSE endpoints with `withCredentials: true`.

## Shared (`shared/`)

- All TypeScript types and interfaces shared by frontend and backend live here.
- No runtime logic in `shared/`.
- Server imports from `shared/` use `.js` suffixes.

## Scripts (`scripts/`)

- Build and helper scripts are executable with `tsx`.
- Do not write sensitive data in scripts.

## Git

- Do not commit secrets, databases, build artifacts or logs.
- Commit messages must be short and in English.
- Check `git diff` before every commit.
