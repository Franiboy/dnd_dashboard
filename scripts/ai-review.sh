#!/usr/bin/env bash
# Legacy compatibility stub.
#
# AI review is intentionally implemented in the private deployment repository.
# Keeping a write-capable copy here would make the automation depend on a
# source-PR-controlled file. Use the private reusable workflow instead.
set -euo pipefail

cat >&2 <<'EOF'
The source-tree AI review script is no longer executed.
Trusted AI review, automatic squash merge and production CD are implemented by
Franiboy/dnd_dashboard-deploy/.github/workflows/ai-review.yml.
See docs/ci-cd.md for the current flow.
EOF
exit 1
