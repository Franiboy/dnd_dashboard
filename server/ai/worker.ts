import { spawn, execSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findFreePort } from '../utils/port.js';
import { runOpenCode, findOpenCodeSessionId } from './opencode.js';
import {
  updateFeatureRequest,
  appendFeatureRequestLogs,
  getFeatureRequestById,
  deleteFeatureRequest,
} from '../repositories/featureRequests.js';

const PREVIEW_PORT_BASE = 4000;
const WORKTREE_PREFIX = 'dnd_dashboard-preview-';

function buildPreviewUrl(protocol: string, hostname: string, port: number): string {
  return `${protocol}://${hostname}:${port}`;
}

function buildPrompt(title: string, description: string, branch: string): string {
  return [
    `Implement the following feature in this Node.js + React + SQLite web app:`,
    `Title: ${title}`,
    `Description: ${description}`,
    ``,
    `Rules:`,
    `- Create a git branch named "${branch}" and check it out.`,
    `- Make the minimal changes needed to implement the feature.`,
    `- Follow the existing code style and architecture (React functional components, Express routes, better-sqlite3 for DB).`,
    `- Do not start any server or interactive process.`,
    `- Do not commit or push; only make code changes.`,
    `- If you need to add a dependency, use npm install --save <package>.`,
    `- Run "npm run build" to verify the build passes before finishing.`,
  ].join('\n');
}

function logLine(id: number, line: string): void {
  appendFeatureRequestLogs(id, line);
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; onLog?: (line: string) => void },
): Promise<{ success: boolean; output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: 'pipe',
      env: options.env ?? process.env,
    });
    let output = '';
    child.stdout?.on('data', (data) => {
      const line = data.toString();
      output += line;
      options.onLog?.(line);
    });
    child.stderr?.on('data', (data) => {
      const line = data.toString();
      output += line;
      options.onLog?.(line);
    });
    child.on('error', (err) => {
      output += `\nCommand error: ${err.message}\n`;
      resolve({ success: false, output, exitCode: -1 });
    });
    child.on('close', (exitCode) => {
      resolve({ success: exitCode === 0, output, exitCode: exitCode ?? 1 });
    });
  });
}

function execGit(args: string, options: { cwd: string; timeout?: number }): void {
  execSync(`git ${args}`, { cwd: options.cwd, encoding: 'utf-8', timeout: options.timeout ?? 30000 });
}

function createUniquePath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;
  let suffix = 2;
  let candidate = `${basePath}_${suffix}`;
  while (existsSync(candidate) && suffix < 1000) {
    suffix++;
    candidate = `${basePath}_${suffix}`;
  }
  return candidate;
}

export function startFeatureRequest(
  id: number,
  previewProtocol: string,
  previewHostname: string,
): void {
  const request = getFeatureRequestById(id);
  if (!request) return;

  const model = process.env.AI_MODEL || 'dotsource_rag/code-secure-local';
  const branch = `feature/ai-${id}`;
  const sessionTitle = `dnd-feature-request-${id}`;
  let worktreePath = resolve(join(process.cwd(), '..', `${WORKTREE_PREFIX}${id}`));
  worktreePath = createUniquePath(worktreePath);

  updateFeatureRequest(id, {
    status: 'running',
    branch,
    worktreePath,
    sessionTitle,
    logs: `Starting AI feature request #${id}...\nModel: ${model}\nBranch: ${branch}\nWorktree: ${worktreePath}\nSession title: ${sessionTitle}\n`,
  });

  (async () => {
    try {
      execGit('worktree prune', { cwd: process.cwd() });

      logLine(id, `Creating git worktree and branch ${branch}...\n`);
      execGit(`worktree add -f -B ${branch} ${worktreePath} main`, { cwd: process.cwd() });
      logLine(id, `Worktree created at ${worktreePath}\n`);

      const mainEnv = join(process.cwd(), '.env');
      const worktreeEnv = join(worktreePath, '.env');
      if (existsSync(mainEnv)) {
        copyFileSync(mainEnv, worktreeEnv);
      }

      logLine(id, `Installing dependencies in worktree...\n`);
      const installResult = await runCommand('npm', ['install'], {
        cwd: worktreePath,
        onLog: (line) => logLine(id, line),
      });
      if (!installResult.success) {
        logLine(id, `npm install failed with exit code ${installResult.exitCode}\n`);
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Running OpenCode with model ${model}...\n`);
      const prompt = buildPrompt(request.title, request.description, branch);
      const openCodeResult = await runOpenCode({
        prompt,
        worktreePath,
        model,
        title: sessionTitle,
        onLog: (line) => logLine(id, line),
      });

      const sessionId = await findOpenCodeSessionId(worktreePath, sessionTitle);
      if (sessionId) {
        logLine(id, `OpenCode session cached: ${sessionId}\n`);
        updateFeatureRequest(id, { sessionId });
      }

      if (!openCodeResult.success) {
        logLine(id, `OpenCode failed with exit code ${openCodeResult.exitCode}\n`);
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `OpenCode finished. Building preview...\n`);

      const buildResult = await runCommand('npm', ['run', 'build'], {
        cwd: worktreePath,
        onLog: (line) => logLine(id, line),
      });

      if (!buildResult.success) {
        logLine(id, `Build failed with exit code ${buildResult.exitCode}\n`);
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Committing changes in worktree...\n`);
      try {
        execGit('add -A', { cwd: worktreePath });
        try {
          execSync('git diff --cached --quiet', { cwd: worktreePath, encoding: 'utf-8' });
          // no staged changes
        } catch {
          execGit('commit -m "AI feature request implementation"', { cwd: worktreePath });
        }
      } catch {
        // add failed or commit failed
      }

      const previewPort = await findFreePort(PREVIEW_PORT_BASE);
      const previewEnv = {
        ...process.env,
        PORT: String(previewPort),
        NODE_ENV: 'production',
        DB_PATH: `dnd_preview_${id}.db`,
      };
      const previewProcess = spawn('npm', ['start'], {
        cwd: worktreePath,
        stdio: 'pipe',
        env: previewEnv,
        detached: true,
      });

      previewProcess.stdout?.on('data', (data) => logLine(id, `[preview] ${data}`));
      previewProcess.stderr?.on('data', (data) => logLine(id, `[preview] ${data}`));
      previewProcess.on('error', (err) => {
        logLine(id, `Preview server error: ${err.message}\n`);
        updateFeatureRequest(id, { status: 'failed' });
      });

      const previewUrl = buildPreviewUrl(previewProtocol, previewHostname, previewPort);
      logLine(id, `Preview server started on ${previewUrl} (PID ${previewProcess.pid})\n`);

      updateFeatureRequest(id, {
        status: 'preview_ready',
        previewPort,
        previewUrl,
        previewPid: previewProcess.pid ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(id, `Worker error: ${message}\n`);
      updateFeatureRequest(id, { status: 'failed' });
    }
  })();
}

export function continueFeatureRequest(
  id: number,
  prompt: string,
  previewProtocol: string,
  previewHostname: string,
): void {
  const request = getFeatureRequestById(id);
  if (!request) return;

  const model = process.env.AI_MODEL || 'dotsource_rag/code-secure-local';
  const worktreePath = request.worktreePath;
  const sessionTitle = request.sessionTitle || `dnd-feature-request-${id}`;
  if (!worktreePath) return;

  updateFeatureRequest(id, {
    status: 'running',
    sessionTitle,
    logs: `${request.logs || ''}\nContinuing AI session for feature request #${id}...\n`,
  });

  (async () => {
    try {
      if (request.previewPid) {
        try {
          process.kill(request.previewPid, 'SIGTERM');
        } catch {
          // ignore
        }
      }

      let sessionId = request.sessionId;
      if (!sessionId) {
        sessionId = await findOpenCodeSessionId(worktreePath, sessionTitle);
      }
      if (!sessionId) {
        logLine(id, 'No cached OpenCode session found. Aborting continue.\n');
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Continuing OpenCode session ${sessionId}...\n`);
      const openCodeResult = await runOpenCode({
        prompt,
        worktreePath,
        model,
        sessionId,
        onLog: (line) => logLine(id, line),
      });

      const newSessionId = await findOpenCodeSessionId(worktreePath, sessionTitle);
      if (newSessionId) {
        updateFeatureRequest(id, { sessionId: newSessionId });
      }

      if (!openCodeResult.success) {
        logLine(id, `OpenCode continue failed with exit code ${openCodeResult.exitCode}\n`);
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `OpenCode continue finished. Building preview...\n`);

      const buildResult = await runCommand('npm', ['run', 'build'], {
        cwd: worktreePath,
        onLog: (line) => logLine(id, line),
      });

      if (!buildResult.success) {
        logLine(id, `Build failed with exit code ${buildResult.exitCode}\n`);
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Committing changes in worktree...\n`);
      try {
        execGit('add -A', { cwd: worktreePath });
        try {
          execSync('git diff --cached --quiet', { cwd: worktreePath, encoding: 'utf-8' });
          // no staged changes
        } catch {
          execGit('commit -m "AI feature request continuation"', { cwd: worktreePath });
        }
      } catch {
        // add failed or commit failed
      }

      const previewPort = await findFreePort(PREVIEW_PORT_BASE);
      const previewEnv = {
        ...process.env,
        PORT: String(previewPort),
        NODE_ENV: 'production',
        DB_PATH: `dnd_preview_${id}.db`,
      };
      const previewProcess = spawn('npm', ['start'], {
        cwd: worktreePath,
        stdio: 'pipe',
        env: previewEnv,
        detached: true,
      });

      previewProcess.stdout?.on('data', (data) => logLine(id, `[preview] ${data}`));
      previewProcess.stderr?.on('data', (data) => logLine(id, `[preview] ${data}`));
      previewProcess.on('error', (err) => {
        logLine(id, `Preview server error: ${err.message}\n`);
        updateFeatureRequest(id, { status: 'failed' });
      });

      const previewUrl = buildPreviewUrl(previewProtocol, previewHostname, previewPort);
      logLine(id, `Preview server started on ${previewUrl} (PID ${previewProcess.pid})\n`);

      updateFeatureRequest(id, {
        status: 'preview_ready',
        previewPort,
        previewUrl,
        previewPid: previewProcess.pid ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(id, `Worker continue error: ${message}\n`);
      updateFeatureRequest(id, { status: 'failed' });
    }
  })();
}

export function mergeAndPushFeatureRequest(id: number): { success: boolean; error?: string } {
  const request = getFeatureRequestById(id);
  if (!request) return { success: false, error: 'Feature request not found' };
  if (!request.branch) return { success: false, error: 'No branch to merge' };

  try {
    if (request.previewPid) {
      try {
        process.kill(request.previewPid, 'SIGTERM');
      } catch {
        // ignore
      }
    }

    if (request.worktreePath) {
      try {
        execGit(`worktree remove --force ${request.worktreePath}`, { cwd: process.cwd() });
      } catch {
        // ignore
      }
    }

    const mainMergePath = createUniquePath(resolve(join(process.cwd(), '..', 'dnd_dashboard-main-merge')));
    execGit('worktree prune', { cwd: process.cwd() });
    execGit(`worktree add -f ${mainMergePath} main`, { cwd: process.cwd() });

    try {
      execGit(`merge --no-ff ${request.branch} -m "Merge AI feature request #${id}"`, {
        cwd: mainMergePath,
        timeout: 60000,
      });
      execGit('push origin main', { cwd: mainMergePath, timeout: 60000 });
    } finally {
      try {
        execGit(`worktree remove --force ${mainMergePath}`, { cwd: process.cwd() });
      } catch {
        // ignore
      }
    }

    updateFeatureRequest(id, {
      status: 'merged',
      previewUrl: null,
      previewPort: null,
      previewPid: null,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

function killProcess(pid: number) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore
  }
}

function killProcessGroup(pid: number) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // ignore
  }
}

function killProcessesByPort(port: number | null) {
  if (!port) return;
  try {
    execSync(`lsof -t -i :${port} 2>/dev/null | xargs kill -9 2>/dev/null || true`, {
      timeout: 10000,
    });
  } catch {
    // ignore
  }
}

function killProcessesInWorktree(worktreePath: string) {
  try {
    execSync(`fuser -k -TERM "${worktreePath}" 2>/dev/null || true`, { timeout: 5000 });
  } catch {
    // ignore
  }
  // fallback / final cleanup if processes are still hanging
  try {
    execSync(`fuser -k -KILL "${worktreePath}" 2>/dev/null || true`, { timeout: 5000 });
  } catch {
    // ignore
  }
}

function removeWorktree(worktreePath: string) {
  if (!existsSync(worktreePath)) return;
  try {
    execGit(`worktree remove --force ${worktreePath}`, { cwd: process.cwd() });
  } catch {
    // not a registered worktree anymore; remove directory directly
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function deleteLocalBranch(branch: string) {
  try {
    execGit(`branch -D ${branch}`, { cwd: process.cwd() });
  } catch {
    // ignore if branch does not exist
  }
}

function deleteRemoteBranch(branch: string) {
  try {
    execGit(`push origin --delete ${branch}`, { cwd: process.cwd(), timeout: 60000 });
  } catch {
    // ignore if remote branch does not exist
  }
}

export function cleanupFeatureRequest(id: number): { success: boolean; error?: string } {
  const request = getFeatureRequestById(id);
  if (!request) return { success: false, error: 'Feature request not found' };

  try {
    // Stop preview server (if running)
    if (request.previewPid) {
      killProcess(request.previewPid);
      killProcessGroup(request.previewPid);
    }
    killProcessesByPort(request.previewPort);

    // Stop any remaining processes using the worktree (opencode, npm, etc.)
    if (request.worktreePath) {
      killProcessesInWorktree(request.worktreePath);
      removeWorktree(request.worktreePath);
    }

    // Delete branches
    if (request.branch) {
      deleteLocalBranch(request.branch);
      deleteRemoteBranch(request.branch);
    }

    // Delete database record
    deleteFeatureRequest(id);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
