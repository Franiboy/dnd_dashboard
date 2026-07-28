import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVersion } from '../server/version.ts';

const info = getVersion();
const distDir = 'dist-server';
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'version.json'), JSON.stringify(info));
console.log('Build version written:', JSON.stringify(info));
