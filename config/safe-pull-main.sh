#!/usr/bin/env bash
# 安全快进拉取 origin/main：有本机未提交改动、分叉或独有提交时停止，不覆盖、不 stash、不 hard reset。
set -euo pipefail

REPO_ROOT="${1:-}"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

LOG_DIR="${CONTENT_OPS_SYNC_LOG_DIR:-$HOME/Library/Application Support/Content Alchemy/repo-sync}"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/safe-pull.log"

log() {
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S %z')] $*"
  printf '%s\n' "$line" | tee -a "$LOG_FILE"
}

fail() {
  log "停止：$1"
  exit 1
}

[[ -d "$REPO_ROOT/.git" ]] || fail "不是 git 仓库：$REPO_ROOT"

cd "$REPO_ROOT"

EXPECTED_ORIGIN_HINT="gfdtgfgfgd-coder/content-ops"
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
[[ -n "$ORIGIN_URL" ]] || fail "缺少 origin"
case "$ORIGIN_URL" in
  *"$EXPECTED_ORIGIN_HINT"*) ;;
  *) fail "origin 不是本项目仓库（当前：$ORIGIN_URL）" ;;
esac

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || fail "当前分支是 $BRANCH，不是 main"

if [[ -e .git/MERGE_HEAD || -d .git/rebase-merge || -d .git/rebase-apply ]]; then
  fail "存在未完成的合并或变基"
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "已跟踪文件有未提交修改，保留现场不自动更新"
fi

log "开始检查更新：$REPO_ROOT"
git fetch origin

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
BASE="$(git merge-base HEAD origin/main)"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  log "已与 origin/main 一致，无需更新"
  exit 0
fi

if [[ "$LOCAL" != "$BASE" ]]; then
  fail "本机有独有提交或与 origin/main 分叉，不自动合并"
fi

# 未跟踪文件若会被入库文件覆盖则 ff-only 会失败；保留现场，不 clean / stash
log "快进合并 origin/main（$LOCAL → $REMOTE）"
if ! git merge --ff-only origin/main; then
  fail "快进失败（可能有未跟踪文件阻挡或非快进），保留现场"
fi

log "更新完成：$(git rev-parse --short HEAD)"
if command -v python3 >/dev/null 2>&1; then
  if python3 scripts/doctor.py; then
    log "doctor 通过"
  else
    log "警告：更新已完成，但 doctor 未通过，请人工检查"
    exit 2
  fi
fi
exit 0
