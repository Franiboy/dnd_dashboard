#!/usr/bin/env bash
#
# Setup ProjectAtlas (https://github.com/styler-ai/ProjectAtlas) as the
# standard local repository-intelligence tool for coding agents.
#
# Part of the standard clone workflow: run `npm install` first, then
#   npm run setup:atlas
#
# Steps (all idempotent):
#   1. Install the pinned native projectatlas runtime if no verified binary is
#      found (uses the official installer from the pinned release tag).
#   2. Run `projectatlas init` – creates/refreshes the local index DB and
#      writes the generated MCP configs into the gitignored `.projectatlas/`.
#   3. Merge the generated OpenCode MCP config into the local, git-ignored
#      `opencode.json` so agents can use the `atlas_*` tools.
#
# The committed project configuration lives in `projectatlas.toml`.
set -euo pipefail

PROJECTATLAS_VERSION="v0.4.4"
export PROJECTATLAS_VERSION
INSTALLER_URL="https://raw.githubusercontent.com/styler-ai/ProjectAtlas/${PROJECTATLAS_VERSION}/plugins/projectatlas/scripts/install-runtime.sh"
RELEASE_URL="https://github.com/styler-ai/ProjectAtlas/releases/tag/${PROJECTATLAS_VERSION}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Resolve the projectatlas binary: PATH first, then the installer's usual
# locations ($HOME/.local/bin, $HOME/.cargo/bin). An absolute path is used for
# every command so a PATH that misses ~/.local/bin cannot break the setup.
resolve_runtime() {
  if command -v projectatlas >/dev/null 2>&1; then
    printf '%s\n' "$(command -v projectatlas)"
    return 0
  fi
  for candidate in "$HOME/.local/bin/projectatlas" "$HOME/.cargo/bin/projectatlas"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

PROJECTATLAS_BIN="$(resolve_runtime || true)"

# --- 1. Runtime -----------------------------------------------------------
if [ -z "$PROJECTATLAS_BIN" ]; then
  echo ">>> projectatlas runtime not found; installing ${PROJECTATLAS_VERSION}..."
  if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required to run the ProjectAtlas installer." >&2
    echo "       Install the native runtime manually from ${RELEASE_URL}" >&2
    exit 1
  fi
  # Download the installer to a temp file first: the official script resolves
  # paths relative to $0, which breaks when run via process substitution.
  INSTALLER_TMP="$(mktemp --suffix=.sh --tmpdir projectatlas-installer-XXXXXX 2>/dev/null || mktemp -t projectatlas-installer.XXXXXX)"
  trap 'rm -f "$INSTALLER_TMP"' EXIT
  curl -fsSL "${INSTALLER_URL}" -o "$INSTALLER_TMP"
  bash "$INSTALLER_TMP"

  PROJECTATLAS_BIN="$(resolve_runtime || true)"
fi

if [ -z "$PROJECTATLAS_BIN" ]; then
  echo "ERROR: projectatlas installed but the binary was not found in PATH," >&2
  echo "       $HOME/.local/bin or $HOME/.cargo/bin. Install manually from ${RELEASE_URL}" >&2
  echo "       or via cargo: cargo install --git https://github.com/styler-ai/ProjectAtlas --tag ${PROJECTATLAS_VERSION} projectatlas-cli --locked" >&2
  exit 1
fi

echo ">>> Verifying projectatlas runtime ($PROJECTATLAS_BIN)..."
if ! "$PROJECTATLAS_BIN" --format json runtime-info >/dev/null 2>&1; then
  echo "ERROR: '$PROJECTATLAS_BIN' is not a usable ProjectAtlas runtime." >&2
  echo "       Install the native runtime from ${RELEASE_URL}." >&2
  exit 1
fi

# --- 2. Index -------------------------------------------------------------
echo ">>> Initializing ProjectAtlas index (idempotent)..."
"$PROJECTATLAS_BIN" init

# --- 3. OpenCode MCP config ----------------------------------------------
echo ">>> Merging ProjectAtlas MCP config into opencode.json..."
node scripts/merge-projectatlas-opencode.mjs

echo ""
echo ">>> ProjectAtlas is ready."
echo "    - Runtime : $PROJECTATLAS_BIN"
echo "    - Config  : projectatlas.toml (committed, shared)"
echo "    - Index   : .projectatlas/projectatlas.db (gitignored, local)"
echo "    - Agent   : 'projectatlas' MCP server merged into opencode.json"
echo ""
echo "    Useful commands:"
echo "      $PROJECTATLAS_BIN token --view tui        # saved-tokens dashboard"
echo "      $PROJECTATLAS_BIN watch --once            # refresh index after edits"
echo "      $PROJECTATLAS_BIN lint --purpose-level low"