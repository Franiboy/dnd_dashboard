#!/usr/bin/env bash
# Auto-deploy: fast-forward pulls the repo, rebuilds D&D Dashboard,
# verifies health afterwards and rolls back on failure.
#
# Paths are resolved relative to this script; override the deploy target
# with DND_DEPLOY_REPO when invoking from a different checkout (CI).
set -euo pipefail

# Use the default nvm-managed Node (never hardcode a version; .nvmrc rules).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use --silent default

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${DND_DEPLOY_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BRANCH="main"
LOG_DIR="${DND_LOG_DIR:-$HOME/logs}"
LOG="$LOG_DIR/dnd-deploy.log"
LOCK="/tmp/dnd-deploy.lock"
ROLLBACK_DIR="/tmp/dnd-deploy-rollback"
HEALTH_URL="${DND_HEALTH_URL:-http://localhost:3001/health}"
HEALTH_RETRIES=12
HEALTH_SLEEP=5

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

# Prevent overlapping runs
exec 9>"$LOCK"
if ! flock -n 9; then
  log "Another run is in progress, skipping"
  exit 0
fi

cd "$REPO"

git fetch --quiet origin "$BRANCH" 2>>"$LOG"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

log "Change detected: $LOCAL -> $REMOTE"

# Never discard local work: refuse to deploy on a dirty tracked working tree.
if ! git diff --quiet; then
  log "ABORTED: working tree has uncommitted changes; refusing to deploy"
  exit 1
fi

log "Pull changes (fast-forward only)..."
if ! git merge --ff-only "origin/$BRANCH" >>"$LOG" 2>&1; then
  log "ABORTED: fast-forward merge failed (local commits ahead?); refusing to deploy"
  exit 1
fi

# Only reinstall if package-lock/package.json changed between OLD and NEW
if ! git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json package.json 2>/dev/null; then
  log "package-lock/package.json changed, running npm ci..."
  if ! npm ci >>"$LOG" 2>&1; then
    log "npm ci failed; restoring $LOCAL"
    git checkout -f "$LOCAL" >>"$LOG" 2>&1
    exit 1
  fi
fi

# Snapshot the currently-running build so rollback is a restore, not a rebuild.
rm -rf "$ROLLBACK_DIR"
mkdir -p "$ROLLBACK_DIR"
if [ -d "$REPO/dist" ]; then
  cp -a "$REPO/dist" "$ROLLBACK_DIR/dist"
fi
if [ -d "$REPO/dist-server" ]; then
  cp -a "$REPO/dist-server" "$ROLLBACK_DIR/dist-server"
fi
log "Snapshotted previous build to $ROLLBACK_DIR"

log "Building..."
if ! npm run build >>"$LOG" 2>&1; then
  log "Build failed; restoring $LOCAL"
  git checkout -f "$LOCAL" >>"$LOG" 2>&1
  exit 1
fi

# Migrate only after a successful build. This prevents a failed build from
# leaving the old release paired with a potentially changed database schema.
log "Applying database migrations..."
if ! npm run db:migrate >>"$LOG" 2>&1; then
  log "ABORTED: database migration failed; restoring $LOCAL"
  git checkout -f "$LOCAL" >>"$LOG" 2>&1
  if ! git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json package.json 2>/dev/null; then
    npm ci >>"$LOG" 2>&1
  fi
  if [ -d "$ROLLBACK_DIR/dist" ]; then
    rm -rf "$REPO/dist"
    cp -a "$ROLLBACK_DIR/dist" "$REPO/dist"
  fi
  if [ -d "$ROLLBACK_DIR/dist-server" ]; then
    rm -rf "$REPO/dist-server"
    cp -a "$ROLLBACK_DIR/dist-server" "$REPO/dist-server"
  fi
  exit 1
fi

# Install/refresh systemd units (new or changed units land here on deploy).
if command -v systemctl >/dev/null 2>&1; then
  for unit in systemd/*.service systemd/*.socket systemd/*.timer; do
    [ -f "$unit" ] || continue
    sudo cp "$unit" "/etc/systemd/system/$(basename "$unit")"
  done
  sudo systemctl daemon-reload
  sudo systemctl enable dnd-opencode2.service >>"$LOG" 2>&1 || true
fi

log "Restarting service..."
sudo systemctl restart dnd-dashboard >>"$LOG" 2>&1

# Verify the new build is actually healthy before accepting the deployment.
for i in $(seq 1 "$HEALTH_RETRIES"); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "Health check OK"
    log "Deploy complete. New HEAD: $(git rev-parse HEAD)"
    exit 0
  fi
  sleep "$HEALTH_SLEEP"
done

log "HEALTH CHECK FAILED for $REMOTE; rolling back to $LOCAL"
git checkout -f "$LOCAL" >>"$LOG" 2>&1

# If deps changed, reinstall to match the old lockfile before restoring the build.
if ! git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json package.json 2>/dev/null; then
  log "Rollback: deps changed, running npm ci against old lockfile..."
  npm ci >>"$LOG" 2>&1
fi

# Restore the previously-working build from the snapshot (fast, no rebuild).
if [ -d "$ROLLBACK_DIR/dist" ]; then
  rm -rf "$REPO/dist"
  cp -a "$ROLLBACK_DIR/dist" "$REPO/dist"
fi
if [ -d "$ROLLBACK_DIR/dist-server" ]; then
  rm -rf "$REPO/dist-server"
  cp -a "$ROLLBACK_DIR/dist-server" "$REPO/dist-server"
fi
log "Restored previous build from $ROLLBACK_DIR"

sudo systemctl restart dnd-dashboard >>"$LOG" 2>&1

for i in $(seq 1 "$HEALTH_RETRIES"); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "Rollback to $LOCAL health check OK"
    exit 1
  fi
  sleep "$HEALTH_SLEEP"
done

log "CRITICAL: rollback also failed health check"
exit 1
