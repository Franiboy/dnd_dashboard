#!/usr/bin/env bash
# D&D Dashboard health check. Restarts the service if /health is unreachable,
# but stays hands-off while a deploy (which restarts the service itself) is running.
set -euo pipefail

LOCK="/tmp/dnd-deploy.lock"
HEALTH_URL="${DND_HEALTH_URL:-http://localhost:3001/health}"

# Skip while a deploy holds the lock.
if flock -n "$LOCK" true 2>/dev/null; then
  :
else
  exit 0
fi

if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

sudo systemctl restart dnd-dashboard
