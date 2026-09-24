#!/usr/bin/env bash
# Legacy in-place deployment is intentionally disabled.
set -euo pipefail

cat >&2 <<'EOF'
The legacy in-place deploy script is disabled.
Production releases are built in CI and deployed with:
  scripts/dnd-release-deploy.sh
See .github/workflows/release.yml and docs/ci-cd.md.
EOF
exit 1
