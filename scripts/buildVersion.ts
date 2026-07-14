import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function getVersion(): number {
  try {
    const count = execSync('git rev-list --count main', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return parseInt(count.trim(), 10);
  } catch {
    return 0;
  }
}

const version = getVersion();
const distDir = 'dist-server';
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'version.json'), JSON.stringify({ version }));
console.log(`Build version: ${version}`);
