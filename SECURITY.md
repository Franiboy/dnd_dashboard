# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainer through
GitHub's [private vulnerability reporting](https://github.com/Franiboy/dnd_dashboard/security/advisories/new)
or directly to `@Franiboy`. Do not open a public issue for an unfixed problem.

Include the affected component, the version or commit, and a reproduction if you
have one. You will get an acknowledgement, and a fix or a mitigation plan for
every confirmed report.

## Scope and trust boundary

This repository is the public application repository. It runs **read-only CI and
release builds**; it has no self-hosted runner and no write-capable automation.

All write-capable automation lives in the private
[`Franiboy/dnd_dashboard-deploy`](https://github.com/Franiboy/dnd_dashboard-deploy)
repository: the trusted AI review, the promotion step and the production
deployment. That separation is deliberate. A called reusable workflow inherits
the caller repository's runner context, so a self-hosted job here would execute
pull request code on the production host. The invariant is enforced by
`scripts/verify-source-runners.sh` and covered by a test, not only by policy.

Consequences worth knowing when reporting:

- pull requests are analysed by CodeQL on every change; results land in the
  repository's security tab.
- the deployment path only accepts an immutable, checksum-verified release asset
  whose native addons match the production platform, and it rolls back
  automatically when the readiness probe fails.
- the AI reviewer is pinned to a single allowlisted model, runs in a disposable
  container without host mounts, and never receives write or production
  credentials. It refuses pull requests that change the automation, deployment
  or test files themselves.

Detailed documentation: [`docs/security.md`](docs/security.md) and
[`docs/ci-cd.md`](docs/ci-cd.md).

## Supported versions

Only the latest `main` is supported. Deployments are immutable per release, so
fixes ship as a new release rather than as patches to an existing one.
