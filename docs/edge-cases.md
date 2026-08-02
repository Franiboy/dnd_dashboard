# Known Edge Cases

- New users must be approved by an admin before they can log in.
- The Bingo name is automatically taken from the account display name (`displayName`).
- Display-name and avatar changes are updated on the next scheduled Discord token refresh or the next Discord login via `updateDiscordProfile` in `server/users.ts`. A separate profile update (`PUT /api/me`) is currently not implemented.
- `Ctrl+C` in `npm run dev` stops both processes; for stuck processes use `lsof -i :3001` / `lsof -i :5173` and `kill -9 <PID>`.
- A rejected (`isApproved = false`) Discord user can log in again after approval without being recreated.
- `ensureAdminUser()` does not start if `ADMIN_PASSWORD` is missing.
- AI features are disabled if `AI_PROVIDER` is not `opencode` or `AI_MODEL` starts with `provider/`.
- The MCP server exits with code 1 if no valid `MCP_SESSION_TOKEN` was passed.

## Files That Should Not Be Changed

- `.gitignore` contains sensitive files (`.env`, `*.db`, `dist`, `dist-server`, `rewritten`, `recordings`).
- `server/users.ts` contains `INITIAL_ADMIN_USERNAME` and reads `ADMIN_PASSWORD` from `.env`.
- Security-relevant configurations (`rateLimit`, `JWT_SECRET`, `ADMIN_PASSWORD`, `trust proxy`, `MCP_TOKEN_SECRET`) must not be loosened.
