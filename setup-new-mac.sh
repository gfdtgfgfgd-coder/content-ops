#!/bin/zsh
# content-ops / Hanabi 本地安装脚本
# 依赖系统 Node.js 22+、Python 3.9+；不再携带独立运行时。

set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

version_at_least() {
  local actual="$1" required="$2"
  [[ "$(printf '%s\n%s\n' "$required" "$actual" | sort -V | head -n1)" == "$required" ]]
}

node_version="$(node --version 2>/dev/null | sed 's/^v//' || true)"
if [[ -z "$node_version" ]] || ! version_at_least "$node_version" "22.13.0"; then
  echo "✗ 需要 Node.js >= 22.13（当前：${node_version:-未安装}）。请先安装系统 Node.js。" >&2
  exit 1
fi

python_version="$(python3 --version 2>/dev/null | awk '{print $2}' || true)"
if [[ -z "$python_version" ]] || ! version_at_least "$python_version" "3.9.0"; then
  echo "✗ 需要 Python >= 3.9（当前：${python_version:-未安装}）。请先安装系统 Python。" >&2
  exit 1
fi

echo "✓ Node.js $node_version"
echo "✓ Python $python_version"

if [[ ! -f "scratch/gateway.env" ]]; then
  mkdir -p scratch
  template=""
  for candidate in config/gateway.env.example scratch/gateway.env.example; do
    if [[ -f "$candidate" ]]; then template="$candidate"; break; fi
  done
  if [[ -n "$template" ]]; then
    cp "$template" scratch/gateway.env
    chmod 600 scratch/gateway.env
    echo "→ 已创建 scratch/gateway.env，请填入 CONTENT_OPS_API_KEY。"
  else
    echo "⚠ 未找到 config/gateway.env.example，请手动创建 scratch/gateway.env。"
  fi
fi

echo "→ 安装 Hanabi 依赖..."
(cd hanabi && npm install --omit=optional)

echo "→ 启动 Hanabi..."
nohup npm --prefix hanabi start >"scratch/hanabi.log" 2>"scratch/hanabi-error.log" &
server_pid=$!
for i in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:6187/healthz" >/dev/null 2>&1; then
    echo "✓ Hanabi 服务已就绪：http://127.0.0.1:6187（PID $server_pid）"
    open "http://127.0.0.1:6187" 2>/dev/null || true
    exit 0
  fi
  sleep 1
done

echo "✗ 服务启动超时，请查看 scratch/hanabi-error.log" >&2
exit 1
