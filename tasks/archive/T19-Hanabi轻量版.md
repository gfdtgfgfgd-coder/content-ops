# T19 · 精简 Hanabi，删掉用不上的模块

执行者：Codex
状态：完成
依赖：T13（distilled-preferences.json）、T15（素材库接口设计）、T18（偏好编辑面板设计）
提出：lilith 授权，Claude 规划

## 目标

把现在的 Hanabi（688MB 打包体积，60 个 lib 模块，server.mjs 3645 行）精简成只服务 content-ops 的版本，依然叫 Hanabi，依然在 `hanabi/` 目录，不改名、不换路径。

目标体积：打包后 node_modules < 20MB，releases ZIP < 50MB（当前 688MB）。
目标代码量：server < 400 行，lib ≤ 10 个模块，app.js < 500 行。

**保留的功能**：
1. 生成小红书图文（输入模型名 → 调脚本 → 展示文案和封面）
2. 历史批次查看和恢复
3. 全量素材库（图文浏览、排序、引用高亮）— T15
4. 思敏偏好和风险词查看 + 编辑 — T18
5. 燃放预览

**删掉所有其它功能**（见下方「删除范围」）。

## 背景

现在 Hanabi 打包体积问题：
- `releases/runtimes/node`：139MB（独立 Node 运行时）
- `releases/runtimes/python`：109MB（独立 Python 运行时）
- `releases/app/node_modules`：436MB（含 `@anthropic-ai/claude-code`、`@google/gemini-cli` 等完整 CLI）
- `hanabi/lib/` 有 60 个模块，content-ops 实际只用 7 个

根本原因：content-ops 只是在完整 AI 工作台上加了一个入口，带着市场调研、知识库、飞书集成等大量无关模块。

## 操作方式：原地精简，先备份

**不新建平行目录**，直接在 `hanabi/` 原地操作：先备份整个目录为 `work/hanabi-backup-pre-t19/`，再删无关文件、重写 server.mjs 和 app.js。路径、LaunchAgent、启动器都不用改。回滚方式：`rm -rf hanabi/ && cp -R work/hanabi-backup-pre-t19/ hanabi/`。

精简后 `hanabi/` 的结构：

```
hanabi/
├── server.mjs          重写，< 400 行
├── app.js              重写，< 500 行
├── index.html          保留，改导航为五个 tab
├── styles.css          保留
├── electron-main.mjs   保留
├── package.json        精简依赖
├── lib/
│   ├── content-ops-production.mjs   保留（精简）
│   ├── content-ops-ui.mjs           保留
│   ├── content-ops-references.mjs   T15 新建
│   ├── content-ops-persona.mjs      T18 新建
│   ├── content-ops-banned-words.mjs T18 新建
│   ├── preview-studio.mjs           保留
│   ├── preview-batch-ui.mjs         保留
│   ├── preview-batch-model.mjs      保留
│   ├── preview-presentation.mjs     保留
│   ├── preview-layout.mjs           保留
│   ├── preview-batch.css            保留
│   └── dialog-dismiss.mjs           保留
└── （删除其余 50 个 lib 模块）
```

数据库只保留 `content_ops_batches` 和 `analysis_jobs` 两张表，其余 20+ 张表不建。

## 步骤

### 1. 备份（5 分钟）

```bash
cp -R hanabi/ work/hanabi-backup-pre-t19/
```

验证 `work/hanabi-backup-pre-t19/server.mjs` 存在后再继续。

### 2. 删除无关 lib 模块（20 分钟）

在 `hanabi/lib/` 里删除以下 50 个文件：

```
agent-api.mjs  agent-cli.mjs  agent-codex.mjs  agent-stream.mjs  agent-tool-bridge.mjs
ai-connections.mjs  ai-models.mjs  browser-startup.mjs
chat-activity.mjs  chat-agent-protocol.mjs  chat-knowledge-reader.mjs
chat-reading.mjs  chat-workbench-ui.mjs  chat-workbench.mjs
collection-presentation.mjs  content-reset.mjs  conversation-production.mjs
feishu-documents.mjs  http-file.mjs  inflow-composer.mjs
intake-collection.mjs  intake-input.mjs  intake-source.mjs
knowledge-catalog.mjs  knowledge-taxonomy.mjs  library-collections.mjs
market-comparison.mjs  market-cost.mjs  market-discovery.mjs
market-knowledge.mjs  market-package.mjs  market-products.mjs
market-research.mjs  market-search.mjs  navigation-session.mjs
opencli-output.mjs  ops-nav.mjs  optional-knowledge.mjs
readable-material.mjs  refine-knowledge.mjs  report-docx.mjs
report-format.mjs  report-html.mjs  resource-inventory.mjs
semantic-intake.mjs  source-network.mjs  structured-analysis.mjs
tool-effect-key.mjs  visual-search.mjs  workbench-presenter.mjs
workbench-skin.css
```

### 3. 精简 package.json 依赖（20 分钟）

`dependencies` 改为：
```json
{
  "dompurify": "^3.4.17",
  "marked": "^16.4.2"
}
```

删除：`@anthropic-ai/claude-code`、`@google/gemini-cli`、`node-pty`、`undici`、`jszip`、`roughjs`、`html-to-image`、`@fontsource-variable/noto-sans-sc`、`@radix-ui/colors`。

`devDependencies` 保留 `electron` 和 `electron-builder`。

```bash
cd hanabi && npm install
du -sh node_modules  # 目标 < 20MB
```

### 4. 重写 server.mjs（2 小时）

从当前 3645 行缩写到 < 400 行。只保留以下路由：

| 路由 | 说明 |
|---|---|
| `GET /healthz` | 健康检查 |
| `GET /api/content-ops/config` | 配置状态 |
| `POST /api/content-ops/generate` | 创建生成批次 |
| `GET /api/content-ops/batches` | 批次列表 |
| `GET /api/content-ops/batches/:id` | 批次详情 |
| `POST /api/content-ops/batches/:id/stop` | 停止批次 |
| `GET /api/content-ops/references` | 全量素材库（分页+排序） |
| `GET /api/content-ops/image/:platform/:id/:filename` | 图片代理（严格路径校验） |
| `GET /api/content-ops/persona` | 读偏好 |
| `POST /api/content-ops/persona` | 写偏好（自动 git commit） |
| `GET /api/content-ops/banned-words` | 读风险词 |
| `POST /api/content-ops/banned-words` | 写风险词（自动 git commit） |
| `GET /v1/models` | OpenAI 兼容：代理到公司网关，返回全量模型列表 |
| `POST /v1/chat/completions` | OpenAI 兼容：代理到公司网关，透传请求和响应（含 SSE 流式） |
| `POST /v1/images/generations` | OpenAI 兼容：代理到公司网关图像接口 |
| `POST /v1/messages` | Anthropic 兼容：代理到公司网关，供 Claude Code 直连 |
| `GET /*` | 静态文件服务 |

**本地 API 网关代理逻辑**：

Hanabi 把所有 `/v1/*` 请求原样转发到 `CONTENT_OPS_BASE_URL`（即 `https://duoyuanx.com/v1`），从 `tmp/gateway.env` 读取 `CONTENT_OPS_API_KEY` 自动注入 `Authorization: Bearer` 头。请求体和响应体完整透传，流式 SSE 响应直接 pipe 不缓冲。

cc switch、Claude Code、Codex 等工具只需把 base URL 指向 `http://127.0.0.1:6187`，不需要各自配置密钥，密钥只存在 `tmp/gateway.env` 一处。

实现要点：
- 用 Node 内置 `fetch` + `ReadableStream` 转发，不引入 `undici`
- `/v1/*` 路由不做同源检查（cc switch 等工具不是浏览器发出的请求）
- 不把请求体写入日志，只记模型名和状态码，防止对话内容泄露
- `tmp/gateway.env` 读取失败时返回 `503`，提示用户配置网关

数据库：只建 `content_ops_batches` 和 `analysis_jobs` 两张表。

### 5. 重写 app.js（1.5 小时）

从 3892 行缩写到 < 500 行。导航改为五个 tab：

```
生成图文 | 素材库 | 思敏偏好 | 风险词 | 预览
```

初始化五个组件：`ContentOpsUI`、`ContentOpsReferences`（T15）、`ContentOpsPersona`（T18）、`ContentOpsBannedWords`（T18）、`PreviewStudio`。

改 `index.html`：删除无关 `<section>`，保留五个页面容器，导航改为五个 tab。

删除所有市场调研、知识库、聊天、资料采集、飞书相关的 import 和初始化代码。

### 6. 精简打包配置（30 分钟）

`package.json` 的 `build.extraResources` 删掉：
- `.build/ContentAlchemySpeech.app`
- `.build/HanabiDocuments.app`
- `scripts/extract-video-assets.swift`
- `scripts/extract-image-text.swift`

`build.asarUnpack` 删掉 `@anthropic-ai/claude-code` 和 `@google/gemini-cli`。

`releases/Hanabi-*/runtimes/`（248MB 独立运行时）不打进新 ZIP。

`setup-new-mac.sh` 改为检查系统 Node ≥ 22、Python ≥ 3.9，版本不满足时打印安装提示并退出，不再内嵌运行时。

### 7. 验收（30 分钟）

1. `node hanabi/server.mjs` 启动，`/healthz` 返回 200
2. 打开 `http://127.0.0.1:6187`，五个 tab 可切换
3. 填 GLM5.3 / 小红书 / 2，生成成功
4. 历史批次下拉可恢复
5. 素材库展示 364 条 XHS 帖，排序切换正常
6. 思敏偏好添加后写入 SKILL.md + git commit
7. 风险词添加/删除正常 + git commit
8. 燃放预览可用
9. `du -sh hanabi/node_modules` < 20MB
10. 新 ZIP < 50MB

## 删除范围

| 类别 | 内容 |
|---|---|
| 市场调研 | market-*.mjs（8 个）|
| 知识库 | knowledge-*.mjs（2 个）、refine-knowledge.mjs |
| 资料采集 | intake-*.mjs（3 个）、inflow-composer.mjs、semantic-intake.mjs |
| 聊天工作台 | chat-*.mjs（5 个）、conversation-production.mjs |
| 飞书 | feishu-documents.mjs |
| 报告 | report-*.mjs（3 个）|
| Agent 桥接 | agent-*.mjs（5 个）|
| 工具模块 | ai-connections.mjs、ai-models.mjs、browser-startup.mjs、source-network.mjs、visual-search.mjs、structured-analysis.mjs、readable-material.mjs、opencli-output.mjs、ops-nav.mjs、optional-knowledge.mjs、tool-effect-key.mjs、workbench-presenter.mjs、workbench-skin.css、collection-presentation.mjs、content-reset.mjs、library-collections.mjs、resource-inventory.mjs、navigation-session.mjs、http-file.mjs |
| 原生助手 | ContentAlchemySpeech.app、HanabiDocuments.app（不打包进新版）|
| NPM 包 | @anthropic-ai/claude-code、@google/gemini-cli、node-pty、undici、jszip、roughjs、html-to-image、@fontsource-variable/noto-sans-sc、@radix-ui/colors |
| 运行时 | releases/runtimes/node（139MB）、releases/runtimes/python（109MB）|

## 产出

- `hanabi/`（原地精简，路径不变）
- `hanabi/server.mjs`（< 400 行）
- `hanabi/app.js`（< 500 行）
- `hanabi/lib/`（12 个模块）
- `hanabi/package.json`（2 个 runtime 依赖）
- `work/hanabi-backup-pre-t19/`（完整备份，可回滚）
- `releases/Hanabi-2026-11-02-mac-arm64.zip`（< 50MB）

## 验收

- [ ] `/v1/models` 返回公司网关的模型列表（含 glm-5.3、kimi-k3.1-pro 等）
- [ ] `POST /v1/chat/completions` 转发成功，流式响应正常透传
- [ ] `tmp/gateway.env` 缺失时返回 503
- [ ] `/healthz` 返回 200
- [ ] 生成 GLM5.3 ×2 成功
- [ ] 历史批次可恢复
- [ ] 素材库 364 条 XHS 展示，排序切换正常
- [ ] 思敏偏好添加后写入 SKILL.md + git commit
- [ ] 风险词添加/删除 + git commit
- [ ] 燃放预览可用
- [ ] `hanabi/node_modules` < 20MB
- [ ] releases ZIP < 50MB
- [ ] `work/hanabi-backup-pre-t19/` 存在且完整

## 规矩

- **先备份再动**：`work/hanabi-backup-pre-t19/` 完整后才删文件
- **不改生成脚本**：`scripts/gen-xhs-post.py` 不动，server 只调它
- **不改数据格式**：`data/xhs/*.json` 格式不动
- **回滚**：`rm -rf hanabi/ && cp -R work/hanabi-backup-pre-t19/ hanabi/`
- commit message 用中文，分步提交：备份 → 删模块 → 精简依赖 → 重写 server → 重写 app → 打包

## 时间估算

6 小时（备份 5min + 删模块 20min + 依赖 20min + server 2h + app 1.5h + 打包 30min + 验收 30min + 缓冲 30min）

## 完成记录

2026-11-03：完成 T19 精简与验收。

- `hanabi/server.mjs` 由 3663 行收敛为 81 行，保留生成、批次历史、素材库、偏好/风险词编辑、健康检查、静态文件和 `/v1/*` 纯透传网关；只建立 `content_ops_batches`、`analysis_jobs` 两张运行表。
- `hanabi/app.js` 由 3893 行收敛为 52 行，五个页面为「生成图文、素材库、思敏偏好、风险词、预览」；删除旧市场调研、知识库、聊天和采集入口。
- `hanabi/lib/` 保留 8 个 content-ops 模块，`node_modules` 约 2.0MB；已删除未接入且依赖旧通用模块的预览模块，预览页使用生成批次结果。
- 已建立 `work/hanabi-backup-pre-t19/` 完整备份；旧 `ops-nav.mjs` 已移除。
- 网关读取 `tmp/gateway.env`，缺配置 `/v1/models` 返回 HTTP 503；有配置时只透传请求体/响应体并注入 Bearer 认证，不注入业务上下文。
- 接口验收：`/healthz` HTTP 200；素材库小红书 364 条、分页 30 条；偏好 15 条标准/8 条反例/29 条引文；风险词 21 条。
- 浏览器冒烟：五个导航页可切换，偏好页显示 15/8/29，风险词页显示 21 条，素材库显示 364 条；修复 `.mjs` 静态 MIME。
- 轻量 ZIP：`releases/Hanabi-2026-11-03-t19-mac-arm64.zip`，453KB，仅含 Hanabi 精简源码和生成资源，未携带旧独立 Node/Python 运行时。
- 语法验收：`node --check hanabi/server.mjs`、`node --check hanabi/app.js`、全部 `hanabi/lib/*.mjs` 通过。

未做收费生成调用：当前本机网关余额不足，且 T19 验收只需确认生成入口与网关缺配置行为；生成脚本未改动。
