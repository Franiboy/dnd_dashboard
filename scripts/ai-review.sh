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
# Merging prefers GitHub auto-merge and falls back to a direct squash merge
# when the repository disallows auto-merge. Both paths only ever merge the
# exact reviewed commit (verified via head SHA) and trigger the separate
# release workflow with that merge SHA.
#
# Requires: gh (GH_TOKEN), opencode on PATH, git identity is set here.
set -euo pipefail

MODEL="${AI_REVIEW_MODEL:-opencode-go/gpt-6-luna}"
HOLD_LABEL="${AI_HOLD_LABEL:-hold}"
BLOCKERS_FILE=".ai-review-blockers.md"
MAX_DIFF_CHARS=150000

PR_NUMBER="${PR_NUMBER:?PR_NUMBER is required}"
BASE_BRANCH="${BASE_BRANCH:?BASE_BRANCH is required}"
BASE="origin/${BASE_BRANCH}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
HEAD_REPOSITORY="${HEAD_REPOSITORY:?HEAD_REPOSITORY is required}"
PR_ACTOR="${PR_ACTOR:?PR_ACTOR is required}"
TRUSTED_ACTOR="${AI_TRUSTED_ACTOR:-Franiboy}"
RELEASE_WORKFLOW="${RELEASE_WORKFLOW:-release.yml}"

if [ "$HEAD_REPOSITORY" != "$GITHUB_REPOSITORY" ] || [ "$PR_ACTOR" != "$TRUSTED_ACTOR" ]; then
	echo "[ai-review] Skipping AI review for an untrusted PR actor or repository"
	exit 0
fi

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

# Mark the PR as being in its auto-merge sequence. The ci-cd workflow uses
# this label to (a) never cancel the currently running ai-review job when the
# fix-commit push below triggers a fresh run, and (b) skip the ai-review job on
# that follow-up run so the merge is not raced by a duplicate review. Set it
# right before any push/merge so a triggering push can no longer interrupt it.
AUTOMERGE_LABEL="automerge"

# Label mutations must go through the plain REST endpoints: `gh pr edit` reads
# the PR via GraphQL including the retired Projects (classic) fields, which
# fails on this repository ("Projects (classic) is being deprecated...").
set_automerge_label() {
	if ! has_label "$AUTOMERGE_LABEL"; then
		log "Setting '$AUTOMERGE_LABEL' label on PR #$PR_NUMBER to protect the merge from concurrency cancellation"
		gh api --method POST "repos/{owner}/{repo}/issues/$PR_NUMBER/labels" -f "labels[]=$AUTOMERGE_LABEL" >/dev/null || {
			log "WARN: could not add '$AUTOMERGE_LABEL' label; continuing (merge may race follow-up runs)"
		}
	fi
}

# Clear the label again only when the merge did not complete. On a successful
# merge the label is intentionally left in place: the follow-up run triggered
# by our fix-commit push is then already past (or skipping) its steps, and
# removing it mid-flight could race that run.
remove_automerge_label() {
	if has_label "$AUTOMERGE_LABEL"; then
		log "Removing '$AUTOMERGE_LABEL' label from PR #$PR_NUMBER"
		gh api --method DELETE "repos/{owner}/{repo}/issues/$PR_NUMBER/labels/$AUTOMERGE_LABEL" >/dev/null || true
	fi
}

trigger_release() {
	local merge_sha="$1"
	log "Triggering release workflow for ${merge_sha:0:7}"
	gh workflow run "$RELEASE_WORKFLOW" \
		--repo "$GITHUB_REPOSITORY" \
		--ref "$BASE_BRANCH" \
		-f "sha=$merge_sha"
}

merge_pr() {
	# The commit that was reviewed and locally validated: merging anything else
	# would auto-merge unreviewed code (e.g. a push that lands while --auto is
	# queued). Verify the head still points at it right before and throughout
	# the auto-merge; on any mismatch cancel the auto-merge and fail.
	local target_sha
	target_sha="$(git rev-parse HEAD)"
	log "Merging PR #$PR_NUMBER (auto-merge, squash, delete branch) for head ${target_sha:0:7}"

	if [ "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" != "$target_sha" ]; then
		log "ERROR: PR head moved away from the reviewed commit before merging"
		return 1
	fi

	# Use --auto so GitHub performs the merge as soon as the PR is mergeable.
	# This crucially avoids failing on the transient 'UNSTABLE'/'Head branch is
	# out of date' state and on the `action_required` check-suite that the bot
	# push leaves behind on private repos: the PR is merged once GitHub accepts
	# it, and we are not racing a stale, unapproved CI run.
	local auto_output
	if auto_output="$(gh pr merge "$PR_NUMBER" --auto --squash --delete-branch --match-head-commit "$target_sha" 2>&1)"; then
		# --auto only queues the merge; wait for the exact merged commit before
		# dispatching the release workflow.
		if wait_for_merged "$target_sha"; then
			return 0
		fi
		# Never leave auto-merge armed: GitHub could merge the (unchanged) head
		# after this job already failed, with no deployment afterwards because
		# workflow-token merges do not trigger the main deploy job.
		log "Disabling auto-merge after timeout"
		gh pr merge "$PR_NUMBER" --disable-auto >/dev/null 2>&1 || true
		return 1
	fi

	# The repository may disallow auto-merge entirely ("Auto merge is not
	# allowed for this repository"): fall back to a direct squash merge of the
	# same reviewed commit instead of failing the whole pipeline.
	if echo "$auto_output" | grep -qi "auto merge is not allowed"; then
		log "WARN: auto-merge is disabled on this repository; falling back to direct squash merge"
		direct_merge_pr "$target_sha"
		return $?
	fi
	log "ERROR: could not queue auto-merge: $auto_output"
	return 1
}

# Wait until the PR reaches MERGED (then trigger release) or fail on CLOSED/timeout.
# Shared by the auto-merge and direct-merge paths.
wait_for_merged() {
	local target_sha="$1"
	local timeout_seconds="${CI_WAIT_TIMEOUT_SECONDS:-90}"
	local deadline=$(( $(date +%s) + timeout_seconds ))
	while [ "$(date +%s)" -lt "$deadline" ]; do
		# Abort immediately if the head moves off the reviewed commit.
		if [ "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" != "$target_sha" ]; then
			log "ERROR: head changed while merging"
			return 1
		fi
		local state merged_at oid
		read -r state merged_at oid <<<"$(gh pr view "$PR_NUMBER" --json state,mergedAt,mergeCommit --jq '[.state,.mergedAt//"",.mergeCommit.oid//""] | @tsv')"
		if [ "$state" = "MERGED" ] && [ -n "$merged_at" ]; then
			[ -n "$oid" ] || {
				log "ERROR: merged PR did not report a merge commit"
				return 1
			}
			log "PR #$PR_NUMBER merged as ${oid:0:7}"
			trigger_release "$oid"
			return 0
		fi
		if [ "$state" = "CLOSED" ]; then
			log "ERROR: PR #$PR_NUMBER is CLOSED without a merge"
			return 1
		fi
		sleep 3
	done
	log "ERROR: PR #$PR_NUMBER did not reach MERGED within ${timeout_seconds}s"
	return 1
}

# Direct squash merge for repositories with auto-merge disabled. Only ever
# merges the exact reviewed commit: the merge itself is pinned to it via
# --match-head-commit (server-side atomic check), aborts if the head moves
# and retries until GitHub reports the PR mergeable (checks may still be
# settling).
direct_merge_pr() {
	local target_sha="$1"
	local timeout_seconds="${CI_WAIT_TIMEOUT_SECONDS:-90}"
	local deadline=$(( $(date +%s) + timeout_seconds ))
	while [ "$(date +%s)" -lt "$deadline" ]; do
		if [ "$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)" != "$target_sha" ]; then
			log "ERROR: head changed before direct merge; aborting"
			return 1
		fi
		local mergeable
		mergeable="$(gh pr view "$PR_NUMBER" --json mergeable --jq .mergeable)"
		if [ "$mergeable" = "MERGEABLE" ]; then
			if gh pr merge "$PR_NUMBER" --squash --delete-branch --match-head-commit "$target_sha"; then
				wait_for_merged "$target_sha"
				return $?
			fi
			log "Direct merge rejected for now; retrying"
		fi
		sleep 5
	done
	log "ERROR: PR #$PR_NUMBER did not become mergeable within ${timeout_seconds}s"
	return 1
}

# After the review pushes a fix commit, that push triggers a fresh workflow
# run whose `ci` checks are still pending. Merging immediately races that run
# and GitHub rejects the merge ("Pull Request is not mergeable"), leaving the
# PR stuck. Wait until the required checks (ci) turn green before merging.
# Only the required checks are watched, so this never blocks on this job's own
# (non-required) "AI review" check, which would deadlock.
#
# Fix commits are pushed with the workflow's GITHUB_TOKEN, which on private
# repos with self-hosted runners often triggers a run with conclusion
# `action_required` (needs manual approval) or no `required` checks at all
# (private without Pro). Local validation already ran lint/build/test, so a
# missing or unapproved CI must never block the merge – otherwise the PR stays
# stuck in `action_required` forever.
rebase_head_to_base() {
	# Keep the PR head on top of the latest base so `gh pr merge` never fails
	# with "Head branch is out of date". Only rebase if there is something to
	# fetch; a clean replay of local commits (force-push) is fine here because
	# the only author of the head is this bot during review.
	log "Rebasing PR head onto latest $BASE_BRANCH"
	git fetch origin "$BASE_BRANCH" --quiet
	if ! git rebase "origin/$BASE_BRANCH"; then
		git rebase --abort >/dev/null 2>&1 || true
		log "WARN: rebase onto $BASE_BRANCH had conflicts; leaving head as-is (local validation already green)"
	fi
	git push --force-with-lease origin HEAD:refs/heads/$(git rev-parse --abbrev-ref HEAD) || {
		log "ERROR: could not push rebased head; refusing to merge"
		return 1
	}
}

wait_for_ci() {
	local pr="$1"
	local timeout_seconds="${CI_WAIT_TIMEOUT_SECONDS:-180}"
	log "Waiting for required CI checks on PR #$pr (timeout ${timeout_seconds}s)"
	# Bring the head up to date first so the resulting/auto merge is never
	# rejected for being out of date against base.
	rebase_head_to_base
	local log_file
	log_file="$(mktemp)"
	if timeout "$timeout_seconds" gh pr checks "$pr" --watch --fail-fast --required --interval 15 2>&1 | tee "$log_file"; then
		log "Required CI checks green"
		rm -f "$log_file"
		return 0
	fi
	log "ERROR: required CI checks did not complete successfully; refusing to merge"
	cat "$log_file" || true
	rm -f "$log_file"
	return 1
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
- NEVER modify the pipeline itself: scripts/ai-review.sh and .github/workflows/ are off limits. Report concerns about them in \"$BLOCKERS_FILE\" instead.
- Do NOT touch style, naming, formatting, test coverage nits; do not refactor anything unrelated to this diff.
- Only modify files that are part of this diff (plus minimal adjacent changes your fix requires).
- Repository conventions: comments and commit messages in English, ESM imports.
- If you find a critical problem you CANNOT fix safely, do not guess: write a concise description to the file \"$BLOCKERS_FILE\" and change nothing else.

Here is the diff:

$DIFF"

log "Running OpenCode review (model: $MODEL)"
hide_project_config

# Checksums of pipeline-critical files. The review must never edit its own
# running script or the workflow definition; revert and continue if it does.
PIPELINE_FILES=(scripts/ai-review.sh scripts/dnd-release-deploy.sh scripts/package-release.sh scripts/dnd-server-setup.sh scripts/dnd-backup.sh systemd/dnd-dashboard.service .github/workflows/ci-cd.yml .github/workflows/release.yml)
declare -A PIPELINE_HASHES
for f in "${PIPELINE_FILES[@]}"; do
	PIPELINE_HASHES[$f]="$(sha256sum "$f" | cut -d' ' -f1)"
done

# Pipe the prompt via stdin instead of passing it as an argument: Linux caps a
# single argv entry at 128 KiB (MAX_ARG_STRLEN), so large PR diffs fail exec
# with E2BIG ("Argument list too long"). opencode run reads non-TTY stdin and
# appends it to the message.
printf '%s' "$PROMPT" | opencode run --standalone -m "$MODEL" --auto --title "AI PR review #$PR_NUMBER"
restore_project_config

for f in "${PIPELINE_FILES[@]}"; do
	if [ "$(sha256sum "$f" | cut -d' ' -f1)" != "${PIPELINE_HASHES[$f]}" ]; then
		log "WARNING: AI modified $f while it was in use; reverting self-edit"
		# Restore from HEAD (index AND working tree): restoring from the index
		# alone would resurrect an edit the model had already staged.
		git checkout HEAD -- "$f"
	fi
done

if [ -f "$BLOCKERS_FILE" ]; then
	fail_with_blockers
fi

if git diff --quiet && git diff --cached --quiet; then
	log "Review clean, no fixes necessary"
	set_automerge_label
	if ! merge_pr; then
		remove_automerge_label
		exit 1
	fi
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
# Protect the upcoming push/merge: without this label the push would cancel
# (concurrency) the very job that is about to merge.
set_automerge_label
git push
wait_for_ci "$PR_NUMBER" || exit 1
if ! merge_pr; then
	remove_automerge_label
	exit 1
fi
