#!/usr/bin/env bash
# D&D Dashboard backup: consistent SQLite dump (WAL-safe) + compressed data dirs.
#
# recordings/ are raw WAV (uncompressed); each file is stored as <name>.zst via
# zstd (deterministic output). Unchanged files hard-link against the previous
# backup so only new/changed material costs space.
# Restore: gunzip dnd.db.gz, tar xzf data.tar.gz, zstd -d recordings/*.zst.
#
# All paths resolve relative to this script / $HOME; override with env vars.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${DND_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_ROOT="${DND_BACKUP_ROOT:-$HOME/backups/dnd}"
KEEP_DAILY="${DND_BACKUP_KEEP_DAILY:-7}"
LOG_DIR="${DND_LOG_DIR:-$HOME/logs}"
LOG="$LOG_DIR/dnd-backup.log"
LOCK="/tmp/dnd-backup.lock"
ZSTD_LEVEL=3

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="${NVM_DIR}/versions/node/v24.15.0/bin:$PATH"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

exec 9>"$LOCK"
if ! flock -n 9; then
  log "Another run is in progress, skipping"
  exit 0
fi

DATE=$(date '+%Y%m%d-%H%M%S')
DEST="$BACKUP_ROOT/$DATE"
mkdir -p "$DEST"

# Newest previous backup dir (for recordings hard-link dedup).
PREV_DIR=""
if [ -d "$BACKUP_ROOT" ]; then
  PREV_DIR=$(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -name '20*' ! -name "$DATE" -printf '%f\n' 2>/dev/null | sort -r | head -n 1)
  [ -n "$PREV_DIR" ] && PREV_DIR="$BACKUP_ROOT/$PREV_DIR" || PREV_DIR=""
fi

log "Starting backup -> $DEST"

# Consistent SQLite backup via better-sqlite3 backup API (WAL-safe), gzipped.
DB_BACKUP="$DEST/dnd.db.gz"
(cd "$APP_DIR" && node -e "
const Database = require('better-sqlite3');
const db = new Database('dnd.db', { readonly: true });
db.backup('/tmp/dnd-db-$$.backup').then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('SQLite backup failed:', err);
  process.exit(1);
});
") >>"$LOG" 2>&1
gzip -c -9 "/tmp/dnd-db-$$.backup" > "$DB_BACKUP"
rm -f "/tmp/dnd-db-$$.backup"
log "SQLite backup OK (gzipped)"

# Runtime data (diary, sessions, bingo). Small enough to copy.
if [ -d "$APP_DIR/data" ]; then
  tar czf "$DEST/data.tar.gz" -C "$APP_DIR" data >>"$LOG" 2>&1
fi

# Config (secrets stay on this host; backup for disaster recovery).
if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" "$DEST/.env"
fi

# Recordings: per-file zstd, hard-link dedup against previous backup.
if [ -d "$APP_DIR/recordings" ] && command -v zstd >/dev/null 2>&1; then
  REC_DEST="$DEST/recordings"
  mkdir -p "$REC_DEST"
  REC_PREV="$PREV_DIR/recordings"
  count=0
  linked=0
  while IFS= read -r -d '' f; do
    rel="${f#"$APP_DIR/recordings/"}"
    target="$REC_DEST/$rel.zst"
    mkdir -p "$(dirname "$target")"
    prev_target="$REC_PREV/$rel.zst"
    # Unchanged recordings are write-once: if the previous backup already has
    # this file and the source is not newer than it, re-use via hard-link.
    # (zstd preserves the source mtime, so use "not newer" not "older".)
    if [ -n "$REC_PREV" ] && [ -f "$prev_target" ] && [ ! "$f" -nt "$prev_target" ]; then
      ln "$prev_target" "$target"
      linked=$((linked + 1))
    else
      zstd -q -"$ZSTD_LEVEL" -f -o "$target" "$f"
      count=$((count + 1))
    fi
  done < <(find "$APP_DIR/recordings" -type f -print0)
  log "recordings: $count compressed, $linked hard-linked from previous backup"
fi

# Prune old backups, keep the newest KEEP_DAILY.
cd "$BACKUP_ROOT"
ls -1d */ 2>/dev/null | sort -r | tail -n +$((KEEP_DAILY + 1)) | while read -r old; do
  log "Pruning old backup: $old"
  rm -rf "$old"
done

log "Backup complete: $DEST"
