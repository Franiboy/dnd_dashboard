#!/usr/bin/env bash
# One-shot server bootstrap for the D&D Dashboard self-hosted deploy setup.
#
# Reproduces the live server (see AGENTS.md on the host): GitHub Actions runner
# + nvm-managed Node + systemd units/timers + nginx reverse proxy + sudoers
# entries. Idempotent: safe to re-run; already-present pieces are skipped.
#
# Manual, on the FIRST run only (not scriptable):
#   1. Register a runner in GitHub UI: Settings > Actions > Runners > New,
#      copy the token, then run with  RUNNER_TOKEN=<token> ./scripts/dnd-server-setup.sh
#   2. Obtain the TLS cert:  sudo certbot --nginx -d einsnicergameserver.de
#   3. Point DNS/Fritz.Box port-forward (443 -> this host) at the new server.
#
# Requirements: bash, sudo (passwordless), network. Run as the deploy user.
set -euo pipefail

REPO_DIR="${DND_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_USER="${DND_DEPLOY_USER:-$USER}"
RUNNER_DIR="${DND_RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_VERSION="${DND_RUNNER_VERSION:-2.336.0}"
RUNNER_NAME="${DND_RUNNER_NAME:-HomeServer}"
RUNNER_LABELS="${DND_RUNNER_LABELS:-self-hosted,Linux,X64,HomeServer}"
RUNNER_TOKEN="${RUNNER_TOKEN:-}"
GIT_REPO="${DND_GIT_REPO:-Franiboy/dnd_dashboard}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
SERVICE_NAME="dnd-dashboard"

log() { echo "[dnd-server-setup] $*"; }
die() { echo "[dnd-server-setup] ERROR: $*" >&2; exit 1; }

[ -d "$REPO_DIR" ] || die "repo dir not found: $REPO_DIR (set DND_REPO_DIR)"
command -v sudo >/dev/null || die "sudo not found"

# --- 1. Node via nvm (version comes from .nvmrc, never hardcoded) ------------
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  export NVM_SYMLINK_CURRENT=true
  log "nvm found; installing Node from $REPO_DIR/.nvmrc..."
  (cd "$REPO_DIR" && nvm install)
  (cd "$REPO_DIR" && nvm use)
  log "Node: $(node -v) at $(command -v node)"
else
  log "nvm not found; installing..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  . "$NVM_DIR/nvm.sh"
  export NVM_SYMLINK_CURRENT=true
  (cd "$REPO_DIR" && nvm install && nvm use)
  log "Node: $(node -v) at $(command -v node)"
fi
grep -q NVM_SYMLINK_CURRENT "$HOME/.bashrc" 2>/dev/null || echo 'export NVM_SYMLINK_CURRENT=true' >> "$HOME/.bashrc"

# --- 2. GitHub Actions runner ------------------------------------------------
if [ -x "$RUNNER_DIR/bin/Runner.Listener" ]; then
  log "runner already installed at $RUNNER_DIR ($($RUNNER_DIR/bin/Runner.Listener --version))"
else
  log "installing runner $RUNNER_VERSION into $RUNNER_DIR..."
  mkdir -p "$RUNNER_DIR"
  curl -fsSL -o /tmp/runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  tar xzf /tmp/runner.tar.gz -C "$RUNNER_DIR"
  rm -f /tmp/runner.tar.gz
  "$RUNNER_DIR/bin/installdependencies.sh"
  if [ -n "$RUNNER_TOKEN" ]; then
    log "configuring runner '$RUNNER_NAME' for $GIT_REPO..."
    (cd "$RUNNER_DIR" && ./config.sh --url "https://github.com/$GIT_REPO" \
      --token "$RUNNER_TOKEN" --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --unattended --replace)
  else
    log "RUNNER_TOKEN empty - skipping runner registration. Re-run with RUNNER_TOKEN=<token>."
  fi
  "$RUNNER_DIR/svc.sh" install "$DEPLOY_USER"
fi

# --- 3. systemd units (dashboardservice, socket, timers) ----------------------
SERVICES=(dnd-dashboard.service dnd-dashboard.socket dnd-backup.service dnd-backup.timer dnd-healthcheck.service dnd-healthcheck.timer dnd-opencode2.service)
for unit in "${SERVICES[@]}"; do
  if [ -f "$REPO_DIR/systemd/$unit" ]; then
    sudo cp "$REPO_DIR/systemd/$unit" "/etc/systemd/system/$unit"
    log "installed unit $unit"
  fi
done
sudo systemctl daemon-reload
sudo systemctl enable --now dnd-opencode2.service
sudo systemctl enable --now dnd-dashboard.socket
sudo systemctl enable --now dnd-dashboard.service
sudo systemctl enable --now dnd-backup.timer
sudo systemctl enable --now dnd-healthcheck.timer
log "systemd units enabled (dashboard + socket + timers + opencode2)"

# --- 4. nginx reverse proxy ---------------------------------------------------
if [ -f "$REPO_DIR/deploy/nginx-dnd-dashboard.conf" ]; then
  if command -v nginx >/dev/null 2>&1; then
    sudo cp "$REPO_DIR/deploy/nginx-dnd-dashboard.conf" /etc/nginx/sites-available/dnd-dashboard
    sudo ln -sf /etc/nginx/sites-available/dnd-dashboard /etc/nginx/sites-enabled/dnd-dashboard
    if sudo nginx -t 2>/dev/null; then
      sudo systemctl reload nginx || true
      log "nginx config installed and reloaded"
    else
      log "WARN: nginx config test failed - fix SSL block (run certbot) or proxy manually"
    fi
  else
    log "nginx not installed; skipping reverse proxy (install + certbot manually)"
  fi
fi

# --- 5. runtime dirs ----------------------------------------------------------
mkdir -p "$HOME/logs" "$HOME/backups/dnd"
log "created ~/logs and ~/backups/dnd"

# --- 6. sudoers (NOPASSWD for restart used by deploy/healthcheck) -------------
SUDOERS_FILE="/etc/sudoers.d/dnd-dashboard"
sudo tee "$SUDOERS_FILE" >/dev/null <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart $SERVICE_NAME
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl status $SERVICE_NAME
EOF
sudo chmod 440 "$SUDOERS_FILE"
log "sudoers: $DEPLOY_USER may restart $SERVICE_NAME without password"

# --- 7. first deployment ------------------------------------------------------
if [ ! -d "$REPO_DIR/node_modules" ]; then
  log "installing dependencies (first run)..."
  (cd "$REPO_DIR" && npm ci)
  (cd "$REPO_DIR" && npm run build)
fi

log "Done. Remaining manual steps:"
log "  - DNS/Fritz.Box port-forward to this host (443/3001)"
log "  - sudo certbot --nginx -d einsnicergameserver.de"
log "  - if runner was not registered: RUNNER_TOKEN=<token> $0"
