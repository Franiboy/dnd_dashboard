import { afterEach, describe, expect, it } from 'vitest';
import { buildOpenCodeEnvironment } from './opencode.js';

const originalLanguage = process.env.AI_OUTPUT_LANGUAGE;
const originalToken = process.env.MCP_SESSION_TOKEN;
const originalScopes = process.env.MCP_SCOPES;

afterEach(() => {
  if (originalLanguage === undefined) delete process.env.AI_OUTPUT_LANGUAGE;
  else process.env.AI_OUTPUT_LANGUAGE = originalLanguage;
  if (originalToken === undefined) delete process.env.MCP_SESSION_TOKEN;
  else process.env.MCP_SESSION_TOKEN = originalToken;
  if (originalScopes === undefined) delete process.env.MCP_SCOPES;
  else process.env.MCP_SCOPES = originalScopes;
});

describe('buildOpenCodeEnvironment', () => {
  it('always sets the run language, including runs without an MCP token', () => {
    process.env.MCP_SESSION_TOKEN = 'stale-token';
    process.env.MCP_SCOPES = 'diary:read';

    const env = buildOpenCodeEnvironment('en');

    expect(env.AI_OUTPUT_LANGUAGE).toBe('en');
    expect(env.MCP_SESSION_TOKEN).toBeUndefined();
    expect(env.MCP_SCOPES).toBeUndefined();
  });

  it('passes the language and token scopes to MCP processes', () => {
    const env = buildOpenCodeEnvironment('de', 'run-token', ['diary:read', 'entity:read']);

    expect(env.AI_OUTPUT_LANGUAGE).toBe('de');
    expect(env.MCP_SESSION_TOKEN).toBe('run-token');
    expect(env.MCP_SCOPES).toBe('diary:read,entity:read');
  });
});
