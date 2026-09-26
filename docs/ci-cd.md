# CI/CD Pipeline

The source repository, the private automation repository, the ephemeral AI
runner and the production runner are separate trust boundaries.

- **Hosted source CI:** `.github/workflows/ci-cd.yml` runs ordinary checks on
  GitHub-hosted `ubuntu-24.04` runners.
- **Hosted AI dispatch:** the trusted base-branch `pull_request_target` job
  dispatches the private deployment workflow with a narrowly scoped Actions
  token. It does not call a self-hosted reusable workflow directly.
- **Private AI dispatcher:** `Franiboy/dnd_dashboard-deploy` validates the
  source run and pull request, then calls its reusable AI workflow at an
  immutable private commit.
- **Ephemeral AI runner:** a host supervisor creates a JIT runner for one
  private `Isolated AI review` job. Each job gets a fresh rootless container,
  internal network namespace and dynamic runner label.
- **Hosted validation:** a clean GitHub-hosted job applies the AI patch and runs
  dependency installation, formatting, lint, tests and build without a write
  credential.
- **Hosted promotion:** a separate clean job receives the source write token
  only after validation, verifies the original artifact and exact source head,
  waits for fresh CI and performs an exact-head squash merge.
- **Release build:** `.github/workflows/release.yml` builds an exact source
  commit, verifies the artifact, and publishes non-replaceable checksummed
  release assets.
- **Private production deployment:** the private repository starts its
  `HomeServer` workflow with an exact source SHA and performs a transactional
  deployment.

The source repository must not contain a job with `runs-on: self-hosted`.
Keeping the runners and write-capable automation in a separate repository is
the security boundary that prevents a public pull request from adding or
redirecting a production job. Because this invariant decides whether pull
request code can reach the production host, it is enforced by
`scripts/verify-source-runners.sh` and covered by `tests/ci/sourceRunners.test.ts`
rather than only by this paragraph.

## Accepted risk: no enforced branch protection

The branch protection and ruleset APIs answer `403 Upgrade to GitHub Pro or make
this repository public to enable this feature.` for both repositories, so
required reviews, required status checks and a "no direct push" rule cannot be
enforced by GitHub on the current plan.

The activation gates are nevertheless enabled, because the canaries proved the
chain works. The accepted consequence is explicit:

- **A direct push to `main` bypasses the AI review and the promotion step.**
  Such a push still produces a normal release build with the full test suite, the
  native module gate and the transactional deployment, so it cannot ship a broken
  or undeployable artifact. It can ship a change that no model reviewed.
- `hold` and `automerge` are therefore conventions, not permissions: they
  constrain the automation, not a human with push access.

Mitigations that do not depend on the plan: a direct push is visible in the
release run and in the deployment log, the deployment can only install an
immutable checksummed release of a commit that is an ancestor of `main`, and the
private automation pins the exact private commit it executes. Re-evaluate this
decision as soon as branch protection or rulesets become available; until then,
prefer pull requests over direct pushes.

## Operator rule: private automation pin

`DND_PRIVATE_AUTOMATION_REF` in this repository is the full private commit the
dispatcher must run as, and it is maintained by hand. **Every merge in
`Franiboy/dnd_dashboard-deploy` makes it stale**, and the private
`Validate trusted source request` job rejects the run when the value no longer
matches the private `main` tip.

The dispatch step verifies this itself, before and after the dispatch, and fails
the `Dispatch trusted AI review` job in this repository rather than leaving a
stale value to be discovered in the private run. The details are in the
paragraph below.

Changing private automation therefore takes three steps, in this order:

1. merge the change in `Franiboy/dnd_dashboard-deploy`;
2. merge a second private pull request that raises `uses:` and `automation_ref`
   in `ai-review-dispatch.yml` to the new `main` tip, because the promote script
   is executed from `inputs.automation_ref` and not from the running commit;
3. re-sync the variable, which must equal the private `main` tip _after_ step 2:

```bash
gh variable set DND_PRIVATE_AUTOMATION_REF --repo Franiboy/dnd_dashboard \
  --body "$(gh api repos/Franiboy/dnd_dashboard-deploy/commits/main --jq .sha)"
```

The dispatch job now performs this comparison itself and fails **in the source
run** with the required value, so a stale pin can no longer pass unnoticed. The
comparison runs twice, on both sides of the dispatch: a pre-dispatch check
compares the pin against the private `main` tip, and a post-dispatch check
compares it against the head SHA the private run was actually created at, which
is the value the private dispatcher validates. The pre-dispatch check needs
contents access to the private repository, which `AI_DISPATCH_TOKEN` does not
have, so today it reports that it cannot read the tip and the post-dispatch
check is the authoritative one: it needs only the actions access the token has
and fails closed. Only if it cannot read the private run list either does
it report the dispatch as unverified and defer to the private dispatcher.

## Two named checks per pull request, and why

A pull request produces two checks, and they are deliberately different jobs:

| Check               | Trigger               | What it runs                                                                                             |
| ------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `CI`                | `pull_request`        | checkout, `npm ci`, format, lint, runner invariant, tests, build                                         |
| `CI (trusted gate)` | `pull_request_target` | checkout, runner invariant, and a check that the `CI` run above concluded successfully for the same head |

The trusted run exists because the dispatch job waits for it (`needs: ci`) and
because the private dispatcher pins the run it validates to the event
`pull_request_target`. It no longer repeats the suite. Two things follow:

- No dependency lifecycle script from a pull request runs under a
  `pull_request_target` token. That token is read only, but the script surface
  is gone entirely.
- The private promotion, which merges on its own, waits for exactly one check
  named `CI` on the head it pushed. Before this split it selected the newest of
  two identically named checks with `sort_by(.id) | last`, so the merge gate
  depended on which trigger happened to start last. One name is one answer.

The trusted gate is a real check, not a formality: it fails when the
`pull_request` run for that head is red, times out or unreadable, and the
dispatch does not happen.

The two runs use separate concurrency groups, `ci-<event>-<workflow>-<number>`.
Sharing one group serialised them: the trusted run held the group while the
`pull_request` run waited behind it, and the gate then waited for the run it had
just blocked until its 900 s deadline. `cancel-in-progress` stays false for both
pull request events, so neither run cancels the other; that rule does not depend
on the group.

## Jobs

| Job                               | Repository/trigger                 | Runner                              | Purpose                                                            |
| --------------------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `CI`                              | Public PR and `main` push          | GitHub-hosted                       | Clean checkout, `npm ci`, format, lint, tests, build               |
| `CI (trusted gate)`               | Trusted `pull_request_target`      | GitHub-hosted                       | Runner invariant, then require green `CI` for the same head        |
| `Dispatch trusted AI review`      | Trusted internal PR after green CI | GitHub-hosted                       | Dispatch the private workflow with an Actions-only token           |
| `Validate trusted source request` | Private workflow dispatch          | GitHub-hosted                       | Verify source run, PR, SHAs, actor and hold state                  |
| `Isolated AI review`              | Valid private dispatch             | Fresh `HomeServer-AI` JIT container | Run OpenCode with the configured default model and produce a patch |
| `Isolated patch validation`       | Successful AI review               | GitHub-hosted                       | Apply patch and run all checks without credentials                 |
| `Promote exact reviewed head`     | Successful validation              | GitHub-hosted                       | Push validated fix, wait for fresh CI, squash-merge exact SHA      |
| `Build release`                   | `main` push or trusted dispatch    | GitHub-hosted                       | Exact-SHA build, tests, package, checksum                          |
| `Publish release asset`           | Successful build                   | GitHub-hosted                       | Publish `release-<sha>` assets without replacement                 |
| `Production Deploy`               | Trusted workflow dispatch          | `HomeServer`                        | Fetch, verify, migrate, switch release, readiness/rollback         |

## AI dispatch and review flow

1. A source PR passes hosted CI. The `pull_request` run is the suite; the
   `pull_request_target` run only verifies that suite's result for the same
   head commit, it does not repeat it.
2. The base-branch `pull_request_target` job dispatches
   `ai-review-dispatch.yml` only when all of these are true:
   - the event is `pull_request_target`;
   - the base branch is `main`;
   - the head repository is the source repository itself;
   - the PR author is `Franiboy`;
   - `DND_AI_REVIEW_ENABLED` is `true`;
   - the PR has neither the `automerge` marker nor the `hold` marker.
3. The source job resolves the current `main` tip with its own job token, which
   carries `contents: read` on this public repository. Reading a public commit
   needs no secret, and `AI_DISPATCH_TOKEN` has no visibility into this
   repository at all. Only the dispatch and the private-repository checks use
   `AI_DISPATCH_TOKEN`, which carries `Actions: write` there. The job passes no
   source write, OpenCode or private automation credential.
4. The private dispatcher checks the exact source workflow run and PR through a
   read-only source token, verifies the event-time head/base SHAs and labels,
   and rejects stale, redirected or unauthenticated requests.
5. The private dispatcher calls `ai-review.yml` at a complete 40-character
   private commit SHA. The reusable workflow's self-hosted job is therefore in
   the private repository's runner context, where the repository-scoped JIT
   runner is eligible.
6. The host supervisor discovers the queued private job's exact dynamic label,
   performs a container preflight before consuming a JIT configuration, and
   starts one fresh rootless job container. The GitHub JIT registration is
   ephemeral and accepts one job only.
7. The AI job checks out the exact source head, uses the runner image's pinned
   default-model plugin, and runs OpenCode without a `--model` argument. Its
   global policy denies shell, Code Mode, web tools, external directories,
   subagents, skills and custom/MCP tools. The model process receives no
   GitHub write or production credential.
8. A hosted validation job applies the patch and runs the dependency lifecycle,
   format, lint, tests and build in a digest-pinned disposable Docker container
   with a copied workspace, no host mounts and no credentials.
9. A clean hosted promotion job ignores validation metadata. It independently
   verifies the original AI artifact, protected paths, symlinks, base SHA and
   hold state, adds `automerge` before any fix push, pushes without force, waits
   for the pull request head to report the pushed commit, waits for the newest
   `CI` check on the exact resulting SHA, and performs a direct exact-head
   squash merge. No GitHub auto-merge is left queued. The head wait is necessary
   because a pull request head ref is served from an eventually consistent read
   path: the API can still answer with the pre-push commit for a short while
   after the push was accepted. Only the pre-push commit is tolerated while the
   push settles; any other value is an external change and fails closed.
10. The source release workflow publishes a non-replaceable
    `release-<40-character-sha>` asset pair. With `DND_AUTO_DEPLOY_ENABLED=true`,
    it starts the private deployment workflow with that exact SHA.
11. `Production Deploy` verifies source ancestry, release checksum and manifest,
    creates the SQLite snapshot, migrates inside the deployment transaction,
    switches `/dnd_dashboard/current`, and verifies the exact release through
    `/ready`. Failures restore the previous release and database.

A base update fails closed and requires a fresh review. A `hold` label fails
closed immediately before direct merge. If the AI cannot safely fix a concrete
finding, it writes a blocker report and no change is promoted.

## Required source-repository secrets and variables

The source repository stores no AI, OpenCode or promotion write secret. It has
only these dispatch/deployment secrets:

- `AI_DISPATCH_TOKEN` — fine-grained `Actions: write` on
  `Franiboy/dnd_dashboard-deploy`; used only by the hosted source dispatch job.
- `DEPLOY_DISPATCH_TOKEN` — fine-grained `Actions: write` on
  `Franiboy/dnd_dashboard-deploy`; used only by the release workflow to start
  private production deployment.

The private repository stores `SOURCE_READ_TOKEN`, `AI_GITHUB_TOKEN` and
`OPENCODE_API_KEY`; its `production` environment stores `SOURCE_GITHUB_TOKEN`.
The local AI supervisor uses a separate host-only GitHub App key with runner
administration permission. None of these credentials is stored in a release
archive, production build, `.env`, image or source-repository secret.

Set the source repository variable `DND_PRIVATE_AUTOMATION_REF` to the full
40-character commit SHA of the private dispatcher workflow. The source job
passes it as a dispatch input; the private workflow rejects a run whose
`GITHUB_SHA` differs.

Set `DND_AI_REVIEW_ENABLED=true` only after the private dispatcher is merged and
pinned, its private `DND_PRIVATE_AI_ENABLED` variable is true, the private
secrets exist, the host-only App is installed, and the
ephemeral runner passes preflight. Set `DND_AUTO_DEPLOY_ENABLED=true` only after
the dispatch secret and private deployment workflow pass their own canary. If
the current GitHub plan does not expose branch-protection/ruleset APIs for the
private repositories, keep both gates disabled until equivalent protection is
enforced.

The private dispatcher must reference the reusable workflow by a complete
commit SHA. A branch reference such as `main` is not an activated configuration.
If the dispatcher and reusable workflow change together, use a reviewed
two-commit pin update before enabling the source gate.

## Ephemeral AI runner boundary

The `HomeServer-AI` runner is not a persistent runner. The host supervisor runs
as a separate `dnd-ai` account with no sudo, Docker, Podman or production
groups. It uses rootless Podman and a pre-pulled digest-pinned image.

The job container has a non-root user, subordinate user namespace, read-only
root filesystem, memory-only runner/workspace state, dropped capabilities,
`no-new-privileges`, seccomp, private namespaces, resource limits and no host
bind mounts. It has no route to the host or LAN. A separate non-root proxy
sidecar is the only egress path and permits only the GitHub Actions and OpenCode
provider domains required by the job. The proxy is not given host credentials
or a management socket.

`/usr/local/bin/dnd-ai-preflight` runs before the listener starts. The private
workflow also runs `scripts/verify-ai-runner.sh` after its trusted checkout as a
secondary assertion. The host supervisor's image, user-namespace, mount,
network and App checks are the primary boundary; failure never falls back to a
persistent runner or the production runner.

## Release handoff

The public release workflow creates a tag/release named
`release-<40-character-source-sha>` and attaches:

- `dnd-release.tar.gz`
- `dnd-release.tar.gz.sha256`

An existing release tag fails closed; assets are never replaced. `npm ci` runs on
the hosted runner so native addons match the production libc; build, test and
compilation run in a digest-pinned disposable container that mounts the runner
workspace at `/workspace` (read-only root filesystem, no host paths, no
credentials in the environment). The checkout is done with
`persist-credentials: false` and `origin/main` is fetched with a one-shot
authorization header, so no credential is left in `.git/config` that the
container could read. The publish job
verifies the release target before optionally starting the private deployment
workflow with `workflow_dispatch` and the exact SHA. The private workflow
independently checks source ancestry, downloads the assets, and verifies the
SHA-256 file.

Native addons are resolved against the libc of the machine that runs
`npm ci`. Production is Ubuntu 24.04 with glibc 2.39, so `npm ci` runs on the
`ubuntu-24.04` runner and only build, test and compilation move into the
disposable container. Two gates keep an undeployable release from reaching
production:

- `scripts/verify-release-native.sh` runs in the release build. It fails closed
  unless the archive contains the prebuilt addon for glibc 2.39 and the Node
  ABI from `.nvmrc`, unless the set of packages shipping a compiled binary
  still matches the reviewed list, and unless every native module loads.
- `scripts/dnd-release-deploy.sh` loads the native modules of the extracted
  release with the production Node **before** the `current` symlink moves, so a
  libc mismatch fails without touching the running service.

The dispatch requires `DEPLOY_DISPATCH_TOKEN` with `Actions: write` on the
private deployment repository. Manual deployment remains available as a
fallback:

```bash
gh workflow run deploy.yml \
  --repo Franiboy/dnd_dashboard-deploy \
  --ref main \
  -f sha=<40-character-source-main-sha>
```

## Production transaction

`source/scripts/dnd-release-deploy.sh` is run from the exact source commit and:

1. verifies the artifact checksum, manifest, Node/platform/lockfile metadata;
2. creates `/dnd_dashboard/releases/<sha>` and shared-data links;
3. pauses both the application service and its activation socket;
4. creates and integrity-checks a consistent SQLite snapshot;
5. runs the compiled migration runner and checks the migrated database;
6. atomically switches `/dnd_dashboard/current`;
7. starts the socket and service, then polls `/ready` for the exact release SHA;
8. restores the previous release, operations checkout and database on failure.

A crash leaves `/dnd_dashboard/backups/deploy/.active-transaction`. The next
deployment refuses to continue until an operator inspects and recovers that
transaction explicitly. Daily backups share the deployment lock and cannot
overlap migrations.

The service unit is installed once by the reviewed host setup; release jobs do
not copy repository-controlled files into `/etc/systemd`.

## Publication checklist

Before changing the source repository from private to public:

- confirm `bash scripts/verify-source-runners.sh .` passes; the invariant is
  also covered by `tests/ci/sourceRunners.test.ts`, so a `self-hosted` job fails
  CI rather than review;
- confirm `HomeServer` and `HomeServer-AI` are registered only to
  `Franiboy/dnd_dashboard-deploy`;
- confirm the private dispatcher and reusable workflow use a complete private
  automation SHA;
- set private Actions access and branch/CODEOWNERS protections where supported;
- run a held AI canary and verify one fresh container per job;
- verify cleanup after cancellation, crash and supervisor restart;
- verify `/ready`, backups, rollback documentation and private deployment
  dispatch;
- rotate any credential that was ever placed in a build, archive or production
  workspace;
- confirm `SECURITY.md` and `.github/CODEOWNERS` exist and stay current. Both
  are advisory while branch protection is unavailable, `SECURITY.md` still gives
  reporters a private channel;
- set `DND_CODEQL_ENABLED=true`. Code scanning is free for a public repository;
  while the repository is private it requires GitHub Advanced Security and fails
  with `CodeQL job status was configuration error`.
