import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseWorkflow, readWorkflow } from './lib/workflow.js';

/**
 * Regression test for the trusted dispatch gate in `ci-cd.yml`.
 *
 * The gate step has two halves that can each be wrong independently: the jq
 * expression that classifies an API answer, and the shell loop that acts on that
 * classification. Both are tested against the real step text, and neither is
 * transcribed here, so a change to the workflow cannot silently skip the test.
 *
 * The step is extracted and executed, not reimplemented: a failure has to be a
 * failure of the shipped script.
 */

const STEP_NAME = 'Require green pull request CI for this head';
const HEAD_SHA = '2276ae063b39fde746660aa30bc43217d9ed7f0f';

const step = parseWorkflow(readWorkflow()).ci?.steps.find((entry) => entry.name === STEP_NAME);

if (!step) throw new Error(`workflow step "${STEP_NAME}" not found`);

/** The single-quoted argument that the step passes to `gh api --jq`. */
function jqFilter(script: string): string {
  const lines = script.split('\n');
  const index = lines.findIndex((line) => line.includes('--jq') && line.trimEnd().endsWith('\\'));
  expect(index, 'the step must pass a --jq filter').toBeGreaterThanOrEqual(0);
  const match = /^'(.*)'\)\s*"$/.exec((lines[index + 1] ?? '').trim());
  expect(match, `could not read the --jq filter from: ${lines[index + 1] ?? ''}`).not.toBeNull();
  return match![1];
}

function requireTool(tool: string): void {
  const result = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `this test executes the real gate step and needs "${tool}" on PATH (CI runners and the documented Linux setup both provide it)`
    );
  }
}

const runs = (id: number, status: string, conclusion: string | null, name = 'CI') =>
  `{"total_count":1,"workflow_runs":[{"id":${id},"name":"${name}","head_sha":"abc","status":"${status}","conclusion":${conclusion === null ? 'null' : `"${conclusion}"`}}]}`;

const FIXTURES: [name: string, payload: string, expected: string][] = [
  ['no run yet', '{"total_count":0,"workflow_runs":[]}', 'missing'],
  ['run still going', runs(2, 'in_progress', null), 'pending'],
  ['green', runs(1, 'completed', 'success'), 'success'],
  ['failed', runs(3, 'completed', 'failure'), 'failed'],
  ['cancelled', runs(4, 'completed', 'cancelled'), 'failed'],
  ['timed out', runs(5, 'completed', 'timed_out'), 'failed'],
  ['other workflow ignored', runs(6, 'completed', 'success', 'CodeQL'), 'missing'],
  [
    'newest run wins',
    '{"total_count":2,"workflow_runs":[{"id":7,"name":"CI","head_sha":"abc","status":"completed","conclusion":"failure"},{"id":8,"name":"CI","head_sha":"abc","status":"completed","conclusion":"success"}]}',
    'success',
  ],
];

/** Runs the real step body with a `gh` stub that replays a queue of answers. */
function runGate(queue: string[], options: { unreadable?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dnd-trusted-gate-'));
  try {
    const queuePath = join(dir, 'queue');
    const counterPath = join(dir, 'counter');
    writeFileSync(queuePath, queue.length > 0 ? `${queue.join('\n')}\n` : '\n');
    const stub = join(dir, 'gh');
    writeFileSync(
      stub,
      [
        '#!/usr/bin/env bash',
        '# Mimics `gh api <path> --jq <filter>`: the filter is applied by the stub,',
        '# and an error is written to stdout with a non-zero status, exactly as gh does.',
        'if [ "${STUB_GH_FAILS:-}" = "1" ]; then',
        '  echo \'{"message":"Resource not accessible","status":"403"}\'',
        '  exit 1',
        'fi',
        'filter=""',
        'while [ $# -gt 0 ]; do',
        '  case "$1" in',
        '    --jq) filter="$2"; shift 2 ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        `n=$(cat "${counterPath}" 2>/dev/null || echo 0)`,
        'n=$((n + 1))',
        `echo "$n" > "${counterPath}"`,
        `total=$(wc -l < "${queuePath}")`,
        '[ "$n" -le "$total" ] || n="$total"',
        `printf '%s' "$(sed -n "\${n}p" "${queuePath}")" | jq -r "$filter"`,
      ].join('\n')
    );
    chmodSync(stub, 0o755);

    // The 900 s deadline and the 15 s poll interval are shortened so the
    // fail-closed paths are actually reachable. Both replacements are asserted,
    // so a renamed constant fails the test instead of running for 15 minutes.
    const script = step.run.replace('+ 900 )', '+ 1 )');
    expect(script, 'the gate deadline must still be written as "+ 900 )"').not.toBe(step.run);
    const polled = script.replace('sleep 15', 'sleep 0.1');
    expect(polled, 'the gate poll interval must still be written as "sleep 15"').not.toBe(script);

    const scriptPath = join(dir, 'gate.sh');
    writeFileSync(scriptPath, polled);

    return spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'Franiboy/dnd_dashboard',
        HEAD_SHA,
        ...(options.unreadable ? { STUB_GH_FAILS: '1' } : {}),
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('trusted gate step', () => {
  beforeAll(() => {
    requireTool('bash');
    requireTool('jq');
  });

  it('is guarded to the trusted event and authenticates with the job token', () => {
    expect(step.condition).toBe("github.event_name == 'pull_request_target'");
    expect(step.raw).toContain('GH_TOKEN: ${{ github.token }}');
    expect(step.raw).not.toContain('secrets.');
  });

  it('classifies every documented API answer', () => {
    const filter = jqFilter(step.run);
    for (const [name, payload, expected] of FIXTURES) {
      const result = spawnSync('jq', ['-r', filter], { input: payload, encoding: 'utf8' });
      expect(result.status, `${name}: jq failed`).toBe(0);
      expect(result.stdout.trim(), name).toBe(expected);
    }
  });

  it('passes when the pull request CI is green', () => {
    const result = runGate([runs(1, 'completed', 'success')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pull request CI is green');
  });

  it('waits for a pending run and then passes', () => {
    const result = runGate([runs(2, 'in_progress', null), runs(1, 'completed', 'success')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pull request CI is green');
  });

  it('fails immediately when the pull request CI is red', () => {
    const result = runGate([runs(3, 'completed', 'failure')]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('did not succeed');
  });

  it('fails closed when no run appears before the deadline', () => {
    const result = runGate(['{"total_count":0,"workflow_runs":[]}']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('within 900s');
  });

  it('fails closed when the answer cannot be read', () => {
    const result = runGate([runs(1, 'completed', 'success')], { unreadable: true });
    expect(result.status).not.toBe(0);
  });
});
