#!/usr/bin/env bash
# Restart the service only when readiness fails and no release deploy holds the lock.
set -euo pipefail

LOCK="${DND_DEPLOY_LOCK:-/tmp/dnd-release-deploy.lock}"
HEALTH_URL="${DND_READY_URL:-http://127.0.0.1:3001/ready}"
SERVICE_NAME="${DND_SERVICE_NAME:-dnd-dashboard}"
SYSTEMCTL="${DND_SYSTEMCTL:-systemctl}"
SUDO="${DND_SUDO:-sudo}"

exec 8>"$LOCK"
if ! flock -n 8; then
  exit 0
fi

if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

"$SUDO" "$SYSTEMCTL" restart "$SERVICE_NAME"
sleep 3
curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null
