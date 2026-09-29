import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  admitsTrustedEvent,
  parseWorkflow,
  readWorkflow,
  type WorkflowStep,
} from './lib/workflow.js';

/**
 * The `pull_request_target` runs of this repository carry the base repository's
 * token. Any repository content that such a job checks out and then executes is
 * therefore code that runs with elevated privileges, and a fork can propose it.
 * The gate must stay free of that surface: it may read what it needs through
 * the API as text, but it must not check out the pull request head and it must
 * not run a file from the repository.
 *
 * The test is the enforcement. Documentation alone cannot hold it, and this
 * repository is being prepared for publication, where fork pull requests become
 * possible in the first place.
 */

/** Paths that would mean "running code from the repository". */
const REPOSITORY_PATHS =
  /(?:^|[\s"'`/=])(?:\.?\/)?(?:scripts|src|server|shared|tests)\/|package\.json/;

function trustedSteps(workflowName: string) {
  const jobs = parseWorkflow(readWorkflow(workflowName));
  const found: { job: string; step: ReturnType<typeof parseWorkflow>[string]['steps'][number] }[] =
    [];
  for (const job of Object.values(jobs)) {
    for (const step of job.steps) {
      if (admitsTrustedEvent(step.condition)) found.push({ job: job.id, step });
    }
  }
  return found;
}

describe('trusted run keeps the repository out of the process', () => {
  const steps = trustedSteps('.github/workflows/ci-cd.yml');

  it('finds the trusted steps, so the assertions below are not vacuous', () => {
    const names = steps.map((entry) => entry.step.name);
    expect(names).toContain('Require green pull request CI for this head');
    expect(names).toContain('Verify the pull request adds no self-hosted job');
    expect(names).toContain('Dispatch private ephemeral AI review');
  });

  it('never uses an action in a step that runs on pull_request_target', () => {
    for (const { job, step } of steps) {
      expect(
        step.uses,
        `${workflowName(job)} step "${step.name}" (line ${step.line}) uses an action in the trusted context`
      ).toBe('');
    }
  });

  it('never executes a file from the repository in the trusted context', () => {
    for (const { job, step } of steps) {
      const offending = step.run
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => REPOSITORY_PATHS.test(entry.line));
      expect(
        offending,
        `${workflowName(job)} step "${step.name}" (line ${step.line}) runs repository code: ${offending
          .map((entry) => entry.number)
          .join(', ')}`
      ).toEqual([]);
    }
  });

  it('guards the checkout of the pull request head explicitly', () => {
    const checkouts = Object.values(parseWorkflow(readWorkflow('.github/workflows/ci-cd.yml')))
      .flatMap((job) => job.steps.filter((step) => step.uses.startsWith('actions/checkout')))
      .filter((step) => step.raw.includes('github.event.pull_request.head.sha'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) {
      expect(
        step.condition,
        `the checkout of a pull request head (line ${step.line}) must be guarded`
      ).toBe("github.event_name != 'pull_request_target'");
    }
  });

  it('reads the pull request workflows through the API instead of a checkout', () => {
    const step = steps.find(
      (entry) => entry.step.name === 'Verify the pull request adds no self-hosted job'
    );
    expect(step).toBeDefined();
    // The content has to be read as text through the contents API...
    expect(step!.step.run).toContain('api="repos/${GITHUB_REPOSITORY}/contents"');
    expect(step!.step.run).toContain('/.github/workflows?ref=${HEAD_SHA}');
    expect(step!.step.run).toContain('gh api "${api}/${path}?ref=${HEAD_SHA}" --jq \'.content\'');
    expect(step!.step.run).toContain('base64 -d');
    // ...and the read has to be checked by exit status, because gh writes an
    // API error body to stdout.
    expect(step!.step.run).toMatch(/if ! listing="\$\(gh api/);
    expect(step!.step.run).toMatch(/if ! content="\$\(gh api/);
    // The same regex the checked-out script uses, so both run types agree.
    expect(step!.step.run).toContain(
      "grep -nE '^[[:space:]]*(-[[:space:]]+)?runs-on:.*self-hosted'"
    );
  });

  it('keeps the trusted gate itself free of repository secrets', () => {
    // The dispatch job is allowed its narrowly scoped Actions token; that is
    // what it exists for. The gate job runs no application code at all, so a
    // secret there would have no purpose and would only widen the blast radius.
    const gate = parseWorkflow(readWorkflow('.github/workflows/ci-cd.yml')).ci;
    expect(gate).toBeDefined();
    for (const step of gate.steps.filter((entry) => admitsTrustedEvent(entry.condition))) {
      expect(
        step.raw.includes('secrets.'),
        `step "${step.name}" (line ${step.line}) reads a secret in the trusted gate`
      ).toBe(false);
      expect(step.raw, `step "${step.name}" (line ${step.line}) has no token`).toContain(
        'GH_TOKEN: ${{ github.token }}'
      );
    }
  });
});

function workflowName(job: string): string {
  return `job ${job}`;
}

const REPOSITORY = 'Franiboy/dnd_dashboard';
const HEAD_SHA = '2276ae063b39fde746660aa30bc43217d9ed7f0f';

function findStep(name: string): WorkflowStep {
  const step = parseWorkflow(readWorkflow()).ci?.steps.find((entry) => entry.name === name);
  if (!step) throw new Error(`workflow step "${name}" not found`);
  return step;
}

/**
 * Executes a step of the trusted run against a `gh` stub that replays contents
 * API answers. The step is extracted from the workflow, so a failure is a
 * failure of the shipped script and not of a copy of it.
 */
function runTrustedStep(
  step: WorkflowStep,
  files: Record<string, string>,
  options: { unreadableListing?: boolean; unreadableContent?: boolean } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'dnd-trusted-step-'));
  try {
    writeFileSync(
      join(dir, 'listing.json'),
      JSON.stringify(
        Object.keys(files).map((name) => ({ name, path: `.github/workflows/${name}`, size: 1 }))
      )
    );
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(dir, `${name}.json`),
        JSON.stringify({
          content: Buffer.from(content, 'utf8').toString('base64'),
          encoding: 'base64',
        })
      );
    }
    const stub = join(dir, 'gh');
    writeFileSync(
      stub,
      [
        '#!/usr/bin/env bash',
        '# Mimics `gh api <path> --jq <filter>` for the two contents API calls the',
        '# step makes, including the error body on stdout with a non-zero status.',
        'dir="$(dirname "$0")"',
        '# `gh api <endpoint> --jq <filter>`: the first argument is the subcommand.',
        'url="$1"; shift',
        'if [ "$url" = "api" ]; then url="$1"; shift; fi',
        'filter=""',
        'while [ $# -gt 0 ]; do',
        '  case "$1" in',
        '    --jq) filter="$2"; shift 2 ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        'if [ "$url" = "repos/$GITHUB_REPOSITORY/contents/.github/workflows?ref=$HEAD_SHA" ]; then',
        '  if [ -n "${STUB_FAIL_LISTING:-}" ]; then',
        '    echo \'{"message":"Not Found","status":"404"}\'',
        '    exit 1',
        '  fi',
        `  cat "${join(dir, 'listing.json')}" | jq -r "$filter"`,
        '  exit 0',
        'fi',
        'name="${url#repos/$GITHUB_REPOSITORY/contents/}"',
        'name="${name%%\\?*}"',
        'name="${name##*/}"',
        `if [ -n "\${STUB_FAIL_CONTENT:-}" ] || [ ! -f "${dir}/\${name}.json" ]; then`,
        '  echo \'{"message":"Not Found","status":"404"}\'',
        '  exit 1',
        'fi',
        `cat "${dir}/\${name}.json" | jq -r "$filter"`,
      ].join('\n')
    );
    chmodSync(stub, 0o755);

    const scriptPath = join(dir, 'step.sh');
    writeFileSync(scriptPath, step.run);
    return spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: REPOSITORY,
        HEAD_SHA,
        ...(options.unreadableListing ? { STUB_FAIL_LISTING: '1' } : {}),
        ...(options.unreadableContent ? { STUB_FAIL_CONTENT: '1' } : {}),
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('trusted runner-invariant step', () => {
  const clean = 'name: CI\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps: []\n';
  const selfHosted =
    'name: bad\non: push\njobs:\n  a:\n    runs-on: [self-hosted, Linux, X64, HomeServer]\n    steps: []\n';
  const step = findStep('Verify the pull request adds no self-hosted job');

  beforeAll(() => {
    const probe = spawnSync('bash', ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) throw new Error('this test needs bash on PATH');
    const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
    if (jq.error || jq.status !== 0) throw new Error('this test needs jq on PATH');
  });

  it('passes when no workflow schedules a self-hosted job', () => {
    const result = runTrustedStep(step, { 'ci-cd.yml': clean, 'codeql.yml': clean });
    expect(result.stderr).toBe('');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('checked 2 workflow file(s)');
    expect(result.stdout).toContain('no self-hosted job');
  });

  it('fails and names the file that schedules one', () => {
    const result = runTrustedStep(step, { 'ci-cd.yml': clean, 'evil.yml': selfHosted });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runs-on: [self-hosted, Linux, X64, HomeServer]');
    expect(result.stderr).toContain('1 violation(s)');
  });

  it('ignores a label that only appears in a comment', () => {
    const commented =
      'name: CI\n# runs-on: self-hosted is forbidden here\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps: []\n';
    const result = runTrustedStep(step, { 'ci-cd.yml': commented });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('fails closed when the workflow directory cannot be read', () => {
    const result = runTrustedStep(step, { 'ci-cd.yml': clean }, { unreadableListing: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not read the workflow directory');
  });

  it('fails closed when a single workflow file cannot be read', () => {
    const result = runTrustedStep(step, { 'ci-cd.yml': clean }, { unreadableContent: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not read');
  });

  it('fails closed when no workflow file was read at all', () => {
    const result = runTrustedStep(step, {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no workflow file was read');
  });
});
