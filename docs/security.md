# Security

- Secret values (`JWT_SECRET`, `ADMIN_PASSWORD`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `MCP_TOKEN_SECRET`) belong in `.env` and must **never** be committed.
- `.env`, `*.db`, `dist/`, `dist-server/`, `rewritten/` and `recordings/` are in `.gitignore`.
- The admin username `admin` is protected against deletion, lockout and admin-right removal.
- Admins cannot modify themselves.
- Login and admin login have IP-based rate limiting (15 minutes, max. 10 POST requests).
- After 5 failed login attempts an account is locked for 15 minutes.
- Passwords are hashed with `bcrypt`.
- JWT is accepted as `httpOnly` cookie and optionally as Bearer token.
- Socket.io uses the same token as the API (`auth: { token }` or cookie).
- `app.set('trust proxy', 1)` is active so rate limiting works correctly behind a reverse proxy.
- MCP session tokens expire after 10 minutes and are restricted to specific scopes.
