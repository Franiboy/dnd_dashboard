import jwt from 'jsonwebtoken';
import { createLogger } from '../logger.js';

const log = createLogger('mcp-tokens');

export type McpScope =
  | 'diary:read'
  | 'diary:summarize'
  | 'diary:rewrite'
  | 'entity:read'
  | 'entity:extract'
  | 'entity:summary'
  | 'knowledge:distribute';

export interface McpSessionTokenInput {
  sessionId: string;
  scopes: McpScope[];
}

export interface McpSessionPayload extends McpSessionTokenInput {
  iat: number;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.MCP_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('MCP_TOKEN_SECRET oder JWT_SECRET muss gesetzt sein');
  }
  return secret;
}

export function createMcpSessionToken(scopes: McpScope[]): string {
  const secret = getSecret();
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload: McpSessionTokenInput = { sessionId, scopes };
  return jwt.sign(payload, secret, { expiresIn: '10m' });
}

export function verifyMcpSessionToken(token: string): McpSessionPayload | null {
  const secret = getSecret();
  try {
    const decoded = jwt.verify(token, secret) as McpSessionPayload;
    if (!Array.isArray(decoded.scopes)) {
      log.warn('MCP token has no scopes');
      return null;
    }
    return decoded;
  } catch (err) {
    log.warn('MCP token verification failed:', err);
    return null;
  }
}
