#!/usr/bin/env bash
# Fail closed unless the packaged release can load its native modules on the
# production target.
#
# Native addons are downloaded or compiled for the libc of the machine that ran
# `npm ci`. The release is deployed to Ubuntu 24.04 (glibc 2.39) with the Node
# version from `.nvmrc`, so the archive must contain exactly the prebuilt binary
# for that target, and the set of native packages must not have grown silently.
#
# Usage: verify-release-native.sh <release-archive> <target-glibc>
set -Eeuo pipefail
umask 077

ARCHIVE="${1:?Usage: verify-release-native.sh <release-archive> <target-glibc>}"
TARGET_GLIBC="${2:?target glibc version is required, for example 2.39}"

# Packages that ship a compiled binary and therefore constrain the release
# target. Adding a native dependency requires adding it here as well; the
# release fails closed otherwise.
EXPECTED_NATIVE_PACKAGES=(
  '@discordjs/opus'
  '@snazzah/davey-linux-x64-gnu'
  'bcrypt'
  'better-sqlite3'
)

log() {
  printf '[verify-release-native] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dnd-native-verify.XXXXXX")"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

[ -f "$ARCHIVE" ] || die "release archive is missing: $ARCHIVE"
[[ "$TARGET_GLIBC" =~ ^[0-9]+\.[0-9]+$ ]] || die "invalid target glibc: $TARGET_GLIBC"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_abi="$(node -p 'process.versions.modules')"
log "target glibc=$TARGET_GLIBC node=v$node_major abi=$node_abi"

tar -xzf "$ARCHIVE" -C "$work_dir" --no-same-owner --no-same-permissions

# Discover every package that ships a compiled binary. Scoped packages keep
# their scope, unscoped packages are only their first path segment.
mapfile -t found_packages < <(
  find "$work_dir/node_modules" -name '*.node' -type f -printf '%P\n' 2>/dev/null |
    awk -F/ '{ if ($1 ~ /^@/) print $1 "/" $2; else print $1 }' | sort -u
)

mapfile -t expected_sorted < <(printf '%s\n' "${EXPECTED_NATIVE_PACKAGES[@]}" | sort)
if [ "${found_packages[*]}" != "${expected_sorted[*]}" ]; then
  log 'expected native packages:'
  printf '  %s\n' "${expected_sorted[@]}" >&2
  log 'found native packages:'
  printf '  %s\n' "${found_packages[@]}" >&2
  die 'the set of native packages changed; update EXPECTED_NATIVE_PACKAGES and the target review'
fi

# The prebuilt native addon that broke production carries the libc version in
# its path, so it is checked explicitly instead of relying on a generic loader.
opus_prebuild="node_modules/@discordjs/opus/prebuild/node-v${node_abi}-napi-v3-linux-x64-glibc-${TARGET_GLIBC}/opus.node"
[ -f "$work_dir/$opus_prebuild" ] ||
  die "release does not contain the production native addon: $opus_prebuild (found: $(find "$work_dir/node_modules/@discordjs/opus/prebuild" -name opus.node -printf '%P' 2>/dev/null | tr '\n' ' '))"

# Load every native module with the release Node to prove it resolves here.
for package in "${EXPECTED_NATIVE_PACKAGES[@]}"; do
  node -e "require(process.argv[1])" "$work_dir/node_modules/$package" >/dev/null 2>&1 ||
    die "native module does not load on the release target: $package"
done

log "all native modules match the production target and load successfully"
