import { spawn } from 'node:child_process';

export interface OpenCodeOptions {
  prompt: string;
  worktreePath: string;
  model: string;
  title?: string;
  sessionId?: string;
  onLog?: (line: string) => void;
}

export interface OpenCodeResult {
  success: boolean;
  output: string;
  exitCode: number;
}

export function runOpenCode({
  prompt,
  worktreePath,
  model,
  title,
  sessionId,
  onLog,
}: OpenCodeOptions): Promise<OpenCodeResult> {
  const bin = process.env.AI_OPENCODE_BIN || 'opencode';
  const args = ['run'];

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

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: worktreePath,
      stdio: 'pipe',
      env: process.env,
    });

    let output = '';
    child.stdout?.on('data', (data) => {
      const line = data.toString();
      output += line;
      onLog?.(line);
    });
    child.stderr?.on('data', (data) => {
      const line = data.toString();
      output += line;
      onLog?.(line);
    });
    child.on('close', (exitCode) => {
      resolve({ success: exitCode === 0, output, exitCode: exitCode ?? 1 });
    });
  });
}

export async function findOpenCodeSessionId(
  worktreePath: string,
  title: string,
): Promise<string | null> {
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync('opencode session list --format json', {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    const sessions = JSON.parse(output) as Array<{
      id: string;
      title: string;
      directory: string;
      updated: number;
    }>;
    const matches = sessions
      .filter((s) => s.title === title && s.directory === worktreePath)
      .sort((a, b) => b.updated - a.updated);
    return matches[0]?.id || null;
  } catch {
    return null;
  }
}
