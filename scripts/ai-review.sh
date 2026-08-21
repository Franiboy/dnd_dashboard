#!/usr/bin/env bash
# AI-powered PR review pipeline.
#
# OpenCode reviews the PR diff, fixes critical findings and the PR is
# squash-merged once everything is clean. Flow:
#
#   1. Skip entirely when the PR carries the hold label (opt-out).
#   2. Ask the model to fix critical findings in the working tree.
#      - Unfixable criticals are reported via a blocker file -> PR comment,
#        job fails, no merge.
#   3. If the AI changed files: validate locally (lint/build/test).
#      - Green: push fix commit + squash merge.
#      - Red: discard the AI changes, comment on the PR, fail.
#   4. If the AI changed nothing: squash merge (the ci job already passed).
#
# Requires: gh (GH_TOKEN), opencode on PATH, git identity is set here.
set -euo pipefail

MODEL="${AI_REVIEW_MODEL:-opencode-go/gpt-5.6-luna}"
HOLD_LABEL="${AI_HOLD_LABEL:-hold}"
BLOCKERS_FILE=".ai-review-blockers.md"
MAX_DIFF_CHARS=150000

PR_NUMBER="${PR_NUMBER:?PR_NUMBER is required}"
BASE_BRANCH="${BASE_BRANCH:?BASE_BRANCH is required}"
BASE="origin/${BASE_BRANCH}"

log() { echo "[ai-review] $*"; }

# The checked-out project opencode.json registers MCP servers pointing at the
# live production checkout (/dnd_dashboard). Hide it while the review runs so
# the AI works strictly inside this isolated CI workspace.
hide_project_config() {
	if [ -f opencode.json ]; then
		mv opencode.json opencode.json.ci-hidden
	fi
}

restore_project_config() {
	if [ -f opencode.json.ci-hidden ]; then
		mv -f opencode.json.ci-hidden opencode.json
	fi
}
trap restore_project_config EXIT

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

has_label() {
	gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' | grep -qx "$1"
}

merge_pr() {
	log "Squash merging PR #$PR_NUMBER"
	gh pr merge "$PR_NUMBER" --squash --delete-branch
}

fail_with_blockers() {
	log "Critical unfixed findings reported; posting to PR and failing"
	gh pr comment "$PR_NUMBER" --body "$(cat "$BLOCKERS_FILE")"
	rm -f "$BLOCKERS_FILE"
	exit 1
}

# Opt-out: never touch or merge PRs marked with the hold label.
if has_label "$HOLD_LABEL"; then
	log "Hold label present, skipping AI review entirely"
	exit 0
fi

DIFF="$(git diff "$BASE"...HEAD)"
if [ -z "$DIFF" ]; then
	log "No diff against $BASE_BRANCH, nothing to review"
	exit 0
fi
if [ "${#DIFF}" -gt "$MAX_DIFF_CHARS" ]; then
	DIFF="${DIFF:0:$MAX_DIFF_CHARS}
... (diff truncated)"
fi

PROMPT="You are a strict code reviewer for this repository (a D&D dashboard: React 19/Vite/TypeScript frontend, Express/SQLite backend, ESM everywhere).
First run: gh pr view $PR_NUMBER --json title,body --jq '.title + \"\\n\\n\" + .body' to understand the intent of this pull request.
Then review the following pull request diff against branch \"$BASE_BRANCH\".

Rules:
- Fix CRITICAL findings only: security vulnerabilities, data loss, crashes or bugs introduced by this diff, broken functionality.
- NEVER undo or restructure the core approach this PR implements (see its title/body and commit messages). If you believe the approach itself is wrong but it works, do NOT rewrite it: report your concern in \"$BLOCKERS_FILE\" instead and change nothing else.
- Do NOT touch style, naming, formatting, test coverage nits; do not refactor anything unrelated to this diff.
- Only modify files that are part of this diff (plus minimal adjacent changes your fix requires).
- Repository conventions: comments and commit messages in English, ESM imports.
- If you find a critical problem you CANNOT fix safely, do not guess: write a concise description to the file \"$BLOCKERS_FILE\" and change nothing else.
- When done and everything critical is fixed (or there was nothing critical), make sure \"$BLOCKERS_FILE\" does NOT exist.

Here is the diff:

$DIFF"

log "Running OpenCode review (model: $MODEL)"
hide_project_config
opencode run -m "$MODEL" --auto --title "AI PR review #$PR_NUMBER" "$PROMPT"
restore_project_config

if [ -f "$BLOCKERS_FILE" ]; then
	fail_with_blockers
fi

if git diff --quiet && git diff --cached --quiet; then
	log "Review clean, no fixes necessary"
	merge_pr
	exit 0
fi

SUMMARY="$(git diff --stat)"
log "AI applied fixes, validating locally:"
git diff --stat

set +e
npm run lint && npm run build && npm test
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ]; then
	log "Validation FAILED for AI fixes (exit $STATUS); discarding changes"
	git reset --hard HEAD
	gh pr comment "$PR_NUMBER" --body "🤖 AI review ($MODEL) found critical issues but its automatic fixes did not pass lint/build/test. Changes were **discarded** – please review manually.

<details><summary>Attempted changes</summary>

\`\`\`
$SUMMARY
\`\`\`
</details>"
	exit 1
fi

log "Validation green; pushing fix commit and merging"
git add -A
git commit -m "fix(ai-review): address critical review findings

Applied automatically by the AI review pipeline (model: $MODEL).
Validated with lint, build and tests before push.

$SUMMARY"
git push
merge_pr
