import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function gitOutput(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const commit = process.env.DND_RELEASE_SHA || gitOutput(['rev-parse', 'HEAD']);
const commitCount = Number(gitOutput(['rev-list', '--count', 'HEAD']));
const builtAt = process.env.DND_BUILD_TIME || new Date().toISOString();
const info = { commit, commitCount, builtAt };
const distDir = 'dist-server';

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'version.json'), `${JSON.stringify(info)}\n`);
console.log('Build version written:', JSON.stringify(info));
