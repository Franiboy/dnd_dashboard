#!/usr/bin/env node
/**
 * Merge the ProjectAtlas-generated OpenCode MCP configuration
 * (.projectatlas/projectatlas.opencode.json) into the local, git-ignored
 * opencode.json.
 *
 * Idempotent: preserves all existing entries and only adds/replaces the
 * `mcp.projectatlas` entry. `opencode.json` is per-developer and gitignored,
 * so this merge is safe to run on every `npm run setup:atlas`.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS_OPENCODE_CONFIG = join(REPO_ROOT, '.projectatlas', 'projectatlas.opencode.json');
const OPENCODE_CONFIG = join(REPO_ROOT, 'opencode.json');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!existsSync(ATLAS_OPENCODE_CONFIG)) {
  fail(
    `${ATLAS_OPENCODE_CONFIG} not found. Run \`projectatlas init\` first ` +
      '(handled by `npm run setup:atlas`).'
  );
}

let atlasConfig;
try {
  atlasConfig = JSON.parse(readFileSync(ATLAS_OPENCODE_CONFIG, 'utf8'));
} catch (err) {
  fail(`Could not parse ${ATLAS_OPENCODE_CONFIG}: ${err.message}`);
}

const atlasEntry = atlasConfig?.mcp?.projectatlas;
if (!atlasEntry || typeof atlasEntry !== 'object') {
  fail(
    `${ATLAS_OPENCODE_CONFIG} does not contain a \`mcp.projectatlas\` entry. ` +
      'Unexpected ProjectAtlas config layout; merge manually.'
  );
}

let opencodeConfig = {};
if (existsSync(OPENCODE_CONFIG)) {
  try {
    opencodeConfig = JSON.parse(readFileSync(OPENCODE_CONFIG, 'utf8'));
  } catch (err) {
    fail(`Could not parse ${OPENCODE_CONFIG}: ${err.message}`);
  }
}

opencodeConfig.mcp ??= {};
opencodeConfig.mcp.projectatlas = atlasEntry;

const tmpPath = `${OPENCODE_CONFIG}.tmp`;
writeFileSync(tmpPath, `${JSON.stringify(opencodeConfig, null, 2)}\n`);
renameSync(tmpPath, OPENCODE_CONFIG);

const command = Array.isArray(atlasEntry.command) ? atlasEntry.command.join(' ') : '(n/a)';
console.log(
  `Merged ProjectAtlas MCP entry into ${OPENCODE_CONFIG}:\n` +
    `  mcp.projectatlas.command = ${command}`
);
