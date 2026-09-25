# CI/CD Pipeline

The source repository, the isolated AI runner and the production runner are
separate trust boundaries.

- **Hosted source CI:** `.github/workflows/ci-cd.yml` runs ordinary checks on
  GitHub-hosted `ubuntu-24.04` runners.
- **Trusted AI review:** the base-branch `pull_request_target` caller invokes
  the reusable workflow in the private `Franiboy/dnd_dashboard-deploy`
  repository. OpenCode itself runs only on the separately isolated
  `HomeServer-AI` runner.
- **Hosted validation:** a clean GitHub-hosted job applies the AI patch and runs
  dependency installation, formatting, lint, tests and build without any
  GitHub write credential.
- **Hosted promotion:** a separate clean GitHub-hosted job receives the write
  token only after validation, applies the exact patch, waits for fresh CI and
  performs the exact-head squash merge.
- **Release build:** `.github/workflows/release.yml` builds an exact source
  commit, verifies the artifact, and publishes non-replaceable checksummed
  release assets.
- **Private production deployment:** the private repository contains the
  self-hosted `HomeServer` workflow. It is started by `workflow_dispatch` with
  an exact source SHA or manually by an authorized maintainer.

The source repository must not contain a job with `runs-on: self-hosted`.
Keeping the runners and write-capable automation in a separate repository is
the security boundary that prevents a public pull request from adding or
redirecting a production job.

## Jobs

| Job                           | Repository/trigger                 | Runner          | Purpose                                                         |
| ----------------------------- | ---------------------------------- | --------------- | --------------------------------------------------------------- |
| `CI`                          | Public PR and `main` push          | GitHub-hosted   | Clean checkout, `npm ci`, format, lint, tests, build            |
| `Trusted AI review`           | Trusted internal PR after green CI | `HomeServer-AI` | Run OpenCode with the configured default model; produce a patch |
| `Isolated patch validation`   | Successful AI review               | GitHub-hosted   | Apply patch and run all checks without credentials              |
| `Promote exact reviewed head` | Successful validation              | GitHub-hosted   | Push validated fix, wait for fresh CI, squash-merge exact SHA   |
| `Build release`               | `main` push or trusted dispatch    | GitHub-hosted   | Exact-SHA build, tests, package, checksum                       |
| `Publish release asset`       | Successful build                   | GitHub-hosted   | Publish `release-<sha>` assets without replacement              |
| `Production Deploy`           | Trusted workflow dispatch          | `HomeServer`    | Fetch, verify, migrate, switch release, readiness/rollback      |

## AI review and merge flow

The source CI calls the private reusable workflow from a
`pull_request_target` trigger only when all of these are true:

- the event is a pull request;
- the base branch is `main`;
- the head repository is the source repository itself;
- the PR author is `Franiboy`;
- the source variable `DND_AI_REVIEW_ENABLED` is `true`;
- the PR has neither the internal `automerge` marker nor the `hold` marker.

The target workflow definition comes from the base branch. The private reusable
workflow is referenced by a complete commit SHA, and its `automation_ref`
input must contain that same full SHA. A branch reference such as `main` is not
an acceptable activated configuration.

The private workflow first validates those trust inputs on a hosted runner. The
`HomeServer-AI` job then verifies that it is a non-root, rootless-container
runner without access to `/dnd_dashboard`, production secrets, the production
database, sudo, container sockets or the local production application port. It
checks out the exact PR head and runs OpenCode without a `--model` argument, so
the default model configured by the runner's global OpenCode setup/plugin is
used. No model is hard-coded in CI.

The temporary OpenCode policy denies shell, MCP tools, web access and external
directories. The model receives no GitHub write credential. It may inspect and
edit application files, but CI/CD, validation, dependency, deployment,
systemd, secret, generated and private automation paths are protected. The
source-tree `scripts/ai-review.sh` is only a fail-closed compatibility stub;
the private repository's scripts are authoritative.

The AI job emits a patch and a result artifact. It does not run npm or project
lifecycle code. A separate hosted validation job downloads that artifact,
checks its PR/head identity and checksum, rejects protected or unsafe paths,
then runs the dependency lifecycle, format, lint, tests and build inside a
digest-pinned disposable Docker container. The container receives only a copy
of the source, has no host mounts, Docker socket or credentials, and cannot
write the patch/result or private automation. A host-side step verifies that
the container did not alter the reviewed patch. The validation result is a
useful gate and diagnostic, but it is not trusted as promotion metadata.

The clean promotion job downloads the original AI artifact, independently
checks its identity, checksum, protected paths, symlinks, current base SHA and
hold state, adds the `automerge` marker before a fix push, pushes without force,
waits for the newest `CI` check on the exact resulting SHA, and performs a
direct exact-head squash merge. It does not leave a GitHub auto-merge queued.
The event-time base SHA must remain unchanged throughout the review and
promotion; a base update fails closed and requires a fresh review. A `hold`
label fails closed immediately before the direct merge.

If the AI cannot safely fix a concrete finding, it writes a blocker report to
the review artifact and the workflow remains failed for manual handling. The
automation never silently approves around a blocker.

## Required source-repository secrets and variables

- `AI_AUTOMATION_READ_TOKEN` — fine-grained `Contents: read` access only to
  the private deployment repository. It is used for trusted automation
  checkouts and is not exposed to source code.
- `AI_GITHUB_TOKEN` — fine-grained source `Contents: read/write`,
  `Pull requests: read/write` and `Issues: read/write`, plus private-repository
  `Contents: read`. It is used only by the clean promotion job. Checks use the
  caller-provided read-only `GITHUB_TOKEN`, so the fine-grained token does not
  need Checks permission.
- `OPENCODE_API_KEY` — provider credential for the OpenCode default-model
  configuration on `HomeServer-AI`; it is not passed to npm or promotion.
- `DEPLOY_DISPATCH_TOKEN` — fine-grained `Actions: write` access to the
  private deployment repository for the release-to-deploy dispatch.

Set `DND_AI_REVIEW_ENABLED=true` only after the private workflow is merged and
pinned, all AI secrets exist, and the isolated runner passes verification. Set
`DND_AUTO_DEPLOY_ENABLED=true` only after the dispatch secret and private
workflow are available. If the source repository is private, configure a
least-privilege `SOURCE_GITHUB_TOKEN` in the private deployment repository for
release-asset downloads.

The source workflow passes secrets only to the pinned reusable workflow from
`pull_request_target`; source-controlled workflow files and source install
code never receive the write token.

## Release handoff

The public release workflow creates a tag/release named
`release-<40-character-source-sha>` and attaches:

- `dnd-release.tar.gz`
- `dnd-release.tar.gz.sha256`

An existing release tag fails closed; assets are never replaced with
`--clobber`. Build, test and compilation run in a digest-pinned disposable
container; the host-side package step then creates and verifies the archive
after the source lifecycle has exited. The publish job verifies the release
target before optionally starting the private deployment workflow with
`workflow_dispatch` and the exact SHA. The private workflow independently
checks source ancestry, downloads the assets, and verifies the SHA-256 file.

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

## Runner isolation

The AI runner and production runner are separate registrations even when they
share the HomeServer host:

- `HomeServer-AI` is an unprivileged, isolated runner/container with no access
  to `/dnd_dashboard`, production secrets, the production database, sudo,
  container sockets or the production port; the private workflow runs a
  fail-closed isolation check before checking out the PR;
- `HomeServer` is reserved for the transactional production deployment;
- the private workflow and its scripts are pinned to an immutable private
  commit and are never read from the PR checkout.

The private repository is the write-capable automation trust boundary; the
runner/container configuration is the host-security boundary. Both are required.

## Publication checklist

Before changing the source repository from private to public:

- confirm the source repository has no `self-hosted` job;
- confirm `HomeServer` and `HomeServer-AI` are registered only to
  `Franiboy/dnd_dashboard-deploy`;
- confirm the source workflow and `automation_ref` use the same full private
  commit SHA;
- enable branch protection and required CI checks where supported;
- rotate `ADMIN_PASSWORD` and any other exposed credentials;
- configure CodeQL/code scanning and Dependabot protections;
- verify `/ready`, backups, rollback documentation and the private deployment
  dispatch.
