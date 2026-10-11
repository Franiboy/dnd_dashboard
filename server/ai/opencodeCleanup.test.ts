import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
  spawn: () => {
    throw new Error('spawn must not be called in this test');
  },
}));

// opencode.ts is already loaded with real builtins by the test setup
// (setup -> migrations -> ai/rewrite -> ai/opencode), so the mock above only
// takes effect for a fresh import. Resetting the module registry and importing
// dynamically keeps the test in-process: no stub binary is executed, which the
// release validation container (noexec /tmp) would refuse with EACCES.
vi.resetModules();
const { cleanupOpenCodeSessions } = await import('./opencode.js');

const HOUR_MS = 60 * 60 * 1000;

let sessionListJson = '[]';
const deletedIds: string[] = [];

beforeEach(() => {
  sessionListJson = '[]';
  deletedIds.length = 0;
  execFileSyncMock.mockReset();
  execFileSyncMock.mockImplementation((_bin: unknown, args: unknown) => {
    const argv = args as string[];
    if (argv[0] === 'session' && argv[1] === 'list') return sessionListJson;
    if (argv[0] === 'session' && argv[1] === 'delete' && typeof argv[2] === 'string') {
      deletedIds.push(argv[2]);
    }
    return '';
  });
});

describe('cleanupOpenCodeSessions', () => {
  it('ignores sessions without a title instead of throwing', async () => {
    const old = Date.now() - 2 * HOUR_MS;
    sessionListJson = JSON.stringify([
      { id: 'ses_old', title: 'dnd-old', directory: '/tmp', updated: old },
      { id: 'ses_untitled', directory: '/tmp', updated: old },
      { id: 'ses_other', title: 'other', directory: '/tmp', updated: old },
    ]);

    const deleted = await cleanupOpenCodeSessions({ prefix: 'dnd-', maxAgeMs: HOUR_MS });

    expect(deleted).toBe(1);
    expect(deletedIds).toEqual(['ses_old']);
  });

  it('skips sessions without an id or updated timestamp', async () => {
    const old = Date.now() - 2 * HOUR_MS;
    sessionListJson = JSON.stringify([
      { title: 'dnd-no-id', directory: '/tmp', updated: old },
      { id: 'ses_no_updated', title: 'dnd-no-updated', directory: '/tmp' },
      { id: 'ses_ok', title: 'dnd-ok', directory: '/tmp', updated: old },
    ]);

    const deleted = await cleanupOpenCodeSessions({ prefix: 'dnd-', maxAgeMs: HOUR_MS });

    expect(deleted).toBe(1);
    expect(deletedIds).toEqual(['ses_ok']);
  });

  it('treats legacy second-based timestamps as old', async () => {
    const oldSeconds = Math.floor(Date.now() / 1000) - 7200;
    sessionListJson = JSON.stringify([
      { id: 'ses_legacy', title: 'dnd-legacy', directory: '/tmp', updated: oldSeconds },
    ]);

    const deleted = await cleanupOpenCodeSessions({ prefix: 'dnd-', maxAgeMs: HOUR_MS });

    expect(deleted).toBe(1);
    expect(deletedIds).toEqual(['ses_legacy']);
  });
});
