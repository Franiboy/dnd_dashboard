#!/usr/bin/env bash
# D&D Dashboard backup: consistent SQLite dump, runtime data and recordings.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${DND_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUNTIME_DIR="${DND_RUNTIME_DIR:-$APP_DIR/current}"
[ -d "$RUNTIME_DIR" ] || RUNTIME_DIR="$APP_DIR"
BACKUP_ROOT="${DND_BACKUP_ROOT:-$HOME/backups/dnd}"
KEEP_DAILY="${DND_BACKUP_KEEP_DAILY:-7}"
LOG_DIR="${DND_LOG_DIR:-$HOME/logs}"
LOG="$LOG_DIR/dnd-backup.log"
# Share the deployment lock so backups never overlap migrations/release switches.
LOCK="${DND_DEPLOY_LOCK:-/tmp/dnd-release-deploy.lock}"
ZSTD_LEVEL="${DND_ZSTD_LEVEL:-3}"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use --silent default

mkdir -p "$LOG_DIR" "$BACKUP_ROOT"
DATE="$(date '+%Y%m%d-%H%M%S')"
FINAL_DIR="$BACKUP_ROOT/$DATE"
PARTIAL_DIR="$BACKUP_ROOT/.${DATE}.partial"
TEMP_DB="${TMPDIR:-/tmp}/dnd-db-${DATE}-$$.backup"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"
}

cleanup() {
  rm -f "$TEMP_DB"
  rm -rf "$PARTIAL_DIR"
}
trap cleanup EXIT

exec 9>"$LOCK"
if ! flock -n 9; then
  log 'Deployment or another backup is already running'
  exit 0
fi

DB_PATH="${DB_PATH:-}"
if [ -z "$DB_PATH" ] && [ -f "$APP_DIR/.env" ]; then
  DB_PATH="$(sed -n 's/^DB_PATH=//p' "$APP_DIR/.env" | head -n 1)"
fi
DB_PATH="${DB_PATH:-$APP_DIR/dnd.db}"
[[ "$DB_PATH" = /* ]] || DB_PATH="$APP_DIR/$DB_PATH"
[ -f "$DB_PATH" ] || { log "ERROR: database not found: $DB_PATH"; exit 1; }

PREV_DIR=''
if [ -d "$BACKUP_ROOT" ]; then
  PREV_NAME="$(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -name '20*' -exec test -f '{}/COMPLETE' ';' -printf '%f\n' 2>/dev/null | sort -r | head -n 1)"
  [ -n "$PREV_NAME" ] && PREV_DIR="$BACKUP_ROOT/$PREV_NAME"
fi

mkdir -p "$PARTIAL_DIR"
log "Starting backup -> $FINAL_DIR"

# SQLite's backup API creates a consistent snapshot even while WAL is active.
(
  cd "$RUNTIME_DIR"
  DB_PATH="$DB_PATH" BACKUP_PATH="$TEMP_DB" node - <<'NODE'
const Database = require('better-sqlite3');
const database = new Database(process.env.DB_PATH, { readonly: true });
database.backup(process.env.BACKUP_PATH).then(() => database.close()).catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
) >>"$LOG" 2>&1
gzip -c -9 "$TEMP_DB" > "$PARTIAL_DIR/dnd.db.gz"
rm -f "$TEMP_DB"
log 'SQLite backup completed'

if [ -d "$APP_DIR/data" ]; then
  tar czf "$PARTIAL_DIR/data.tar.gz" -C "$APP_DIR" data >>"$LOG" 2>&1
fi

if [ -f "$APP_DIR/.env" ]; then
  cp -a "$APP_DIR/.env" "$PARTIAL_DIR/.env"
fi

if [ -d "$APP_DIR/recordings" ] && find "$APP_DIR/recordings" -type f -print -quit | grep -q .; then
  command -v zstd >/dev/null 2>&1 || {
    log 'ERROR: recordings exist but zstd is unavailable'
    exit 1
  }
  REC_DEST="$PARTIAL_DIR/recordings"
  mkdir -p "$REC_DEST"
  REC_PREV="$PREV_DIR/recordings"
  compressed=0
  linked=0
  while IFS= read -r -d '' file; do
    relative="${file#"$APP_DIR/recordings/"}"
    target="$REC_DEST/$relative.zst"
    mkdir -p "$(dirname "$target")"
    previous="$REC_PREV/$relative.zst"
    if [ -n "$REC_PREV" ] && [ -f "$previous" ] && [ ! "$file" -nt "$previous" ]; then
      ln "$previous" "$target"
      linked=$((linked + 1))
    else
      zstd -q -"$ZSTD_LEVEL" -f -o "$target" "$file"
      compressed=$((compressed + 1))
    fi
  done < <(find "$APP_DIR/recordings" -type f -print0)
  log "recordings: $compressed compressed, $linked hard-linked"
fi

(
  cd "$PARTIAL_DIR"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 -r sha256sum > SHA256SUMS
)
touch "$PARTIAL_DIR/COMPLETE"
mv "$PARTIAL_DIR" "$FINAL_DIR"
trap - EXIT
rm -f "$TEMP_DB"

cd "$BACKUP_ROOT"
find . -maxdepth 1 -mindepth 1 -type d -name '20*' -exec test -f '{}/COMPLETE' ';' -printf '%f\n' 2>/dev/null \
  | sort -r \
  | tail -n +$((KEEP_DAILY + 1)) \
  | while read -r old; do
      log "Pruning old backup: $old"
      rm -rf "$BACKUP_ROOT/$old"
    done

log "Backup complete: $FINAL_DIR"
