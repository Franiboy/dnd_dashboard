import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('env validation', () => {
  it('accepts an empty environment and applies defaults', () => {
    const result = parseEnv({});
    expect(result.success).toBe(true);
    expect(result.data?.PORT).toBe(3001);
    expect(result.data?.NODE_ENV).toBe('development');
    expect(result.data?.DB_PATH).toBe('dnd.db');
    expect(result.data?.LOG_RETENTION_MAX).toBe(100000);
  });

  it('parses a numeric PORT', () => {
    const result = parseEnv({ PORT: '8080' });
    expect(result.success).toBe(true);
    expect(result.data?.PORT).toBe(8080);
  });

  it('rejects a non-numeric PORT', () => {
    const result = parseEnv({ PORT: 'not-a-port' });
    expect(result.success).toBe(false);
  });

  it('parses TRUST_PROXY boolean-ish values', () => {
    expect(parseEnv({ TRUST_PROXY: 'true' }).data?.TRUST_PROXY).toBe(true);
    expect(parseEnv({ TRUST_PROXY: '1' }).data?.TRUST_PROXY).toBe(true);
    expect(parseEnv({ TRUST_PROXY: 'false' }).data?.TRUST_PROXY).toBe(false);
  });

  it('accepts positive valid BINGO integers', () => {
    const result = parseEnv({ BINGO_SUGGESTION_TARGET: '20' });
    expect(result.data?.BINGO_SUGGESTION_TARGET).toBe(20);
  });

  it('rejects non-positive BINGO integers', () => {
    const result = parseEnv({ BINGO_SUGGESTION_TARGET: '-5' });
    expect(result.success).toBe(false);
  });

  it('exposes the JWT expiry as a positive number', () => {
    const result = parseEnv({ JWT_EXPIRES_IN_DAYS: '14' });
    expect(result.data?.JWT_EXPIRES_IN_DAYS).toBe(14);
  });
});
