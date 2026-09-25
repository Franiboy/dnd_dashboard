# Security

- Secret values (`JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `ADMIN_PASSWORD`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `MCP_TOKEN_SECRET`) belong in `.env` and must **never** be committed.
- Dashboard session JWTs are signed with RS256 (`jsonwebtoken`, algorithms pinned on sign and verify). The RSA key pair lives in the gitignored `data/keys/` directory (private key `0600`); `JWT_SECRET` is only the fallback secret for MCP session tokens.
- Discord OAuth access and refresh tokens are encrypted at rest with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM) before being stored in SQLite.
- The Discord OAuth `state` parameter is verified against a short-lived `httpOnly` cookie.
- `.env`, `*.db`, `dist/`, `dist-server/`, `rewritten/` and `recordings/` are in `.gitignore`.
- The admin username `admin` is protected against deletion, lockout and admin-right removal.
- Admins cannot modify themselves.
- Login and admin login have IP-based rate limiting (15 minutes, max. 10 POST requests).
- After 5 failed login attempts an account is locked for 15 minutes.
- Passwords are hashed with `bcrypt`.
- JWT is accepted only as an `httpOnly` cookie (no localStorage). A legacy Bearer header is still accepted for non-browser clients.
- Socket.io uses the same cookie-based session as the API.
- `app.set('trust proxy', 1)` is active so rate limiting works correctly behind a reverse proxy.
- MCP session tokens expire after 10 minutes and are restricted to specific scopes.
- Public pull-request code runs only on ephemeral GitHub-hosted runners. The trusted AI review implementation lives in the private `Franiboy/dnd_dashboard-deploy` repository; OpenCode runs only on the separately isolated `HomeServer-AI` runner, while patch validation and promotion run in clean GitHub-hosted jobs.
- The production `HomeServer` runner is registered only to the private deployment repository, has no pull-request trigger, and is reserved for the transactional deployment. The AI runner must not have access to `/dnd_dashboard`, production secrets, the production database, sudo, container sockets or the local production application port.
- The AI trigger uses the base-branch `pull_request_target` workflow only to call the pinned private reusable workflow. Source PR install/lifecycle code never receives a write-capable token; validation runs in a disposable container, and the clean promotion job independently checks the original AI artifact before exact-head GitHub operations.
- Release assets are immutable and are never replaced with `--clobber`. When `DND_AUTO_DEPLOY_ENABLED=true`, the source release workflow starts the private deployment workflow with the exact SHA; the deployment creates a consistent pre-migration SQLite snapshot, pauses the activation socket, and verifies `/ready` for that release.
