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
#   2. Obtain the TLS cert:  sudo certbot --nginx -d <your-domain>
#   3. Point DNS/Fritz.Box port-forward (443 -> this host) at the new server.
#
# Requirements: bash, sudo (passwordless), network. Run as the deploy user.
set -euo pipefail

REPO_DIR="${DND_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_USER="${DND_DEPLOY_USER:-$USER}"
RUNNER_DIR="${DND_RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_VERSION="${DND_RUNNER_VERSION:-2.337.0}"
RUNNER_SHA256="${DND_RUNNER_SHA256:-70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613}"
RUNNER_NAME="${DND_RUNNER_NAME:-dnd-runner}"
RUNNER_LABELS="${DND_RUNNER_LABELS:-self-hosted,Linux,X64,HomeServer}"
RUNNER_TOKEN="${RUNNER_TOKEN:-}"
GIT_REPO="${DND_GIT_REPO:-Franiboy/dnd_dashboard}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NVM_VERSION="${DND_NVM_VERSION:-0.40.3}"
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
  log "nvm not found; installing v$NVM_VERSION from the tagged repository..."
  git clone --depth 1 --branch "v${NVM_VERSION}" https://github.com/nvm-sh/nvm.git "$NVM_DIR"
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
  echo "$RUNNER_SHA256  /tmp/runner.tar.gz" | sha256sum -c -
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

# --- 3. runtime directories --------------------------------------------------
mkdir -p "$HOME/logs" "$HOME/backups/dnd" "$REPO_DIR/releases" "$REPO_DIR/recordings"

# --- 4. systemd units (dashboard, socket, timers) ---------------------------
SERVICES=(dnd-dashboard.service dnd-dashboard.socket dnd-backup.service dnd-backup.timer dnd-healthcheck.service dnd-healthcheck.timer)
# Unit templates use neutral placeholders (User=dnd, /home/dnd/...).
deploy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
sub_tmp="$(mktemp)"
for unit in "${SERVICES[@]}"; do
  if [ -f "$REPO_DIR/systemd/$unit" ]; then
    sed -e "s/^User=dnd$/User=$DEPLOY_USER/" \
        -e "s#/home/dnd/#$deploy_home/#g" \
        "$REPO_DIR/systemd/$unit" > "$sub_tmp"
    if command -v systemd-analyze >/dev/null 2>&1; then
      systemd-analyze verify "$sub_tmp" >/dev/null
    fi
    sudo cp "$sub_tmp" "/etc/systemd/system/$unit"
    log "installed unit $unit"
  fi
done
rm -f "$sub_tmp"
sudo systemctl daemon-reload
# The first application release is started by the release workflow after the
# immutable /dnd_dashboard/current symlink exists.
sudo systemctl enable --now dnd-dashboard.socket
sudo systemctl enable dnd-dashboard.service
sudo systemctl enable --now dnd-backup.timer
sudo systemctl enable --now dnd-healthcheck.timer
log "systemd units enabled (dashboard + socket + timers)"

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

# --- 6. sudoers (NOPASSWD for release deploy/healthcheck) --------------------
SUDOERS_FILE="/etc/sudoers.d/dnd-dashboard"
sudo tee "$SUDOERS_FILE" >/dev/null <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start $SERVICE_NAME
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop $SERVICE_NAME
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart $SERVICE_NAME
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl status $SERVICE_NAME
EOF
sudo chmod 440 "$SUDOERS_FILE"
log "sudoers: $DEPLOY_USER may manage $SERVICE_NAME without password"

# --- 7. first release ---------------------------------------------------------
log "The first application release is deployed by the GitHub release workflow."
log "Do not start dnd-dashboard.service until /dnd_dashboard/current exists."

log "Done. Remaining manual steps:"
log "  - DNS/Fritz.Box port-forward to this host (443/3001)"
log "  - sudo certbot --nginx -d <your-domain>"
log "  - if runner was not registered: RUNNER_TOKEN=<token> $0"
