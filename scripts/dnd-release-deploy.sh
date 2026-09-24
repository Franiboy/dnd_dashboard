#!/usr/bin/env bash
# Deploy an immutable, prebuilt release artifact to the local production host.
set -Eeuo pipefail
umask 077

ARCHIVE="${DND_RELEASE_ARCHIVE:?DND_RELEASE_ARCHIVE is required}"
EXPECTED_SHA="${DND_RELEASE_SHA:?DND_RELEASE_SHA is required}"
ROOT="${DND_DEPLOY_ROOT:-/dnd_dashboard}"
SERVICE_NAME="${DND_SERVICE_NAME:-dnd-dashboard}"
SYSTEMCTL="${DND_SYSTEMCTL:-systemctl}"
SUDO="${DND_SUDO:-sudo}"
UNIT_FILE="${DND_SYSTEMD_UNIT_FILE:-/etc/systemd/system/${SERVICE_NAME}.service}"
LOG_DIR="${DND_LOG_DIR:-$HOME/logs}"
LOG="$LOG_DIR/dnd-release-deploy.log"
LOCK="${DND_DEPLOY_LOCK:-/tmp/dnd-release-deploy.lock}"
RELEASES_DIR="${DND_RELEASES_DIR:-$ROOT/releases}"
CURRENT_LINK="${DND_CURRENT_LINK:-$ROOT/current}"
READY_URL="${DND_READY_URL:-http://127.0.0.1:3001/ready}"
READY_RETRIES="${DND_READY_RETRIES:-24}"
READY_SLEEP="${DND_READY_SLEEP:-5}"
RELEASE_KEEP="${DND_RELEASE_KEEP:-3}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dnd-release-deploy.XXXXXX")"
EXTRACT_DIR="$WORK_DIR/release"
BACKUP_DIR=""
PREVIOUS_TARGET=""
SERVICE_WAS_ACTIVE=0
SERVICE_STOPPED=0
COMPLETED=0
ROLLING_BACK=0

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

die() {
  log "ERROR: $*"
  exit 1
}

verify_database() {
  local database_path="$1"
  (
    cd "$RELEASES_DIR/$EXPECTED_SHA"
    DB_PATH="$database_path" node --input-type=module - <<'NODE'

import Database from 'better-sqlite3';

const database = new Database(process.env.DB_PATH, { readonly: true });
const result = database.pragma('integrity_check', { simple: true });
database.close();
if (result !== 'ok') process.exit(1);
NODE
  )
}

restore_database() {
  [ -n "$BACKUP_DIR" ] || return 0
  [ -f "$BACKUP_DIR/dnd.db" ] || return 0
  rm -f "$ROOT/dnd.db" "$ROOT/dnd.db-wal" "$ROOT/dnd.db-shm"
  for file in dnd.db dnd.db-wal dnd.db-shm; do
    [ -f "$BACKUP_DIR/$file" ] && cp -a "$BACKUP_DIR/$file" "$ROOT/$file"
  done
}

switch_current() {
  local target="$1"
  ln -s "$target" "$CURRENT_LINK.next"
  mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"
}

wait_for_ready() {
  local expected_sha="$1"
  local attempt body
  for attempt in $(seq 1 "$READY_RETRIES"); do
    body="$(curl -fsS --max-time 5 "$READY_URL" 2>/dev/null || true)"
    if [ -n "$body" ] && node -e '
      const body = JSON.parse(process.argv[1]);
      const expected = process.argv[2];
      if (body.status !== "ready" || body.db !== "ok" || body.releaseSha !== expected) process.exit(1);
    ' "$body" "$expected_sha"; then
      return 0
    fi
    sleep "$READY_SLEEP"
  done
  return 1
}

rollback() {
  [ "$ROLLING_BACK" -eq 0 ] || return 0
  ROLLING_BACK=1
  set +e
  log 'Deployment failed; rolling back release and database'
  "$SUDO" "$SYSTEMCTL" stop "$SERVICE_NAME" >>"$LOG" 2>&1
  restore_database
  if [ -n "$PREVIOUS_TARGET" ]; then
    rm -f "$CURRENT_LINK"
    switch_current "$PREVIOUS_TARGET"
  else
    rm -f "$CURRENT_LINK"
  fi
  if [ "$SERVICE_WAS_ACTIVE" -eq 1 ]; then
    "$SUDO" "$SYSTEMCTL" start "$SERVICE_NAME" >>"$LOG" 2>&1
  fi
  log 'Rollback attempt finished'
}

on_exit() {
  local exit_code=$?
  if [ "$COMPLETED" -ne 1 ] && [ "$SERVICE_STOPPED" -eq 1 ]; then
    rollback
  fi
  rm -rf "$WORK_DIR"
  exit "$exit_code"
}

trap on_exit EXIT
trap 'exit 130' INT TERM

[ -f "$ARCHIVE" ] || die "release archive not found: $ARCHIVE"
[ -d "$ROOT" ] || die "deployment root not found: $ROOT"
[ -f "$ROOT/.env" ] || die "shared environment file not found: $ROOT/.env"
[ -f "$ROOT/dnd.db" ] || die "shared database not found: $ROOT/dnd.db"
[ -d "$ROOT/data" ] || die "shared data directory not found: $ROOT/data"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || die "invalid release SHA"

if [ -f "${ARCHIVE}.sha256" ]; then
  expected_hash="$(awk 'NR == 1 { print $1 }' "${ARCHIVE}.sha256")"
  actual_hash="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
  [ "$expected_hash" = "$actual_hash" ] || die 'release checksum mismatch'
else
  die 'release checksum file is missing'
fi

if tar -tzf "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  die 'release archive contains an unsafe path'
fi

mkdir -p "$EXTRACT_DIR" "$RELEASES_DIR" "$ROOT/backups/deploy"
tar --extract --gzip --file "$ARCHIVE" --directory "$EXTRACT_DIR" --no-same-owner

[ -f "$EXTRACT_DIR/manifest.json" ] || die 'release manifest is missing'
manifest_sha="$(node -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).commit)' "$EXTRACT_DIR/manifest.json")"
[ "$manifest_sha" = "$EXPECTED_SHA" ] || die 'release manifest SHA does not match requested SHA'
[ -f "$EXTRACT_DIR/.release-sha" ] || die 'release SHA marker is missing'
[ "$(tr -d '[:space:]' < "$EXTRACT_DIR/.release-sha")" = "$EXPECTED_SHA" ] || die 'release SHA marker does not match requested SHA'
for required_path in dist dist-server node_modules package.json package-lock.json; do
  [ -e "$EXTRACT_DIR/$required_path" ] || die "release is missing $required_path"
done
[ -f "$EXTRACT_DIR/dist-server/scripts/db-migrate.js" ] || die 'compiled migration runner is missing'

if [ "${DND_DRY_RUN:-0}" = "1" ]; then
  log "Release artifact validated successfully: $EXPECTED_SHA"
  COMPLETED=1
  exit 0
fi

[ -f "$UNIT_FILE" ] || die "systemd unit is missing: $UNIT_FILE"
grep -qF "WorkingDirectory=$ROOT/current" "$UNIT_FILE" || die 'the current systemd unit is not installed; install the reviewed unit before releasing'

key_dir="$ROOT/data/keys"
for key in jwt-private.pem jwt-public.pem; do
  [ -s "$key_dir/$key" ] || die "JWT key is missing or empty: $key_dir/$key"
done

exec 9>"$LOCK"
flock -n 9 || die 'another release deployment is already running'

if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK")"
elif [ -e "$CURRENT_LINK" ]; then
  die "$CURRENT_LINK exists but is not a symlink"
fi

release_dir="$RELEASES_DIR/$EXPECTED_SHA"
if [ -e "$release_dir" ]; then
  [ -f "$release_dir/.release-sha" ] || die "existing release is incomplete: $release_dir"
  [ "$(tr -d '[:space:]' < "$release_dir/.release-sha")" = "$EXPECTED_SHA" ] || die "existing release SHA mismatch: $release_dir"
  rm -rf "$EXTRACT_DIR"
else
  mv "$EXTRACT_DIR" "$release_dir"
fi

mkdir -p "$ROOT/recordings"
for shared_link in .env data recordings; do
  if [ ! -e "$release_dir/$shared_link" ]; then
    case "$shared_link" in
      .env) ln -s "$ROOT/.env" "$release_dir/.env" ;;
      data) ln -s "$ROOT/data" "$release_dir/data" ;;
      recordings) ln -s "$ROOT/recordings" "$release_dir/recordings" ;;
    esac
  fi
done

if "$SYSTEMCTL" is-active --quiet "$SERVICE_NAME"; then
  SERVICE_WAS_ACTIVE=1
  log "Stopping $SERVICE_NAME for migration and release switch"
  SERVICE_STOPPED=1
  "$SUDO" "$SYSTEMCTL" stop "$SERVICE_NAME" >>"$LOG" 2>&1
else
  log "$SERVICE_NAME is not active; starting it after release setup"
  SERVICE_STOPPED=1
fi

backup_stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
BACKUP_DIR="$ROOT/backups/deploy/${backup_stamp}-${EXPECTED_SHA}"
mkdir -p "$BACKUP_DIR"
for file in dnd.db dnd.db-wal dnd.db-shm; do
  [ -f "$ROOT/$file" ] && cp -a "$ROOT/$file" "$BACKUP_DIR/$file"
done
verify_database "$BACKUP_DIR/dnd.db" || die 'pre-migration database backup failed integrity_check'
log "Created pre-migration database backup: $BACKUP_DIR"

if ! (cd "$release_dir" && DB_PATH="$ROOT/dnd.db" NODE_ENV=production node dist-server/scripts/db-migrate.js) >>"$LOG" 2>&1; then
  die 'database migration failed'
fi

switch_current "$release_dir"
"$SUDO" "$SYSTEMCTL" start "$SERVICE_NAME" >>"$LOG" 2>&1
if ! wait_for_ready "$EXPECTED_SHA"; then
  die "release did not become ready: $EXPECTED_SHA"
fi

COMPLETED=1
SERVICE_STOPPED=0
if [ "$RELEASE_KEEP" -gt 0 ] 2>/dev/null; then
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9a-f]{40}' -printf '%f\n' 2>/dev/null \
    | sort -r \
    | tail -n +$((RELEASE_KEEP + 1)) \
    | while read -r old_release; do
        [ "$old_release" = "$EXPECTED_SHA" ] && continue
        log "Removing old release: $old_release"
        rm -rf "$RELEASES_DIR/$old_release"
      done
fi
log "Release deployed and ready: $EXPECTED_SHA"
