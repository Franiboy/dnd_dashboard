import { spawn } from 'node:child_process';
import { createLogger } from '../logger.js';
import { createMcpSessionToken, type McpScope } from '../mcp/tokens.js';

const log = createLogger('opencode');

function getOpenCodeBin(): string {
  return process.env.AI_OPENCODE_BIN || 'opencode';
}

export interface OpenCodeOptions {
  prompt: string;
  worktreePath: string;
  model: string;
  title?: string;
  sessionId?: string;
  scopes?: McpScope[];
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
  onLog,
}: OpenCodeOptions): Promise<OpenCodeResult> {
  const bin = getOpenCodeBin();
  const args = ['run'];

  const mcpToken = scopes && scopes.length > 0 ? createMcpSessionToken(scopes) : undefined;
  if (mcpToken) {
    log.info(`Created MCP session token with scopes: ${scopes?.join(', ')}`);
  }

  if (sessionId) {
    args.push('--session', sessionId);
  } else if (title) {
    args.push('--title', title);
  }

  args.push(
    prompt,
    '--model',
    model,
    '--auto',
    '--format',
    'default',
  );

  if (!sessionId) {
    args.push('--dir', worktreePath);
  }

  log.info(`Spawning opencode: ${bin} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

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
      output += line;
      emitLog(line);
    });
    child.stderr?.on('data', (data) => {
      const line = data.toString();
      output += line;
      emitLog(line);
    });
    child.on('error', (err) => {
      const errorLine = `\nOpenCode spawn error: ${err.message}\n`;
      output += errorLine;
      log.error(errorLine);
      emitLog(errorLine);
      resolve({ success: false, output, exitCode: -1, sessionId: sessionId ?? null });
    });
    child.on('close', async (exitCode) => {
      const success = exitCode === 0;
      if (!success) {
        const snippet = output.trim().slice(0, 500) || 'no output';
        const errorLine = `OpenCode failed with exit code ${exitCode ?? 'unknown'}: ${snippet}`;
        output += `\n${errorLine}\n`;
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
  title: string,
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
    const { execSync } = await import('node:child_process');
    execSync(`${bin} session delete ${sessionId}`, {
      encoding: 'utf-8',
      timeout: 30_000,
    });
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
    const { execSync } = await import('node:child_process');
    const output = execSync(`${bin} session list --format json`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(output) as OpenCodeSession[];
  } catch (err) {
    log.error(`Failed to list opencode sessions using ${bin}:`, err);
    return [];
  }
}

export async function cleanupOpenCodeSessions(
  options: {
    keepSessionIds?: Set<string>;
    maxAgeMs?: number;
    prefix?: string;
  } = {},
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

  log.info(`Cleaned up ${deleted} old opencode sessions (prefix="${prefix}", maxAgeMs=${maxAgeMs})`);
  return deleted;
}
