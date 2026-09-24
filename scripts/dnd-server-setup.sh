#!/usr/bin/env bash
# One-shot server bootstrap for the D&D Dashboard application host.
#
# Installs nvm-managed Node, stable systemd units/timers, nginx and narrowly
# scoped sudo rules. The production GitHub Actions runner is intentionally
# registered to the separate private dnd_dashboard-deploy repository, not to
# this public source repository.
#
# Manual, on the FIRST run only (not scriptable):
#   1. Obtain the TLS cert: sudo certbot --nginx -d <your-domain>
#   2. Point DNS/Fritz.Box port-forward (443 -> this host) at the new server.
#
# Requirements: bash, sudo (passwordless), network. Run as the deploy user.
set -euo pipefail

REPO_DIR="${DND_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_USER="${DND_DEPLOY_USER:-$USER}"
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

# --- 2. runtime directories --------------------------------------------------
mkdir -p "$HOME/logs" "$HOME/backups/dnd" "$REPO_DIR/releases" "$REPO_DIR/recordings" "$REPO_DIR/data/keys"

# --- 3. systemd units (dashboard, socket, timers) ---------------------------
SERVICES=(dnd-dashboard.service dnd-dashboard.socket dnd-backup.service dnd-backup.timer dnd-healthcheck.service dnd-healthcheck.timer)
# Unit templates use neutral placeholders (User=dnd, /home/dnd/...).
deploy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
verify_dir="$(mktemp -d)"
for unit in "${SERVICES[@]}"; do
  if [ -f "$REPO_DIR/systemd/$unit" ]; then
    sub_tmp="$verify_dir/$unit"
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
rm -rf "$verify_dir"
sudo systemctl daemon-reload
# The first application release is started by the release workflow after the
# immutable /dnd_dashboard/current symlink exists.
sudo systemctl enable dnd-dashboard.socket
if [ -L "$REPO_DIR/current" ]; then
  sudo systemctl start dnd-dashboard.socket
else
  log "dnd-dashboard.socket remains stopped until the first immutable release"
fi
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
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start dnd-dashboard.socket
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop dnd-dashboard.socket
EOF
sudo chmod 440 "$SUDOERS_FILE"
log "sudoers: $DEPLOY_USER may manage $SERVICE_NAME without password"

# --- 7. first release ---------------------------------------------------------
log "The first application release is deployed by the private dnd_dashboard-deploy workflow."
log "Do not start dnd-dashboard.service until /dnd_dashboard/current exists."

log "Done. Remaining manual steps:"
log "  - DNS/Fritz.Box port-forward to this host (HTTPS/443 only; Node remains on loopback)"
log "  - sudo certbot --nginx -d <your-domain>"
log "  - register the runner only in the private deployment repository"
