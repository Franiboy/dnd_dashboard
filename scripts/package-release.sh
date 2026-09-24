#!/usr/bin/env bash
# Package the already-built application as an immutable deployment artifact.
set -euo pipefail

OUTPUT="${1:?Usage: package-release.sh <output.tar.gz>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/dnd-release.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT

cd "$ROOT"
RELEASE_SHA="${DND_RELEASE_SHA:-$(git rev-parse HEAD)}"
HEAD_SHA="$(git rev-parse HEAD)"
[ "$RELEASE_SHA" = "$HEAD_SHA" ] || {
  printf 'Release SHA does not match checkout HEAD\n' >&2
  exit 1
}
LOCK_SHA="$(sha256sum package-lock.json | cut -d' ' -f1)"
NODE_VERSION="$(node -v)"
COMMIT_TIME="$(git show -s --format=%cI "$RELEASE_SHA")"

# Keep the production artifact self-contained. Native modules have already been
# installed and tested by npm ci; pruning only removes development packages.
npm prune --omit=dev

mkdir -p "$STAGING"
cp -a dist "$STAGING/dist"
cp -a dist-server "$STAGING/dist-server"
cp -a node_modules "$STAGING/node_modules"
cp package.json package-lock.json "$STAGING/"
printf '%s\n' "$RELEASE_SHA" > "$STAGING/.release-sha"

node - "$STAGING/manifest.json" "$RELEASE_SHA" "$LOCK_SHA" "$NODE_VERSION" "$COMMIT_TIME" <<'NODE'
import { writeFileSync } from 'node:fs';
const [output, commit, lockfileSha256, nodeVersion, commitTime] = process.argv.slice(2);
writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      commit,
      lockfileSha256,
      nodeVersion,
      commitTime,
    },
    null,
    2
  )}\n`
);
NODE

mkdir -p "$(dirname "$OUTPUT")"
tar \
  --sort=name \
  --mtime="$COMMIT_TIME" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -czf "$OUTPUT.tmp" \
  -C "$STAGING" .
mv -f "$OUTPUT.tmp" "$OUTPUT"
(
  cd "$(dirname "$OUTPUT")"
  sha256sum "$(basename "$OUTPUT")" > "$(basename "$OUTPUT").sha256"
)
chmod 0644 "$OUTPUT" "$OUTPUT.sha256"
printf 'Release artifact created: %s\n' "$OUTPUT"
printf 'Release commit: %s\n' "$RELEASE_SHA"
