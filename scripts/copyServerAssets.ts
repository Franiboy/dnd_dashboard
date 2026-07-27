import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const files = ['server/discord/transcribe.py'];

for (const file of files) {
  const src = join(process.cwd(), file);
  const dest = join(process.cwd(), 'dist-server', file);

  if (!existsSync(src)) {
    console.warn(`Source file not found, skipping: ${src}`);
    continue;
  }

  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`Copied ${src} -> ${dest}`);
}
