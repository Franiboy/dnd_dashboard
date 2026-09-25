#!/usr/bin/env bash
# Fail closed when a workflow in this repository schedules a job on a
# self-hosted runner.
#
# The whole trust boundary rests on this repository never running code on the
# production host: the write-capable automation lives in the private repository
# and is called across repositories, because a called workflow inherits the
# caller repository's runner context. A single `runs-on: self-hosted` here would
# execute pull request code on HomeServer. Documentation alone cannot hold that
# invariant, so it is checked.
set -Eeuo pipefail
umask 077

REPO_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WORKFLOW_DIR="$REPO_ROOT/.github/workflows"

fail() {
  printf '[verify-source-runners] ERROR: %s\n' "$*" >&2
  exit 1
}

[ -d "$WORKFLOW_DIR" ] || fail "workflow directory is missing: $WORKFLOW_DIR"

violations=0
checked=0
for workflow in "$WORKFLOW_DIR"/*.yml "$WORKFLOW_DIR"/*.yaml; do
  [ -f "$workflow" ] || continue
  checked=$((checked + 1))
  # Only `runs-on` lines are inspected, so prose in comments cannot trip the
  # check and a mentioned label cannot hide a real one.
  while IFS= read -r line; do
    printf '  %s: %s\n' "${workflow#"$REPO_ROOT"/}" "$(printf '%s' "$line" | sed 's/^[[:space:]]*//')" >&2
    violations=$((violations + 1))
  done < <(grep -nE '^[[:space:]]*(-[[:space:]]+)?runs-on:.*self-hosted' "$workflow" || true)
done

[ "$checked" -gt 0 ] || fail 'no workflow files were inspected'

if [ "$violations" -ne 0 ]; then
  fail "the source repository must not schedule any job on a self-hosted runner ($violations violation(s))"
fi

printf '[verify-source-runners] %d workflow file(s) checked, no self-hosted job\n' "$checked"
