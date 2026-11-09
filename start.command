#!/bin/zsh
# content-ops / Hanabi 一键启动与初始化脚本
# 支持在 macOS 访达中双击运行，或在终端执行：zsh start.command

set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "  content-ops / Hanabi 一键启动"
echo "========================================"

version_at_least() {
  local actual="$1" required="$2"
  [[ "$(printf '%s\n%s\n' "$required" "$actual" | sort -V | head -n1)" == "$required" ]]
}

# 1. 检查 Node.js
node_version="$(node --version 2>/dev/null | sed 's/^v//' || true)"
if [[ -z "$node_version" ]] || ! version_at_least "$node_version" "22.13.0"; then
  echo "✗ 需要 Node.js >= 22.13（当前：${node_version:-未安装}）。请先安装 Node.js。" >&2
  read -k 1 -s "?按任意键退出..."
  echo ""
  exit 1
fi

# 2. 检查 Python
python_version="$(python3 --version 2>/dev/null | awk '{print $2}' || true)"
if [[ -z "$python_version" ]] || ! version_at_least "$python_version" "3.9.0"; then
  echo "✗ 需要 Python >= 3.9（当前：${python_version:-未安装}）。请先安装 Python。" >&2
  read -k 1 -s "?按任意键退出..."
  echo ""
  exit 1
fi

echo "✓ Node.js $node_version"
echo "✓ Python $python_version"

# 3. 初始化 Python 虚拟环境与依赖
mkdir -p scratch
if [[ ! -d "scratch/.venv" ]]; then
  echo "→ 创建 Python 虚拟环境 (scratch/.venv)..."
  python3 -m venv scratch/.venv
fi

if ! scratch/.venv/bin/python3 -c "import yaml, PIL" 2>/dev/null; then
  echo "→ 正在安装 Python 核心依赖 (Pillow, PyYAML)..."
  scratch/.venv/bin/pip install --quiet "Pillow>=12.0.0" "PyYAML>=6.0.0"
  echo "✓ Python 依赖安装完成"
else
  echo "✓ Python 依赖已就绪 (Pillow, PyYAML)"
fi

# 4. 初始化网关配置模板
if [[ ! -f "scratch/gateway.env" ]]; then
  template=""
  for candidate in config/gateway.env.example scratch/gateway.env.example; do
    if [[ -f "$candidate" ]]; then template="$candidate"; break; fi
  done
  if [[ -n "$template" ]]; then
    cp "$template" scratch/gateway.env
    chmod 600 scratch/gateway.env
    echo "→ 已初始化 scratch/gateway.env，请记得填入 CONTENT_OPS_API_KEY。"
  else
    echo "⚠ 未找到 gateway.env.example 模板，请手动创建 scratch/gateway.env。"
  fi
fi

# 5. 安装前端依赖
if [[ ! -d "hanabi/node_modules" ]]; then
  echo "→ 首次启动，正在安装 Hanabi npm 依赖..."
  (cd hanabi && npm install --omit=optional)
fi

# 6. 启动 Hanabi 前端服务
# 说明：不要用 LaunchAgent 直接盯桌面上的源码目录——macOS 会拦截后台读 Desktop，表现为刷新后服务被掐断。
# 这里用 nohup 在用户会话里常驻；PID 写入 scratch/hanabi.pid，便于自检。
PID_FILE="scratch/hanabi.pid"
echo "→ 检查 Hanabi 服务状态..."
if curl --fail --silent "http://127.0.0.1:6187/healthz" >/dev/null 2>&1; then
  echo "✓ Hanabi 服务已在运行：http://127.0.0.1:6187"
  open "http://127.0.0.1:6187" 2>/dev/null || true
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "→ 发现残留进程 $old_pid 但健康检查失败，正在结束并重启…"
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

echo "→ 正在后台启动 Hanabi..."
# 直接跑 node，避免 npm 包装进程被终端/信号带走后子进程一起没。
NODE_BIN="$(command -v node)"
nohup "$NODE_BIN" hanabi/server.mjs >"scratch/hanabi.log" 2>"scratch/hanabi-error.log" </dev/null &
server_pid=$!
disown "$server_pid" 2>/dev/null || true
echo "$server_pid" >"$PID_FILE"

for i in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:6187/healthz" >/dev/null 2>&1; then
    echo "✓ Hanabi 服务已就绪：http://127.0.0.1:6187（PID $server_pid）"
    open "http://127.0.0.1:6187" 2>/dev/null || true
    exit 0
  fi
  sleep 1
done

echo "✗ 服务启动超时，请查看 scratch/hanabi-error.log" >&2
read -k 1 -s "?按任意键退出..."
echo ""
exit 1
