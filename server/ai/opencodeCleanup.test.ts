import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupOpenCodeSessions } from './opencode.js';

const HOUR_MS = 60 * 60 * 1000;
const originalBin = process.env.AI_OPENCODE_BIN;

afterEach(() => {
  if (originalBin === undefined) delete process.env.AI_OPENCODE_BIN;
  else process.env.AI_OPENCODE_BIN = originalBin;
});

interface Stub {
  callsFile: string;
  cleanup: () => void;
}

/**
 * Installs a fake `opencode` binary that serves the given session list and
 * records `session delete` calls. `getOpenCodeBin()` reads the env var at
 * call time, so this exercises the real code path including argument passing.
 */
function installStubBin(sessionListJson: string): Stub {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-stub-'));
  const callsFile = join(dir, 'delete-calls.txt');
  writeFileSync(callsFile, '');
  const stub = join(dir, 'opencode');
  writeFileSync(
    stub,
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "session" ] && [ "$2" = "list" ]; then',
      `cat ${join(dir, 'sessions.json')}`,
      'elif [ "$1" = "session" ] && [ "$2" = "delete" ]; then',
      `echo "$3" >> ${callsFile}`,
      'fi',
    ].join('\n')
  );
  writeFileSync(join(dir, 'sessions.json'), sessionListJson);
  chmodSync(stub, 0o755);
  process.env.AI_OPENCODE_BIN = stub;
  return { callsFile, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function deletedSessionIds(callsFile: string): string[] {
  const content = readFileSync(callsFile, 'utf-8').trim();
  return content.length === 0 ? [] : content.split('\n');
}

describe('cleanupOpenCodeSessions', () => {
  it('ignores sessions without a title instead of throwing', async () => {
    const old = Date.now() - 2 * HOUR_MS;
    const stub = installStubBin(
      JSON.stringify([
        { id: 'ses_old', title: 'dnd-old', directory: '/tmp', updated: old },
        { id: 'ses_untitled', directory: '/tmp', updated: old },
        { id: 'ses_other', title: 'other', directory: '/tmp', updated: old },
      ])
    );
    try {
      const deleted = await cleanupOpenCodeSessions({ prefix: 'dnd-', maxAgeMs: HOUR_MS });
      expect(deleted).toBe(1);
      expect(deletedSessionIds(stub.callsFile)).toEqual(['ses_old']);
    } finally {
      stub.cleanup();
    }
  });

  it('skips sessions without an id or updated timestamp', async () => {
    const old = Date.now() - 2 * HOUR_MS;
    const stub = installStubBin(
      JSON.stringify([
        { title: 'dnd-no-id', directory: '/tmp', updated: old },
        { id: 'ses_no_updated', title: 'dnd-no-updated', directory: '/tmp' },
        { id: 'ses_ok', title: 'dnd-ok', directory: '/tmp', updated: old },
      ])
    );
    try {
      const deleted = await cleanupOpenCodeSessions({ prefix: 'dnd-', maxAgeMs: HOUR_MS });
      expect(deleted).toBe(1);
      expect(deletedSessionIds(stub.callsFile)).toEqual(['ses_ok']);
    } finally {
      stub.cleanup();
    }
  });

  it('treats legacy second-based timestamps as old', async () => {
    const oldSeconds = Math.floor(Date.now() / 1000) - 7200;
    const stub = installStubBin(
      JSON.stringify([
        { id: 'ses_legacy', title: 'dnd-legacy', directory: '/tmp', updated: oldSeconds },
      ])
    );
    try {
      const deleted = await cleanupOpenCodeSessions({ prefix: 'dnd-', maxAgeMs: HOUR_MS });
      expect(deleted).toBe(1);
      expect(deletedSessionIds(stub.callsFile)).toEqual(['ses_legacy']);
    } finally {
      stub.cleanup();
    }
  });
});
