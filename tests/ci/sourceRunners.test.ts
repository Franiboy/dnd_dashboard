import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repoRoot, 'scripts', 'verify-source-runners.sh');

/**
 * The trust boundary of the split-repository design only holds while this
 * repository never schedules a job on the production host. A self-hosted
 * `runs-on` here would execute pull request code on HomeServer, so the
 * invariant is enforced by a script instead of a documentation checklist.
 */
describe('source repository runner isolation', () => {
  it('accepts the current workflows and reports the checked count', () => {
    const output = execFileSync('bash', [script, repoRoot], { encoding: 'utf8' });

    expect(output).toMatch(/workflow file\(s\) checked, no self-hosted job/);
  });

  it('rejects a workflow that schedules a self-hosted job', () => {
    withFixture(
      {
        'self-hosted.yml':
          'name: bad\non: push\njobs:\n  a:\n    runs-on: [self-hosted, Linux, X64, HomeServer]\n    steps: []\n',
        'hosted.yml': 'name: ok\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps: []\n',
      },
      (root) => {
        const result = runExpectFailure(root);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('must not schedule any job on a self-hosted runner');
        expect(result.stderr).toContain('self-hosted.yml');
      }
    );
  });

  it('ignores a self-hosted label that is only mentioned in a comment', () => {
    withFixture(
      {
        'commented.yml':
          '# the private dispatcher is the caller of the self-hosted reusable workflow\nname: ok\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps: []\n',
      },
      (root) => {
        const output = execFileSync('bash', [script, root], { encoding: 'utf8' });

        expect(output).toMatch(/no self-hosted job/);
      }
    );
  });

  it('fails when there is no workflow directory at all', () => {
    withFixture(
      {},
      (root) => {
        const result = runExpectFailure(root);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('workflow directory is missing');
      },
      { withWorkflowDir: false }
    );
  });
});

function withFixture(
  workflows: Record<string, string>,
  body: (root: string) => void,
  options: { withWorkflowDir?: boolean } = {}
): void {
  const root = mkdtempSync(path.join(tmpdir(), 'dnd-source-runners-'));
  try {
    if (options.withWorkflowDir !== false) {
      const dir = path.join(root, '.github', 'workflows');
      mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(workflows)) {
        writeFileSync(path.join(dir, name), content);
      }
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runExpectFailure(root: string): { status: number | null; stderr: string } {
  try {
    execFileSync('bash', [script, root], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const failure = error as { status?: number | null; stderr?: Buffer | string };
    return { status: failure.status ?? null, stderr: String(failure.stderr ?? '') };
  }
  return { status: 0, stderr: '' };
}
