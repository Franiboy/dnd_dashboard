import { afterEach, describe, expect, it } from 'vitest';
import { getVersion } from './version.js';

const originalReleaseSha = process.env.DND_RELEASE_SHA;

afterEach(() => {
  if (originalReleaseSha === undefined) delete process.env.DND_RELEASE_SHA;
  else process.env.DND_RELEASE_SHA = originalReleaseSha;
});

describe('version metadata', () => {
  it('exposes the release SHA supplied by the deployment', () => {
    process.env.DND_RELEASE_SHA = 'a'.repeat(40);
    expect(getVersion().releaseSha).toBe('a'.repeat(40));
  });
});
