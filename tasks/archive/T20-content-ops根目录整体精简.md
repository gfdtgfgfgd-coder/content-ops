# T20 · content-ops 根目录整体精简

执行者：Codex
状态：完成
依赖：T17（数据补全）、T19（Hanabi 精简完成）
提出：lilith 授权，Claude 规划

## 目标

清理根目录重复规则、旧产物、旧文档和临时目录，让 content-ops 入口只保留当前工作所需内容。

## 完成内容

1. 删除旧版 `rules/banned-words.yaml`，保留 `rules/banned-words-quick.yaml` 作为唯一机器规则源；`data/wecom/risk-words.md` 保留为企微证据源，供偏好蒸馏复核。
2. 已完成任务卡统一放在 `tasks/archive/`，进度表只保留待开始、后续和当前状态。
3. 删除旧的根目录 `releases/` 及 688 MB 独立运行时包，把 T19 轻量 ZIP 和发布说明迁入 `hanabi/releases/`。
4. 将 `work/` 与已有临时产物合并为 `scratch/`，统一更新脚本、Hanabi、安装脚本、技能说明和文档路径；凭证仍只留在本机忽略目录。
5. 删除 `docs/` 中已并入 `GUIDE.md` 的旧文档，最终只保留 `GUIDE.md` 与 `01-决策记录.md`。
6. 删除根目录无关遗留 `AstrBot.app` 和旧 `outputs/` 生成物。

## 保留说明

`config/` 仍被清洗、偏好蒸馏和打包脚本读取，因此保留；`hanabi/assets/` 是当前界面图标和平台图标，随源码保留。根目录中的 `.gitignore` 属于仓库元文件，不计入业务目录清单。`config/gateway.env.example` 只含空值模板，真实凭证仍只留在 `scratch/gateway.env`。

## 产出

- `tasks/archive/T20-content-ops根目录整体精简.md`
- `rules/banned-words-quick.yaml`（唯一机器禁词源）
- `hanabi/releases/Hanabi-2026-11-03-t19-mac-arm64.zip`
- `scratch/`（统一工作区）
- 精简后的 `docs/`、根目录和路径引用

## 验收

- [x] 业务根目录只保留 README、AGENTS、setup-new-mac、requirements、config、data、rules、skills、scripts、hanabi、docs、tasks、scratch。
- [x] `rules/` 只有一个禁词文件 `banned-words-quick.yaml`。
- [x] `tasks/` 已完成卡在 `tasks/archive/`，进度表无 T20 待办行。
- [x] `hanabi/releases/` 有 T19 轻量 ZIP。
- [x] `scratch/gateway.env` 存在，Hanabi `/healthz` 返回 200；网关路径从 `scratch/gateway.env` 读取。
- [x] `hanabi/server.mjs`、生成脚本、安装脚本和文档无旧 `work/gateway.env` 或 `tmp/gateway.env` 引用。
- [x] `docs/` 只有 `GUIDE.md` 和 `01-决策记录.md`。

## 完成记录

- 2026-11-03：根目录清理完成；旧 full 禁词 YAML、根目录 releases、688 MB 旧包、AstrBot.app、旧 outputs 和 6 份旧 docs 已删除；T19 ZIP 已迁移到 `hanabi/releases/`。
- 2026-11-03：`node --check hanabi/server.mjs`、`node --check hanabi/app.js`、全部 `hanabi/lib/*.mjs` 语法检查、`python3 -m py_compile scripts/*.py`、`git diff --check` 通过。
- 2026-11-03：隔离 Hanabi 服务 `/healthz` 返回 200；无配置时 `/v1/models` 返回 503（使用空环境变量覆盖本机凭证测试）。
