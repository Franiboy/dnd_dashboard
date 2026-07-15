import { spawn, execSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findFreePort, isPortInUse } from '../utils/port.js';
import { runOpenCode, findOpenCodeSessionId } from './opencode.js';
import { notifyFeatureRequestsUpdated } from './events.js';
import type { LogType } from '../../shared/types.js';
import {
  updateFeatureRequest as updateFeatureRequestRaw,
  appendFeatureRequestLogEntry,
  getFeatureRequestById,
  listFeatureRequests,
  deleteFeatureRequest,
} from '../repositories/featureRequests.js';

function updateFeatureRequest(id: number, updates: Parameters<typeof updateFeatureRequestRaw>[1]) {
  const result = updateFeatureRequestRaw(id, updates);
  notifyFeatureRequestsUpdated();
  return result;
}

const PREVIEW_PORT_BASE = 4000;
const WORKTREE_PREFIX = 'dnd_dashboard-preview-';

function buildPreviewUrl(protocol: string, hostname: string, port: number): string {
  return `${protocol}://${hostname}:${port}`;
}

function parsePreviewUrl(url: string | null): { protocol: string; hostname: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return { protocol: parsed.protocol.replace(':', ''), hostname: parsed.hostname };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startPreviewServer(
  id: number,
  worktreePath: string,
  previewProtocol: string,
  previewHostname: string,
  mainServerUrl?: string,
): Promise<{ previewPort: number; previewUrl: string; previewPid: number } | null> {
  const previewPort = await findFreePort(PREVIEW_PORT_BASE);
  const previewDbPath = `dnd_preview_${id}.db`;
  const mainDbPath = process.env.DB_PATH || 'dnd.db';
  const previewDbFullPath = join(worktreePath, previewDbPath);
  if (existsSync(mainDbPath)) {
    copyFileSync(mainDbPath, previewDbFullPath);
  }
  const resolvedMainServerUrl =
    mainServerUrl ||
    process.env.MAIN_SERVER_URL ||
    buildPreviewUrl(previewProtocol, previewHostname, Number(process.env.PORT || 3001));
  const previewEnv = {
    ...process.env,
    PORT: String(previewPort),
    NODE_ENV: 'production',
    DB_PATH: previewDbPath,
    PREVIEW_MODE: 'true',
    PREVIEW_FEATURE_REQUEST_ID: String(id),
    MAIN_SERVER_URL: resolvedMainServerUrl,
  };
  const previewProcess = spawn('npm', ['start'], {
    cwd: worktreePath,
    stdio: 'pipe',
    env: previewEnv,
    detached: true,
  });

  previewProcess.stdout?.on('data', (data) => logLine(id, `[preview] ${data}`, 'system'));
  previewProcess.stderr?.on('data', (data) => logLine(id, `[preview] ${data}`, 'error'));
  previewProcess.on('error', (err) => {
    logLine(id, `Preview server error: ${err.message}\n`);
    updateFeatureRequest(id, { status: 'failed' });
  });

  const previewPid = previewProcess.pid;
  if (!previewPid) {
    logLine(id, 'Preview server failed to spawn\n');
    return null;
  }

  const previewUrl = buildPreviewUrl(previewProtocol, previewHostname, previewPort);
  logLine(id, `Preview server started on ${previewUrl} (PID ${previewPid})\n`);

  updateFeatureRequest(id, {
    status: 'preview_ready',
    previewPort,
    previewUrl,
    previewPid,
  });

  return { previewPort, previewUrl, previewPid };
}

function buildPrompt(title: string, description: string, branch: string): string {
  return [
    `Implement the following feature in this Node.js + React + SQLite web app:`,
    `Title: ${title}`,
    `Description: ${description}`,
    ``,
    `Rules:`,
    `- Use the already existing and checked-out branch "${branch}".`,
    `- Make the minimal changes needed to implement the feature.`,
    `- Follow the existing code style and architecture (React functional components, Express routes, better-sqlite3 for DB).`,
    `- Do not start any server or interactive process.`,
    `- Do not commit or push; only make code changes.`,
    `- If you need to add a dependency, use npm install --save <package>.`,
    `- Run "npm run build" to verify the build passes before finishing.`,
  ].join('\n');
}

function sanitizeBranchName(raw: string, fallbackId: number): string {
  // Try to extract a feature/<slug> branch name from the raw output.
  const match = raw.match(/feature\/[a-z0-9-]+/i);
  let slug = match ? match[0] : raw;

  // If the AI returned only a slug without prefix, add it.
  if (!slug.startsWith('feature/')) {
    const cleaned = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    slug = cleaned ? `feature/${cleaned}` : `feature/${fallbackId}`;
  }

  // Ensure valid git branch characters and reasonable length.
  slug = slug
    .replace(/[^a-z0-9\/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length > 60 || !slug.startsWith('feature/')) {
    slug = `feature/${fallbackId}`;
  }

  return slug;
}

async function suggestBranchName(
  id: number,
  title: string,
  description: string,
  worktreePath: string,
  model: string,
): Promise<string> {
  const prompt = [
    `Analyze the following feature request and suggest a short, descriptive git branch name in kebab-case.`,
    `The branch name MUST start with "feature/" and must NOT contain "ai".`,
    ``,
    `Title: ${title}`,
    `Description: ${description}`,
    ``,
    `You may briefly look at the codebase to pick a fitting name, but do NOT modify any files and do NOT run any commands.`,
    `Output exactly one line in this format:`,
    `BRANCH: feature/<short-kebab-description>`,
  ].join('\n');

  const result = await runOpenCode({
    prompt,
    worktreePath,
    model,
    title: `dnd-analyze-${id}`,
  });

  if (result.success) {
    const branchMatch = result.output.match(/BRANCH:\s*(.+)/);
    if (branchMatch) {
      return sanitizeBranchName(branchMatch[1].trim(), id);
    }
  }

  return `feature/${id}`;
}

function logLine(id: number, line: string, type: LogType = 'system'): void {
  appendFeatureRequestLogEntry(id, { type, text: line, timestamp: new Date().toISOString() });
  notifyFeatureRequestsUpdated();
}

function captureDiff(id: number, worktreePath: string): void {
  try {
    const diff = execSync('git diff --cached --no-color', { cwd: worktreePath, encoding: 'utf-8', timeout: 10000 });
    if (diff.trim()) {
      logLine(id, `Staged changes:\n${diff}`, 'diff');
    }
  } catch {
    // ignore diff failures
  }
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

function gitOutput(args: string, options: { cwd: string; timeout?: number }): string | null {
  try {
    return execSync(`git ${args}`, { cwd: options.cwd, encoding: 'utf-8', timeout: options.timeout ?? 30000 }).trim();
  } catch {
    return null;
  }
}

export function getFeatureRequestBehind(worktreePath: string | null, branch: string | null): number {
  if (!worktreePath || !existsSync(worktreePath) || !branch || branch === 'main' || branch === 'unknown') {
    return 0;
  }
  try {
    execSync('git fetch origin', { cwd: worktreePath, encoding: 'utf-8', timeout: 30000 });
  } catch {
    // ignore fetch errors
  }
  const output = gitOutput('rev-list --count HEAD..origin/main', { cwd: worktreePath })
    ?? gitOutput('rev-list --count HEAD..main', { cwd: worktreePath });
  if (!output) return 0;
  const count = parseInt(output, 10);
  return isNaN(count) ? 0 : count;
}

export function startFeatureRequestBehindWatcher(intervalMs = 10000): () => void {
  let lastBehind = new Map<number, number>();

  function tick() {
    let changed = false;
    for (const request of listFeatureRequests()) {
      if (request.status !== 'preview_ready' || !request.worktreePath) continue;
      const behind = getFeatureRequestBehind(request.worktreePath, request.branch);
      if (lastBehind.get(request.id) !== behind) {
        lastBehind.set(request.id, behind);
        changed = true;
      }
    }
    if (changed) {
      notifyFeatureRequestsUpdated();
    }
  }

  tick();
  const interval = setInterval(tick, intervalMs);
  return () => clearInterval(interval);
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
  mainServerUrl?: string,
): void {
  const request = getFeatureRequestById(id);
  if (!request) return;

  const model = process.env.AI_MODEL || 'dotsource_rag/code-secure-local';
  let branch = `feature/${id}`;
  const sessionTitle = `dnd-feature-request-${id}`;
  let worktreePath = resolve(join(process.cwd(), '..', `${WORKTREE_PREFIX}${id}`));
  worktreePath = createUniquePath(worktreePath);

  const now = new Date().toISOString();
  updateFeatureRequest(id, {
    status: 'running',
    branch,
    worktreePath,
    sessionTitle,
    logs: [{ type: 'system', text: `Starting AI feature request #${id}...\nModel: ${model}\nSession title: ${sessionTitle}\n`, timestamp: now }],
  });

  (async () => {
    try {
      execGit('worktree prune', { cwd: process.cwd() });

      execGit(`worktree add -f -B ${branch} ${worktreePath} main`, { cwd: process.cwd() });

      logLine(id, `Analyzing feature request for a descriptive branch name...\n`);
      const suggestedBranch = await suggestBranchName(id, request.title, request.description, worktreePath, model);
      if (suggestedBranch !== branch) {
        logLine(id, `AI suggests branch name: ${suggestedBranch}\n`);
        try {
          // Remove any files the analysis run may have created.
          execGit('reset --hard HEAD', { cwd: worktreePath });
          execGit('clean -fd', { cwd: worktreePath });
          execGit(`branch -m ${branch} ${suggestedBranch}`, { cwd: process.cwd() });
          const slug = suggestedBranch.replace('feature/', '');
          const newWorktreePath = createUniquePath(resolve(join(process.cwd(), '..', `${WORKTREE_PREFIX}${slug}`)));
          execGit(`worktree move "${worktreePath}" "${newWorktreePath}"`, { cwd: process.cwd() });
          branch = suggestedBranch;
          worktreePath = newWorktreePath;
          updateFeatureRequest(id, { branch, worktreePath });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logLine(id, `Branch rename failed, keeping ${branch}: ${message}\n`, 'error');
        }
      }

      logLine(id, `Created worktree ${worktreePath} on branch ${branch}\n`);

      const mainEnv = join(process.cwd(), '.env');
      const worktreeEnv = join(worktreePath, '.env');
      if (existsSync(mainEnv)) {
        copyFileSync(mainEnv, worktreeEnv);
      }

      logLine(id, `Installing dependencies in worktree...\n`);
      const installResult = await runCommand('npm', ['install'], {
        cwd: worktreePath,
        onLog: (line) => logLine(id, line, 'build'),
      });
      if (!installResult.success) {
        logLine(id, `npm install failed with exit code ${installResult.exitCode}\n`, 'error');
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Running OpenCode with model ${model}...\n`);
      const prompt = buildPrompt(request.title, request.description, branch);
      logLine(id, `Prompt:\n${prompt}\n`, 'prompt');
      const openCodeResult = await runOpenCode({
        prompt,
        worktreePath,
        model,
        title: sessionTitle,
        onLog: (line) => logLine(id, line, 'ai'),
      });

      const sessionId = await findOpenCodeSessionId(worktreePath, sessionTitle);
      if (sessionId) {
        logLine(id, `OpenCode session cached: ${sessionId}\n`);
        updateFeatureRequest(id, { sessionId });
      }

      if (!openCodeResult.success) {
        logLine(id, `OpenCode failed with exit code ${openCodeResult.exitCode}\n`, 'error');
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `OpenCode finished. Building preview...\n`);

      const buildResult = await runCommand('npm', ['run', 'build'], {
        cwd: worktreePath,
        onLog: (line) => logLine(id, line, 'build'),
      });

      if (!buildResult.success) {
        logLine(id, `Build failed with exit code ${buildResult.exitCode}\n`, 'error');
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Committing changes in worktree...\n`);
      try {
        execGit('add -A', { cwd: worktreePath });
        captureDiff(id, worktreePath);
        try {
          execSync('git diff --cached --quiet', { cwd: worktreePath, encoding: 'utf-8' });
          // no staged changes
        } catch {
          execGit('commit -m "AI feature request implementation"', { cwd: worktreePath });
        }
      } catch {
        // add failed or commit failed
      }

      await startPreviewServer(id, worktreePath, previewProtocol, previewHostname, mainServerUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(id, `Worker error: ${message}\n`);
      updateFeatureRequest(id, { status: 'failed' });
    }
  })();
}

export async function recoverPreviewServers(): Promise<void> {
  const requests = listFeatureRequests().filter((r) => r.status === 'preview_ready');
  if (requests.length === 0) return;

  console.log(`Recovering ${requests.length} preview_ready feature request(s)...`);

  for (const request of requests) {
    const id = request.id;
    const worktreePath = request.worktreePath;

    if (!worktreePath || !existsSync(worktreePath)) {
      logLine(id, `Startup recovery: worktree missing at ${worktreePath}\n`);
      updateFeatureRequest(id, { status: 'failed' });
      continue;
    }

    const parsed = parsePreviewUrl(request.previewUrl);
    const previewProtocol = parsed?.protocol || 'http';
    const previewHostname = parsed?.hostname || 'localhost';

    const processAlive = isProcessAlive(request.previewPid);
    const portInUse = request.previewPort ? await isPortInUse(request.previewPort) : false;

    if (processAlive && portInUse) {
      logLine(id, `Startup recovery: preview server still running at ${request.previewUrl}\n`);
      continue;
    }

    logLine(id, `Startup recovery: restarting preview server for worktree ${worktreePath}\n`);
    await startPreviewServer(id, worktreePath, previewProtocol, previewHostname);
  }
}

export function continueFeatureRequest(
  id: number,
  prompt: string,
  previewProtocol: string,
  previewHostname: string,
  mainServerUrl?: string,
): void {
  const request = getFeatureRequestById(id);
  if (!request) return;

  const model = process.env.AI_MODEL || 'dotsource_rag/code-secure-local';
  const worktreePath = request.worktreePath;
  const sessionTitle = request.sessionTitle || `dnd-feature-request-${id}`;
  if (!worktreePath) return;

  const continueNow = new Date().toISOString();
  updateFeatureRequest(id, {
    status: 'running',
    sessionTitle,
    logs: [...(request.logs || []), { type: 'system', text: `Continuing AI session for feature request #${id}...\n`, timestamp: continueNow }],
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
      logLine(id, `Prompt:\n${prompt}\n`, 'prompt');
      const openCodeResult = await runOpenCode({
        prompt,
        worktreePath,
        model,
        sessionId,
        onLog: (line) => logLine(id, line, 'ai'),
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
        onLog: (line) => logLine(id, line, 'build'),
      });

      if (!buildResult.success) {
        logLine(id, `Build failed with exit code ${buildResult.exitCode}\n`, 'error');
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Committing changes in worktree...\n`);
      try {
        execGit('add -A', { cwd: worktreePath });
        captureDiff(id, worktreePath);
        try {
          execSync('git diff --cached --quiet', { cwd: worktreePath, encoding: 'utf-8' });
          // no staged changes
        } catch {
          execGit('commit -m "AI feature request continuation"', { cwd: worktreePath });
        }
      } catch {
        // add failed or commit failed
      }

      await startPreviewServer(id, worktreePath, previewProtocol, previewHostname, mainServerUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(id, `Worker continue error: ${message}\n`);
      updateFeatureRequest(id, { status: 'failed' });
    }
  })();
}

function hasUnmergedPaths(worktreePath: string): boolean {
  try {
    const output = execSync('git ls-files --unmerged', {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

async function runMergeWithOpenCode(
  worktreePath: string,
  branch: string,
  model: string,
  onLog?: (line: string) => void,
): Promise<{ success: boolean; output: string }> {
  const prompt = [
    `The branch "${branch}" has merge conflicts with origin/main.`,
    `Resolve all merge conflicts by choosing the best version of each conflict.`,
    `Preserve the feature changes of "${branch}" while incorporating updates from main.`,
    `Do not commit or push.`,
    `After resolving, run "npm run build" to verify the build passes.`,
    `Then stage all changes with "git add -A".`,
  ].join('\n');

  onLog?.(`Starting OpenCode to resolve merge conflicts...\n`);
  const result = await runOpenCode({
    prompt,
    worktreePath,
    model,
    title: `dnd-merge-${branch}`,
    onLog,
  });

  if (!result.success) {
    return { success: false, output: result.output };
  }

  if (hasUnmergedPaths(worktreePath)) {
    return { success: false, output: 'Merge conflicts remain after OpenCode run.' };
  }

  return { success: true, output: result.output };
}

export async function mergeMainIntoFeatureBranch(
  worktreePath: string,
  branch: string,
  model: string,
  onLog?: (line: string) => void,
): Promise<{ success: boolean; error?: string }> {
  try {
    onLog?.(`Fetching origin...\n`);
    const fetchResult = await runCommand('git', ['fetch', 'origin'], { cwd: worktreePath, onLog });
    if (!fetchResult.success) {
      return { success: false, error: `git fetch failed: ${fetchResult.output}` };
    }

    onLog?.(`Merging origin/main into ${branch} (dry-run)...\n`);
    const dryRun = await runCommand('git', ['merge', 'origin/main', '--no-commit', '--no-ff'], {
      cwd: worktreePath,
      onLog,
    });

    if (dryRun.success && !hasUnmergedPaths(worktreePath)) {
      onLog?.(`Merge is clean. Committing and pushing...\n`);
      execGit('commit -m "Merge main into ' + branch + '"', { cwd: worktreePath });
      const pushResult = await runCommand('git', ['push', 'origin', branch], {
        cwd: worktreePath,
        onLog,
      });
      if (!pushResult.success) {
        return { success: false, error: `Push failed: ${pushResult.output}` };
      }
      onLog?.(`Merge pushed to origin/${branch}\n`);
      return { success: true };
    }

    if (hasUnmergedPaths(worktreePath)) {
      onLog?.(`Merge conflicts detected. Attempting OpenCode resolution...\n`);
      const openCodeResult = await runMergeWithOpenCode(worktreePath, branch, model, onLog);

      if (!openCodeResult.success) {
        // Abort the in-progress merge so the worktree is not left in conflict state
        try {
          execGit('merge --abort', { cwd: worktreePath });
        } catch {
          // ignore
        }
        return { success: false, error: `OpenCode merge resolution failed: ${openCodeResult.output}` };
      }

      onLog?.(`Conflicts resolved. Building and committing...\n`);
      const buildResult = await runCommand('npm', ['run', 'build'], { cwd: worktreePath, onLog });
      if (!buildResult.success) {
        try {
          execGit('merge --abort', { cwd: worktreePath });
        } catch {
          // ignore
        }
        return { success: false, error: `Build failed after merge resolution: ${buildResult.output}` };
      }

      execGit('add -A', { cwd: worktreePath });
      execGit('commit -m "Merge main into ' + branch + ' (AI conflict resolution)"', { cwd: worktreePath });
      const pushResult = await runCommand('git', ['push', 'origin', branch], {
        cwd: worktreePath,
        onLog,
      });
      if (!pushResult.success) {
        return { success: false, error: `Push failed: ${pushResult.output}` };
      }
      onLog?.(`Merge pushed to origin/${branch}\n`);
      return { success: true };
    }

    return { success: false, error: `Merge dry-run failed: ${dryRun.output}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export function mergeFromMainForFeatureRequest(
  id: number,
  previewProtocol: string,
  previewHostname: string,
  mainServerUrl?: string,
): void {
  const request = getFeatureRequestById(id);
  if (!request) return;
  if (request.status !== 'preview_ready') return;
  if (!request.worktreePath || !request.branch) return;

  const model = process.env.AI_MODEL || 'dotsource_rag/code-secure-local';

  const mergeNow = new Date().toISOString();
  updateFeatureRequest(id, {
    status: 'running',
    logs: [...(request.logs || []), { type: 'system', text: `Merging main into ${request.branch}...\n`, timestamp: mergeNow }],
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

      const mergeResult = await mergeMainIntoFeatureBranch(
        request.worktreePath!,
        request.branch!,
        model,
        (line) => logLine(id, line),
      );

      if (!mergeResult.success) {
        logLine(id, `Merge from main failed: ${mergeResult.error}\n`);
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      logLine(id, `Merge successful. Rebuilding preview...\n`);

      const buildResult = await runCommand('npm', ['run', 'build'], {
        cwd: request.worktreePath!,
        onLog: (line) => logLine(id, line, 'build'),
      });

      if (!buildResult.success) {
        logLine(id, `Rebuild failed with exit code ${buildResult.exitCode}\n`, 'error');
        updateFeatureRequest(id, { status: 'failed' });
        return;
      }

      await startPreviewServer(id, request.worktreePath!, previewProtocol, previewHostname, mainServerUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(id, `Merge from main error: ${message}\n`);
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

    // Pull the just-pushed merge commit into the local main worktree
    try {
      execGit('pull origin main --ff-only', { cwd: process.cwd(), timeout: 60000 });
    } catch {
      // If the local main worktree has uncommitted changes, the ff-only pull may fail.
      // The remote main already has the merge, so we do not fail the whole operation.
    }

    const cleanup = cleanupFeatureRequest(id);
    if (cleanup.success) {
      notifyFeatureRequestsUpdated();
    }
    return cleanup;
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
    const exists = gitOutput(`branch --list ${branch}`, { cwd: process.cwd() });
    if (!exists) return;
    execGit(`branch -D ${branch}`, { cwd: process.cwd() });
  } catch {
    // ignore if branch does not exist or cannot be deleted
  }
}

function deleteRemoteBranch(branch: string) {
  try {
    const remoteRef = gitOutput(`ls-remote --heads origin refs/heads/${branch}`, { cwd: process.cwd() });
    if (!remoteRef || remoteRef.trim().length === 0) return;
    execGit(`push origin --delete ${branch}`, { cwd: process.cwd(), timeout: 60000 });
  } catch {
    // ignore if remote branch does not exist or cannot be deleted
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
