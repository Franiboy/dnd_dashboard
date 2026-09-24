# CI/CD Pipeline

The project uses separate trust domains:

- **Untrusted CI:** `.github/workflows/ci-cd.yml` runs pull-request checks on
  GitHub-hosted `ubuntu-24.04`. It has read-only repository permissions and no
  access to the production host.
- **Trusted review:** The AI job runs only for the configured maintainer's
  same-repository pull requests on the local runner. Fork pull requests never
  receive the write-capable token or the local runner.
- **Release:** `.github/workflows/release.yml` builds the exact commit on a
  GitHub-hosted runner, uploads a checksummed artifact, and promotes it in a
  separate job on the local `HomeServer` runner.

## Jobs

| Job                 | Trigger                                     | Runner                    | Purpose                                                                  |
| ------------------- | ------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `ci`                | Every PR and push to `main`                 | GitHub-hosted             | Clean checkout, `npm ci`, format check, lint, tests, build               |
| `trusted-ai-review` | Own, same-repository PRs after `ci`         | Local `HomeServer` runner | OpenCode review, optional fixes, exact-head auto-merge, release dispatch |
| `build`             | Push to `main` or trusted workflow dispatch | GitHub-hosted             | Exact-SHA build and immutable artifact                                   |
| `deploy`            | Successful `build`                          | Local `HomeServer` runner | Migration, release switch, readiness check, rollback                     |

No pull-request code is allowed to run on the local runner. Do not replace the
`trusted-ai-review` condition with a generic `pull_request` condition.

## Release layout

The production checkout remains at `/dnd_dashboard`, while application releases
are immutable directories below `/dnd_dashboard/releases/<sha>`. The stable
`/dnd_dashboard/current` symlink points to the active release. Shared runtime
state (`.env`, `dnd.db`, `data`, and `recordings`) stays outside the release
directory.

The systemd unit is installed separately by `dnd-server-setup.sh`; application
deploys never copy repository-controlled unit files into `/etc/systemd`.

## Deployment transaction

`scripts/dnd-release-deploy.sh`:

1. verifies the artifact checksum, manifest, commit SHA, and required files;
2. creates the immutable release directory and shared-data links;
3. stops the application while the socket remains available;
4. copies and integrity-checks a pre-migration SQLite snapshot;
5. runs the compiled migration runner from the new release;
6. atomically switches `/dnd_dashboard/current`;
7. starts the service and polls `/ready` for the expected release SHA;
8. restores the previous release and database snapshot on failure.

The service must be installed with the reviewed `current`-path unit before the
first artifact deployment:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dnd-dashboard.socket
```

Do not run the legacy `scripts/dnd-deploy.sh`; it is intentionally disabled.

## AI review and merge

The AI job is restricted to the configured maintainer and same-repository
branches. It reviews only the exact PR head SHA, validates any local fixes, and
merges only that reviewed SHA. After a merge it dispatches `release.yml` with
the merge commit; it never calls the production deploy script directly.

For reliable pushes from an AI-created fix commit, configure a narrowly scoped
GitHub App installation token or fine-grained token as `AI_GITHUB_TOKEN` if the
repository should trigger normal CI on those pushes. Without such a token, the
workflow's `GITHUB_TOKEN` may not start a new push-triggered run; the AI job
then fails closed rather than merging without required CI.

Configure branch protection for `main` after the first safe workflow is merged:

- require the `CI / CI` check;
- require pull requests and disallow force pushes;
- require a human decision for external contributions;
- keep the `hold` label as an emergency stop for AI review.

## Manual recovery

A deployment can be retried with the exact release workflow and commit SHA.
Never force-push or edit a release directory in place. If a migration is not
backward-compatible, keep the previous release available and restore the
pre-migration database snapshot as part of an explicitly reviewed recovery.

## Dependency security

`quill` remains pinned to `2.0.2` through the root override. Version `2.0.3` is
affected by CVE-2025-15056 / GHSA-v3m3-f69x-jf25 (XSS in HTML export) and has
no patched release at the time of writing. Do not remove the override or run
`npm audit fix --force` for this advisory; revisit the pin when an upstream
patched release is available and verify the editor integration.
