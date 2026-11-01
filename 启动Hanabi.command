#!/bin/zsh
set -euo pipefail
HANABI_REPO_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
HANABI_START="$HANABI_REPO_DIR/releases/Hanabi-2026-11-01-mac-arm64/启动Hanabi.command"
if [[ ! -x "$HANABI_START" ]]; then
  print -u2 '请先将完整 Hanabi ZIP 解压到 content-ops/releases/；仅 git pull 不包含运行包。'
  exit 1
fi
exec "$HANABI_START" "$@"
