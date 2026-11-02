# T20 · content-ops 根目录整体精简

执行者：Codex
状态：待开始
依赖：T17（数据补全）、T19（Hanabi 精简完成）
提出：lilith 授权，Claude 规划

## 目标

把 content-ops 根目录从现在的杂乱状态整理成一个结构清晰、没有冗余的仓库。**T19 跑完之后**再跑这张卡，因为 releases/ 合并依赖 Hanabi 精简后的新打包产物。

当前根目录的问题：

| 问题 | 具体表现 |
|---|---|
| 禁词三份重复 | `rules/banned-words.yaml`、`rules/banned-words-quick.yaml`、`data/wecom/risk-words.md` 是同一批词 |
| tasks/ 完成卡和待办卡混在一起 | 12 张已完成卡和 7 张待开始卡同级，阅读压力大 |
| hanabi/ 和 releases/ 是同一个项目 | 源码和打包产物分两个根目录，语义重复 |
| work/ 用途不明确 | 临时抓取脚本 + gateway.env，但名字没说清楚 |
| docs/ 有 6 个 _archive- 文件 | 已并入 GUIDE.md 的旧文档还留着 |

## 调整方案

### 1. 合并禁词三份为一份（20 分钟）

Hanabi 读的是 `rules/banned-words-quick.yaml`（通过 `scripts/gen-xhs-post.py`），其他两份不被任何脚本读取：

- **删除 `rules/banned-words.yaml`**（full 版，quick 是它的现行替代）
- **删除 `data/wecom/risk-words.md`**（人读的企微证据版，内容已在 `skills/simin-persona/SKILL.md` 的引文表里）

`rules/banned-words-quick.yaml` 是唯一保留的禁词文件。`rules/README.md` 更新说明。

### 2. 归档已完成的任务卡（10 分钟）

新建 `tasks/archive/`，把以下已完成卡移进去：

```
T01-仓库骨架.md
T02-抓取帖子.md
T03-简化版-学习层.md
T04-企微偏好提炼.md
T05-简化版-风险词.md
T06-文生图通路.md
T07-价格监控接入.md
T08-简化版-生成脚本.md
T11-改Hanabi界面.md
T12-Hanabi打包与启动器.md
T16-修Hanabi启动quarantine警告.md
```

`tasks/README.md` 进度表只保留待开始和进行中的行（T09、T13-T19），已完成行加一行「历史卡见 tasks/archive/」。

### 3. 把 releases/ 合并进 hanabi/releases/（20 分钟）

**前提：T19 已跑完**，有新的精简版打包产物。

操作：
```bash
mkdir -p hanabi/releases
mv releases/README.md hanabi/releases/README.md
mv releases/Hanabi-2026-11-02-mac-arm64.zip hanabi/releases/
# 旧的 688MB 打包和独立运行时不迁移，直接删
rm -rf releases/
```

更新 `README.md` 目录里的 `releases/` 引用改为 `hanabi/releases/`。
更新 `hanabi/releases/README.md` 里的路径引用。

### 4. 重命名 work/ 为 tmp/（5 分钟）

`work/` 里存的是临时抓取脚本（`extract-xhs.mjs` 等）和 `gateway.env`。改名 `tmp/`（取 temporary 之意）更清楚。

```bash
mv work/ tmp/
```

更新 `.gitignore`（`work/` → `tmp/`）、`AGENTS.md`、`README.md`、`docs/GUIDE.md` 里所有 `work/gateway.env` 引用改为 `tmp/gateway.env`。

更新 `setup-new-mac.sh` 和 `hanabi/lib/content-ops-production.mjs` 里读取 `work/gateway.env` 的路径。

### 5. 删除 docs/_archive- 旧文档（5 分钟）

6 个 `_archive-` 文件已并入 `docs/GUIDE.md`，内容不再需要：

```bash
rm docs/_archive-00-需求原文.md
rm docs/_archive-02-架构.md
rm docs/_archive-03-开放问题.md
rm docs/_archive-gateway-image-usage.md
rm docs/_archive-hanabi-usage.md
rm docs/_archive-xhs-generation-usage.md
```

确认 `docs/GUIDE.md` 里已包含这些文件的核心内容后再删。

## 调整后的根目录

```
README.md              入口
AGENTS.md              agent 工作规矩
setup-new-mac.sh       新电脑一键安装
requirements.txt       Python 依赖

data/                  原始数据（进 git）
  xhs/                 小红书帖子 JSON（364 条）
  xianyu/              闲鱼帖子 JSON（34 条）
  wecom/               企微聊天提炼
  images/              图片（不进 git）
  reference-posts.json 好帖索引

rules/                 规则库
  platform-rules.md
  design-rules.md
  banned-words-quick.yaml  ← 唯一的禁词文件
  cover-palettes.json
  README.md

skills/                可复用方法（SKILL.md 格式）
  simin-persona/
  xhs-title-patterns/
  xhs-post-generation/

scripts/               生成脚本
  gen-xhs-post.py
  gen-image.py
  check-banned-words.py
  fetch-posts.py
  redownload-images.py
  README.md

hanabi/                Hanabi 前端（精简后）
  server.mjs
  app.js
  index.html
  lib/
  releases/            ← 打包产物（从根目录 releases/ 迁移过来）
    Hanabi-2026-11-02-mac-arm64.zip
    README.md

docs/                  文档
  GUIDE.md
  01-决策记录.md

tasks/                 任务卡
  README.md            进度表（只含待开始/进行中）
  T09-人群标签.md
  T13-数据清洗.md
  T14-偏好安装到Hanabi.md
  T15-Hanabi图文素材库.md
  T17-补全数据标注.md
  T18-思敏偏好与风险词更新及Hanabi编辑面板.md
  T19-重构Hanabi轻量版.md
  T20-content-ops根目录整体精简.md
  archive/             ← 已完成卡归档

scratch/               工作区（不进 git，改名自 work/）
  gateway.env
  gateway.env.example
  extract-xhs.mjs
  extract-xianyu.mjs
  fix-xianyu-images.mjs
  .venv/
```

## 不动的东西

- `rules/cover-palettes.json`、`rules/design-rules.md`、`rules/platform-rules.md`：不重复，保持不动
- `skills/` 目录：是 content-ops 的核心，不归进 hanabi/，生成脚本和 Hanabi 都读它
- `scripts/`：content-ops 的执行层，不归进 hanabi/，Hanabi server 只调它
- `data/wecom/risk-words.md`：保留，是企微证据文件，和 YAML 并存合理
- `.gitignore`：只更新 `work/` → `scratch/`

## 产出

- `tasks/archive/`（新目录，含 11 张已完成卡）
- `rules/banned-words.yaml`（删除，quick 是唯一来源）
- `docs/_archive-*.md`（删除，共 6 个）
- `hanabi/releases/`（新目录，releases/ 合并进来）
- `releases/`（删除，内容迁移后）
- `scratch/`（work/ 改名）
- 所有引用 `work/gateway.env` 的文件更新路径

## 验收

- [ ] 根目录只剩：README.md、AGENTS.md、setup-new-mac.sh、requirements.txt、data/、rules/、skills/、scripts/、hanabi/、docs/、tasks/、scratch/（共 12 项）
- [ ] `rules/` 只有一个禁词文件 `banned-words-quick.yaml`
- [ ] `tasks/` 只有待开始/进行中的卡，已完成卡在 `tasks/archive/`
- [ ] `hanabi/releases/` 有新打包 ZIP
- [ ] `scratch/gateway.env` 存在，服务启动正常（gateway 路径改对了）
- [ ] `hanabi/server.mjs` 里读 gateway.env 的路径已更新
- [ ] `docs/` 只有 GUIDE.md 和 01-决策记录.md，无 _archive- 文件

## 规矩

- **T19 必须先完成**再合并 releases/，否则旧的 688MB 打包产物没必要迁移
- **路径更新要全量搜索**：`grep -r "work/gateway" .` 把所有引用都改掉
- commit message 用中文，分步提交：禁词合并 → 任务归档 → releases 合并 → work 改名 → docs 清理

## 时间估算

1 小时（各步骤都很短，主要是路径更新搜索）

## 完成记录

（Codex 填）
