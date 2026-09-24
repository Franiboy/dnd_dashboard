# Server migration checklist (D&D Dashboard)

Everything needed to rebuild the production host from a clean Ubuntu install.
The scripted bootstrap is idempotent; application releases are deployed later
by the GitHub release workflow.

## Repo layout for the server role

| Path                              | Purpose                                                       |
| --------------------------------- | ------------------------------------------------------------- |
| `scripts/dnd-server-setup.sh`     | Bootstrap nvm/Node, stable systemd units, timers and nginx    |
| `scripts/dnd-release-deploy.sh`   | Promote a checksummed CI artifact to `/dnd_dashboard/current` |
| `scripts/dnd-backup.sh`           | Daily backup (SQLite + data + recordings)                     |
| `scripts/dnd-healthcheck.sh`      | Readiness check and service recovery                          |
| `systemd/`                        | Stable root-owned unit/timer templates                        |
| `deploy/nginx-dnd-dashboard.conf` | Reverse proxy reference configuration                         |
| `.nvmrc`                          | Node version source for setup and CI                          |

## Scripted bootstrap

1. `sudo apt update && sudo apt install -y git curl sudo zstd nginx`
2. Create a dedicated deploy/runtime user, for example `dnd`.
3. Clone the repository into `/dnd_dashboard`.
4. Copy `.env.example` to `/dnd_dashboard/.env` and configure secrets.
5. As the deploy user, run:

   ```bash
   bash scripts/dnd-server-setup.sh
   ```

   The script installs nvm/Node from `.nvmrc`, stable systemd units, nginx,
   timers and narrowly scoped sudo rules. The production runner is registered
   separately to the private `Franiboy/dnd_dashboard-deploy` repository; it is
   not installed by this public source repository.

The application is not started until the first immutable release exists.

## First release

After the public release workflow has published an asset for an exact source
commit, dispatch the private deployment workflow with that SHA. The private
job will:

- validate the artifact and checksum;
- create `/dnd_dashboard/releases/<sha>`;
- pause the activation socket and snapshot/migrate SQLite while the service is stopped;
- switch `/dnd_dashboard/current` atomically;
- start the socket and service, then verify `/ready` plus the release SHA.

Dispatch the private deployment workflow from an authorized workstation:

```bash
gh workflow run deploy.yml \\
  --repo Franiboy/dnd_dashboard-deploy \\
  -f sha=<40-character-source-main-sha>
```

The stable unit must point to `/dnd_dashboard/current`. Verify it before the
first release:

```bash
sudo systemctl daemon-reload
sudo systemctl enable dnd-dashboard.socket
systemctl cat dnd-dashboard.service
```

Leave the socket stopped until the private deployment workflow has created
`/dnd_dashboard/current`; the deployment starts it as part of the transaction.

For a genuinely fresh host with no database or JWT key pair, the first manual
release must explicitly set `DND_ALLOW_BOOTSTRAP=1` and
`DND_DEPLOY_ALLOW_NEW_JWT_KEYS=1`; never set either flag for an existing
installation.

Do not run the legacy `scripts/dnd-deploy.sh`; it is intentionally disabled.

## Manual configuration

1. **Private runner:** register the host runner in
   `Franiboy/dnd_dashboard-deploy`, not in the public source repository. The
   default labels are `self-hosted,Linux,X64,HomeServer`; the public source
   repository must contain no self-hosted job.
2. **TLS certificate:** `sudo certbot --nginx -d <your-domain>`.
3. **DNS/firewall:** expose only HTTPS through the reverse proxy. The Node
   socket binds to `127.0.0.1:3001` and must not be forwarded externally.
4. **Secrets:** keep `/dnd_dashboard/.env` outside release directories and set
   mode `0600`.
5. **Data:** restore the latest backup before enabling the application. Keep
   `dnd.db`, `data/`, and `recordings/` outside immutable release directories.
6. **Old-host teardown:** disable the old timers, socket, service and runner
   only after the new host is healthy.

## Verification

- `curl -i http://127.0.0.1:3001/health` → `200`
- `curl -i http://127.0.0.1:3001/ready` → `200` with `db: ok` and the expected
  `releaseSha`
- `curl -I https://<your-domain>` → `200`
- `systemctl list-timers dnd-backup dnd-healthcheck` → both scheduled
- `readlink -f /dnd_dashboard/current` → the deployed commit's release directory
- `~/backups/dnd/` receives a new daily backup after the scheduled backup time
