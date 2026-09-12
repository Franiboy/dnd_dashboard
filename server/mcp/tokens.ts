import jwt from 'jsonwebtoken';
import { createLogger } from '../logger.js';

const log = createLogger('mcp-tokens');

export type McpScope =
  | 'diary:read'
  | 'diary:read-all'
  | 'diary:summarize'
  | 'diary:rewrite'
  | 'diary:draft'
  | 'entity:read'
  | 'entity:extract'
  | 'entity:summary'
  | 'knowledge:distribute'
  | 'recording:read'
  | 'recording:summarize'
  | 'recording:boundaries'
  | 'recording:game-day'
  | 'timeline:write'
  | 'bingo:read'
  | 'bingo:write';

export interface McpSessionUser {
  id: string;
  displayName?: string;
  isAdmin?: boolean;
  activePerson?: string | null;
}

/** Restricts knowledge mutations in a session to one entity. */
export interface KnowledgeTarget {
  entityType: 'persons' | 'organizations' | 'locations' | 'items';
  entityName: string;
  entityQualifier: string;
}

export interface McpSessionTokenInput {
  sessionId: string;
  scopes: McpScope[];
  userId?: string;
  isAdmin?: boolean;
  recordingSessionId?: number;
  knowledgeTarget?: KnowledgeTarget;
  /**
   * Story arc of the processed object. When set, every context-reading MCP
   * tool scopes its queries to this arc, so AI runs never scan the whole
   * campaign history.
   */
  arcId?: number;
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

export function createMcpSessionToken(
  scopes: McpScope[],
  user?: McpSessionUser,
  recordingSessionId?: number,
  knowledgeTarget?: KnowledgeTarget,
  arcId?: number
): string {
  const secret = getSecret();
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload: McpSessionTokenInput = { sessionId, scopes };
  if (user) {
    payload.userId = user.id;
    payload.isAdmin = user.isAdmin ?? false;
  }
  if (recordingSessionId !== undefined) {
    payload.recordingSessionId = recordingSessionId;
  }
  if (knowledgeTarget) {
    payload.knowledgeTarget = knowledgeTarget;
  }
  if (arcId !== undefined) {
    payload.arcId = arcId;
  }
  return jwt.sign(payload, secret, { expiresIn: '10m' });
}

export function verifyMcpSessionToken(token: string): McpSessionPayload | null {
  const secret = getSecret();
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as McpSessionPayload;
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
