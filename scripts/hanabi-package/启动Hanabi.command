#!/bin/zsh
set -euo pipefail
HANABI_BUNDLE_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
exec "$HANABI_BUNDLE_DIR/runtimes/node/bin/node" "$HANABI_BUNDLE_DIR/launcher.mjs" "$@"
