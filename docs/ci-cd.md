# CI/CD Pipeline

The pipeline lives in [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml) and runs on a **self-hosted runner** hosted on the same machine as the app (`~/actions-runner`, systemd service). All jobs run sequentially on that single runner and share one persistent workspace (`checkout` uses `clean: false`).

## Jobs

| Job         | When                        | What                                                                                                                         |
| ----------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ci`        | push to `main`, every PR    | Lint, build, test                                                                                                            |
| `deploy`    | push to `main` only         | `scripts/dnd-deploy.sh`: fast-forward pull, DB migrations (`npm run db:migrate`), rebuild, health check, rollback on failure |
| `ai-review` | PRs only, after `ci` passed | AI code review, auto-fix of critical findings, auto-merge                                                                    |

Feature branches are validated exclusively via the `pull_request` event (exactly one run per PR), `push` triggers only for `main`.

Before the fast-forward pull, `scripts/dnd-deploy.sh` gates on the RS256 session key pair under `data/keys/` (see `server/auth.ts`): it aborts when both keys are missing, only one exists, or the files are empty/unreadable. A restart with a missing pair would silently generate new keys (logging out every user) and a half-present pair makes the server `exit(1)` right after the restart. Fresh installs can explicitly allow key generation with `DND_DEPLOY_ALLOW_NEW_JWT_KEYS=1` (deploy-script variable, not read by the server).

## AI review job

After the normal CI has passed, OpenCode CLI reviews the PR diff headlessly:

1. **Skip:** PRs labeled `hold` are never reviewed or merged automatically.
2. **Review & fix:** the model fixes _critical_ findings only (security, data loss, crashes, broken functionality) directly in the workspace. Style/refactoring is explicitly out of scope.
3. **Blockers:** findings the model cannot fix safely are written to `.ai-review-blockers.md`, posted as a PR comment, and the job fails without merging.
4. **Validation:** if the AI changed files, lint/build/test run again locally. Green → fix commit is pushed to the PR branch and the PR is squash-merged. Red → changes are discarded, a comment explains what failed.
5. **Clean:** if the AI changed nothing, the PR is squash-merged right away.
6. **Deploy:** every auto-merge immediately deploys afterwards (`scripts/dnd-deploy.sh` against `/dnd_dashboard`). This is necessary because merges performed with the workflow `GITHUB_TOKEN` do not trigger push events – the normal `deploy` job would never run for them.

Configuration via job env vars in the workflow:

- `AI_REVIEW_MODEL` – OpenCode model in `provider/model` format (default: `opencode-go/gpt-5.6-luna`)
- `AI_HOLD_LABEL` – opt-out label (default: `hold`)

### Notes & limitations

- The project `opencode.json` (MCP servers pointing at the live checkout) is temporarily hidden during the review so the AI works strictly inside the isolated CI workspace.
- Fix commits pushed with the workflow's `GITHUB_TOKEN` intentionally do not re-trigger workflows (GitHub recursion protection); that is why validation happens inside the same job.
- The runner needs `opencode` on `PATH` (`~/.opencode/bin`) and an authenticated OpenCode credential for the configured provider.
- Trust model: this automation assumes trusted contributors. PR content can theoretically contain prompt injection; do not enable it for public forks.

## Assistant duties

Coding assistants keep the loop closed: after opening a PR they actively watch the pipeline until the `ai-review` job merges it or it fails, fix and re-push on red instead of leaving the PR stale, and clean up the branch and worktree after a successful merge (see [`AGENTS.md`](../AGENTS.md)).
