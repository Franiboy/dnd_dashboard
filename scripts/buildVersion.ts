import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVersion } from '../server/version.ts';

const info = getVersion();
const distDir = 'dist-server';
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'version.json'), JSON.stringify(info));
const aheadSuffix = info.ahead ? `+${info.ahead}` : '';
const behindSuffix = info.behind ? `-${info.behind}` : '';
console.log(`Build version: ${info.mainVersion} (${info.branch}${aheadSuffix}${behindSuffix})`);
