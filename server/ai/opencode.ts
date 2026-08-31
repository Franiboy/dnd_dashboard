import { execFileSync, spawn } from 'node:child_process';
import { createLogger, MAX_OBJECT_ARG_LENGTH } from '../logger.js';
import {
  createMcpSessionToken,
  type KnowledgeTarget,
  type McpScope,
  type McpSessionUser,
} from '../mcp/tokens.js';

const log = createLogger('opencode');

const MAX_OUTPUT_LENGTH = 200_000;

function appendOutput(output: string, chunk: string): string {
  if (!chunk) return output;
  const combined = output + chunk;
  if (combined.length <= MAX_OUTPUT_LENGTH) return combined;
  const half = Math.floor(MAX_OUTPUT_LENGTH / 2);
  return `${combined.slice(0, half)}\n... [output truncated] ...\n${combined.slice(-half)}`;
}

function getOpenCodeBin(): string {
  return process.env.AI_OPENCODE_BIN || 'opencode';
}

/**
 * Determines the opencode major version from the configured binary.
 * The binary name is the single source of truth (driven by AI_OPENCODE_BIN):
 * an `opencode2` binary runs the V2 CLI, anything else is treated as V1.
 */
export function isOpenCodeV2(): boolean {
  const bin = getOpenCodeBin();
  const name = bin.split(/[\\/]/).pop() ?? bin;
  return /\bopencode2\.exe$/i.test(name) || /^opencode2/iu.test(name);
}

export interface OpenCodeOptions {
  prompt: string;
  worktreePath: string;
  model: string;
  title?: string;
  sessionId?: string;
  scopes?: McpScope[];
  user?: McpSessionUser;
  recordingSessionId?: number;
  /** Restricts knowledge mutations to a single entity (server-side). */
  knowledgeTarget?: KnowledgeTarget;
  onLog?: (line: string) => void;
}

export interface OpenCodeResult {
  success: boolean;
  output: string;
  exitCode: number;
  sessionId: string | null;
}

export function runOpenCode({
  prompt,
  worktreePath,
  model,
  title,
  sessionId,
  scopes,
  user,
  recordingSessionId,
  knowledgeTarget,
  onLog,
}: OpenCodeOptions): Promise<OpenCodeResult> {
  if (prompt.length > 50_000) {
    log.warn(
      `Prompt is very long (${prompt.length} chars) and is passed as a CLI argument; read large content via MCP tools instead`
    );
  }
  const bin = getOpenCodeBin();
  const args = ['run'];

  const mcpToken =
    scopes && scopes.length > 0
      ? createMcpSessionToken(scopes, user, recordingSessionId, knowledgeTarget)
      : undefined;
  if (mcpToken) {
    log.info(
      `Created MCP session token with scopes: ${scopes?.join(', ')}${user ? `, user: ${user.id}` : ''}`
    );
  }

  const v2 = isOpenCodeV2();

  if (sessionId) {
    args.push('--session', sessionId);
  } else if (title) {
    args.push('--title', title);
  }

  args.push(prompt, '--model', model, '--auto', '--format', 'default');

  if (!v2 && !sessionId) {
    args.push('--dir', worktreePath);
  }
  if (v2) {
    // V2 talks to the persistent background service, which would spawn the
    // MCP server without the per-run MCP_SESSION_TOKEN (and without user
    // context). A private per-run server (--standalone) inherits the env, so
    // scoped MCP access keeps working exactly like V1.
    args.push('--standalone');
  }

  const displayArgs = args.map((a) =>
    a === prompt ? `<prompt:${a.length} chars>` : a.includes(' ') ? `"${a}"` : a
  );
  log.info('Spawning opencode', {
    bin,
    args: displayArgs,
    title: title ?? null,
    model,
    worktreePath,
    promptLength: prompt.length,
    prompt:
      prompt.length > MAX_OBJECT_ARG_LENGTH
        ? `${prompt.slice(0, MAX_OBJECT_ARG_LENGTH)}...`
        : prompt,
  });

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: mcpToken
        ? { ...process.env, MCP_SESSION_TOKEN: mcpToken, MCP_SCOPES: scopes?.join(',') }
        : process.env,
    });

    let output = '';

    const emitLog = (line: string) => {
      onLog?.(line);
    };

    child.stdout?.on('data', (data) => {
      const line = data.toString();
      output = appendOutput(output, line);
      emitLog(line);
    });
    child.stderr?.on('data', (data) => {
      const line = data.toString();
      output = appendOutput(output, line);
      emitLog(line);
    });
    child.on('error', (err) => {
      const errorLine = `\nOpenCode spawn error: ${err.message}\n`;
      output = appendOutput(output, errorLine);
      log.error(errorLine);
      emitLog(errorLine);
      resolve({ success: false, output, exitCode: -1, sessionId: sessionId ?? null });
    });
    child.on('close', async (exitCode) => {
      const success = exitCode === 0;
      if (!success) {
        const snippet = output.trim().slice(-500) || 'no output';
        const errorLine = `OpenCode failed with exit code ${exitCode ?? 'unknown'}: ${snippet}`;
        output = appendOutput(output, `\n${errorLine}\n`);
        log.warn(errorLine);
        resolve({ success, output, exitCode: exitCode ?? 1, sessionId: sessionId ?? null });
        return;
      }

      log.info(`OpenCode finished with exit code ${exitCode ?? 'unknown'} (success=${success})`);

      let finalSessionId = sessionId ?? null;
      if (!finalSessionId && title) {
        finalSessionId = await findOpenCodeSessionId(worktreePath, title);
        if (finalSessionId) {
          log.info(`Resolved opencode session for title "${title}": ${finalSessionId}`);
        }
      }

      resolve({ success, output, exitCode: exitCode ?? 0, sessionId: finalSessionId });
    });
  });
}

export async function findOpenCodeSessionId(
  worktreePath: string,
  title: string
): Promise<string | null> {
  log.info(`Looking up opencode session: title=${title}, worktreePath=${worktreePath}`);
  try {
    const sessions = await listOpenCodeSessions();
    const matches = sessions
      .filter((s) => s.title === title && s.directory === worktreePath)
      .sort((a, b) => b.updated - a.updated);
    const id = matches[0]?.id || null;
    log.info(`Found opencode session: ${id ?? 'none'}`);
    return id;
  } catch (err) {
    log.error('Failed to list opencode sessions:', err);
    return null;
  }
}

export async function deleteOpenCodeSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const bin = getOpenCodeBin();
  log.info(`Deleting opencode session: ${sessionId}`);
  try {
    if (isOpenCodeV2()) {
      execFileSync(bin, ['api', 'DELETE', `/api/session/${sessionId}`], {
        encoding: 'utf-8',
        timeout: 30_000,
      });
    } else {
      execFileSync(bin, ['session', 'delete', sessionId], {
        encoding: 'utf-8',
        timeout: 30_000,
      });
    }
    log.info(`Deleted opencode session: ${sessionId}`);
  } catch (err) {
    log.warn(`Failed to delete opencode session ${sessionId}:`, err);
  }
}

export interface OpenCodeSession {
  id: string;
  title: string;
  directory: string;
  updated: number;
}

export async function listOpenCodeSessions(): Promise<OpenCodeSession[]> {
  const bin = getOpenCodeBin();
  try {
    if (isOpenCodeV2()) {
      const output = execFileSync(bin, ['api', 'GET', '/api/session'], {
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      const parsed = JSON.parse(output) as { data?: Array<Record<string, unknown>> };
      return (parsed.data ?? []).map(mapV2Session).filter((s): s is OpenCodeSession => s !== null);
    }
    const output = execFileSync(bin, ['session', 'list', '--format', 'json'], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(output) as OpenCodeSession[];
  } catch (err) {
    log.error(`Failed to list opencode sessions using ${bin}:`, err);
    return [];
  }
}

function mapV2Session(raw: Record<string, unknown>): OpenCodeSession | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return null;
  const title = typeof raw.title === 'string' ? raw.title : '';
  const time = (raw.time ?? {}) as Record<string, unknown>;
  const location = (raw.location ?? {}) as Record<string, unknown>;
  const directory = typeof location.directory === 'string' ? location.directory : '';
  const updatedMs = typeof time.updated === 'number' ? time.updated : 0;
  return { id, title, directory, updated: updatedMs / 1000 };
}

export async function cleanupOpenCodeSessions(
  options: {
    keepSessionIds?: Set<string>;
    maxAgeMs?: number;
    prefix?: string;
  } = {}
): Promise<number> {
  const { keepSessionIds = new Set(), maxAgeMs = 24 * 60 * 60 * 1000, prefix = 'dnd-' } = options;
  const now = Date.now();
  const sessions = await listOpenCodeSessions();
  const candidates = sessions.filter((s) => s.title.startsWith(prefix));

  let deleted = 0;
  for (const session of candidates) {
    if (keepSessionIds.has(session.id)) continue;
    if (now - session.updated * 1000 < maxAgeMs) continue;

    await deleteOpenCodeSession(session.id);
    deleted++;
  }

  log.info(
    `Cleaned up ${deleted} old opencode sessions (prefix="${prefix}", maxAgeMs=${maxAgeMs})`
  );
  return deleted;
}
