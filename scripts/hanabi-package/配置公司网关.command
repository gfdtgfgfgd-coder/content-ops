#!/bin/zsh
set -euo pipefail
HANABI_BUNDLE_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
exec "$HANABI_BUNDLE_DIR/runtimes/python/bin/python3" "$HANABI_BUNDLE_DIR/configure-gateway.py"
