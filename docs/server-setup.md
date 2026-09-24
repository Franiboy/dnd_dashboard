# Server migration checklist (D&D Dashboard)

Everything needed to rebuild the production host from a clean Ubuntu install.
The scripted parts are idempotent and live in the repo; the manual parts are
listed at the end.

## Repo layout for the server role

| Path                              | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `scripts/dnd-server-setup.sh`     | One-shot bootstrap (runner, Node, units, nginx, sudoers)   |
| `scripts/dnd-deploy.sh`           | CI/CD deploy (ff-only pull, build, health check, rollback) |
| `scripts/dnd-backup.sh`           | Daily backup (WAL-safe SQLite + zstd recordings, dedup)    |
| `scripts/dnd-healthcheck.sh`      | Minutely liveness check + service restart                  |
| `systemd/`                        | systemd unit/timer templates (service, socket, timers)     |
| `deploy/nginx-dnd-dashboard.conf` | Reverse proxy config (reference copy)                      |
| `.nvmrc`                          | Single source of truth for the Node version                |

## Scripted (run `scripts/dnd-server-setup.sh` on the new host)

1. `sudo apt update && sudo apt install -y git curl sudo zstd nginx`
2. Create the deploy user: `sudo adduser --disabled-password <user>` (create a dedicated deploy user, e.g. `dnd`).
3. Clone the repo into the deploy target location, e.g. `/dnd_dashboard`.
4. As the deploy user, run `scripts/dnd-server-setup.sh`.
   It installs: nvm + Node (from `.nvmrc`), the GitHub Actions runner (systemd
   service `actions.runner.<org>-<repo>.<name>`), the `dnd-*` systemd units +
   socket + timers, nginx site, `~/logs` + `~/backups/dnd`, and passwordless
   `sudo systemctl restart dnd-dashboard`.

## Migration from hosts that had `dnd-opencode2.service`

Older deployments ran a separate `dnd-opencode2.service` background unit.
The bundled `opencode` CLI (v2.x) is managed directly via the CLI now; on
existing hosts disable and remove the leftover unit after pulling:

```
sudo systemctl disable --now dnd-opencode2.service
sudo rm /etc/systemd/system/dnd-opencode2.service
sudo systemctl daemon-reload
```

## Manual (cannot be fully automated)

1. **Runner token**: GitHub UI `Settings > Actions > Runners > New self-hosted
runner` → copy token → re-run `RUNNER_TOKEN=<token> scripts/dnd-server-setup.sh`.
   Runner name/labels are `DND_RUNNER_NAME` / `DND_RUNNER_LABELS` (defaults:
   `dnd-runner` (via `DND_RUNNER_NAME`), `self-hosted,Linux,X64`).
2. **TLS certificate**: `sudo certbot --nginx -d <your-domain>`
   (regenerates the `# managed by Certbot` lines in the nginx site).
3. **DNS / firewall**: point `<your-domain>` (or your domain) at the new
   host and forward 443 (HTTP/HTTPS) + 3001 (health) — for the Fritz.Box also the
   public IPv6 of the new machine.
4. **Secrets** (`/dnd_dashboard/.env`): Discord bot token, JWT secret, DB paths.
   Copy from the old host or the last backup under `~/backups/dnd/<ts>/.env`.
5. **Data**: restore the latest backup
   `gunzip -c dnd.db.gz > dnd.db`, `tar xzf data.tar.gz`, `zstd -d recordings/*.zst`,
   then `chown -R <user>:<user> /dnd_dashboard`.
6. **Old-host teardown**: `sudo systemctl disable --now dnd-*.timer dnd-dashboard.socket dnd-dashboard.service`
   and remove the old runner (`~/actions-runner/svc.sh uninstall`, delete `~/actions-runner`).

## Verification after migration

- `curl -i http://127.0.0.1:3001/health` → `200 {"status":"ok",...}`
- `curl -i http://127.0.0.1:3001/ready` → `200 {"status":"ready","db":"ok",...}` (verifies the database is reachable; `503` when not ready)
- `curl -I https://<your-domain>` → `200` over TLS
- `systemctl list-timers dnd-backup dnd-healthcheck` → both scheduled
- Push a commit to `main` → CI/CD runs on the new runner and deploys itself
- `~/backups/dnd/` gets a new daily backup after 03:00
