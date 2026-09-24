# CI/CD Pipeline

The public source repository and the production runner are separate trust
boundaries.

- **Public CI:** `.github/workflows/ci-cd.yml` runs only on GitHub-hosted
  `ubuntu-24.04` runners. It has read-only repository permissions and no access
  to the production host.
- **Public release build:** `.github/workflows/release.yml` builds an exact
  source commit, verifies the artifact, and publishes the checksummed files as
  a GitHub Release asset. It has no self-hosted job.
- **Private deployment:** `Franiboy/dnd_dashboard-deploy` contains the manual
  production workflow. Its local `HomeServer` runner is registered only to that
  private repository and accepts only an explicit `workflow_dispatch` with a
  source `main` SHA.

The public repository must not contain a job with `runs-on: self-hosted`.
Keeping the runner in a separate repository is the security boundary that
prevents a public pull request from adding or redirecting a production job.

## Jobs

| Job                     | Repository/trigger                     | Runner                    | Purpose                                                    |
| ----------------------- | -------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `CI`                    | Public PR and `main` push              | GitHub-hosted             | Clean checkout, `npm ci`, format, lint, tests, build       |
| `Build release`         | Public `main` push or trusted dispatch | GitHub-hosted             | Exact-SHA build, tests, package, checksum                  |
| `Publish release asset` | Successful build                       | GitHub-hosted             | Publishes `release-<sha>` assets                           |
| `Production Deploy`     | Private repository manual dispatch     | Local `HomeServer` runner | Fetch, verify, migrate, switch release, readiness/rollback |

## Release handoff

The public release workflow creates a tag/release named
`release-<40-character-main-sha>` and attaches:

- `dnd-release.tar.gz`
- `dnd-release.tar.gz.sha256`

The private deployment workflow checks out the same source commit, verifies
that it is an ancestor of the source `main` branch, downloads the assets, and
checks the SHA-256 file. If the source repository is still private, configure a
least-privilege `SOURCE_GITHUB_TOKEN` secret in the private deployment
repository. It is unnecessary after the source repository is public.

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

## Manual deployment

From an authorized maintainer workstation:

```bash
gh workflow run deploy.yml \
  --repo Franiboy/dnd_dashboard-deploy \
  -f sha=<40-character-source-main-sha>
```

The source repository remains responsible for build/test/release-asset
creation. The private deployment repository is responsible only for promotion.

## AI review

The former public-repository AI job was removed because a self-hosted runner
belongs to the private deployment repository. The review script remains in the
source tree for a future separately hosted/trusted automation workflow, but it
is not executed by public CI and cannot auto-merge a public fork.

If AI automation is reintroduced, use an isolated GitHub-hosted runner or the
private deployment repository with a separately scoped token. It must never
execute fork code on the production runner.

## Publication checklist

Before changing the source repository from private to public:

- confirm the public repository has no `self-hosted` job;
- confirm the `HomeServer` runner is registered only to
  `Franiboy/dnd_dashboard-deploy`;
- enable branch protection and required CI checks;
- rotate `ADMIN_PASSWORD` and any other exposed credentials;
- configure CodeQL/code scanning and Dependabot protections;
- verify `/ready`, backups, rollback documentation and the private deployment
  dispatch.
