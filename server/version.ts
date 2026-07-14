import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersionFromFile(): number | null {
  const versionPath = join(__dirname, '..', 'version.json');
  if (!existsSync(versionPath)) return null;
  try {
    const data = JSON.parse(readFileSync(versionPath, 'utf-8'));
    return typeof data.version === 'number' ? data.version : null;
  } catch {
    return null;
  }
}

function readVersionFromGit(): number | null {
  try {
    const count = execSync('git rev-list --count main', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 5000,
    });
    return parseInt(count.trim(), 10);
  } catch {
    return null;
  }
}

function getVersion(): number {
  return readVersionFromGit() ?? readVersionFromFile() ?? 0;
}

export const version = getVersion();
