import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VersionInfo } from '../shared/types.js';
import { isAiEnabled } from './ai/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersionFromFile(): VersionInfo | null {
  const versionPath = join(__dirname, '..', 'version.json');
  if (!existsSync(versionPath)) return null;
  try {
    const data = JSON.parse(readFileSync(versionPath, 'utf-8'));
    if (
      typeof data.mainVersion === 'number' &&
      typeof data.currentVersion === 'number' &&
      typeof data.branch === 'string' &&
      typeof data.ahead === 'number' &&
      typeof data.behind === 'number'
    ) {
      return {
        ...data,
        aiEnabled: typeof data.aiEnabled === 'boolean' ? data.aiEnabled : isAiEnabled(),
      } as VersionInfo;
    }
  } catch {
    // ignore
  }
  return null;
}

function getPreviewInfo(): { previewFeatureRequestId: number | null; mainServerUrl: string | null } {
  const previewFeatureRequestId = process.env.PREVIEW_FEATURE_REQUEST_ID
    ? parseInt(process.env.PREVIEW_FEATURE_REQUEST_ID, 10)
    : null;
  const mainServerUrl = process.env.MAIN_SERVER_URL || null;
  return {
    previewFeatureRequestId: previewFeatureRequestId && !isNaN(previewFeatureRequestId) ? previewFeatureRequestId : null,
    mainServerUrl,
  };
}

function runGit(args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function getCurrentVersion(): number {
  const out = runGit('rev-list --count HEAD');
  return out ? parseInt(out, 10) : 0;
}

function getMainVersion(): number {
  const out = runGit('rev-list --count origin/main') ?? runGit('rev-list --count main');
  return out ? parseInt(out, 10) : 0;
}

function getAhead(): number {
  const out = runGit('rev-list --count origin/main..HEAD') ?? runGit('rev-list --count main..HEAD');
  return out ? parseInt(out, 10) : 0;
}

function getBehind(): number {
  const out = runGit('rev-list --count HEAD..origin/main') ?? runGit('rev-list --count HEAD..main');
  return out ? parseInt(out, 10) : 0;
}

function getBranch(): string {
  return runGit('rev-parse --abbrev-ref HEAD') || 'unknown';
}

export function getVersion(): VersionInfo {
  const mainVersion = getMainVersion();
  const currentVersion = getCurrentVersion();
  const ahead = getAhead();
  const behind = getBehind();
  const branch = getBranch();
  const previewInfo = getPreviewInfo();

  if (mainVersion || currentVersion) {
    return {
      mainVersion: mainVersion || currentVersion,
      currentVersion,
      branch,
      ahead,
      behind,
      aiEnabled: isAiEnabled(),
      previewFeatureRequestId: previewInfo.previewFeatureRequestId,
      mainServerUrl: previewInfo.mainServerUrl,
    };
  }

  return readVersionFromFile() ?? {
    mainVersion: 0,
    currentVersion: 0,
    branch: 'unknown',
    ahead: 0,
    behind: 0,
    aiEnabled: false,
    previewFeatureRequestId: previewInfo.previewFeatureRequestId,
    mainServerUrl: previewInfo.mainServerUrl,
  };
}
