# T38 · 接口配置恢复与小红书正文排版复核报告

执行日期：2026-11-03。执行 agent 完成功能自验；风格与事实终审仍交规划 agent，未发布。

## 可复核结果

Hanabi 左下角恢复「接口接入」，包含接口地址、密码输入框、文案模型、文生图模型和「保存并测试连接」。配置直接映射 `scratch/gateway.env`，不建立第二份配置表。常用 6187 端口已换成更新后的服务，可重新载入页面使用。

小红书 Markdown 不再拼接 audience。`copy.json` 和 `manifest.json` 保留受众，正文遵循现有平台规则里的移动端排版要求。本地只处理换行、空白和说明书尾巴，遇到连续标题冒号结构会明确失败，不进行付费自动重试。

## 前后端 Diff 摘要

| 文件 | 本任务增量与作用 |
|---|---|
| `hanabi/index.html` / `styles.css` | 左侧栏底部入口、脱敏密钥提示、原生 dialog 表单、关闭/取消与窄屏布局 |
| `hanabi/app.js` | 读取/保存状态、忙碌时禁用输入、打开关闭、错误提示；区分配置存在与连接成功 |
| `hanabi/server.mjs` | GET/POST `/api/connections`；本机 Host、浏览器 Origin、JSON 类型校验与 no-store |
| `hanabi/lib/content-ops-connections.mjs` | 共享 env 读取、输入校验、0600 原子保存、串行并发写入、脱敏结果、轻量上游探针；测试状态仅存内存 |
| `hanabi/lib/content-ops-production.mjs` / `content-ops-ui.mjs` | 服务与状态栏读取当前保存的配置；保存后刷新所选模型 |
| `scripts/lib/gateway.py` / `copy.py` | Node/Python 配置优先级一致，写稿按所选模型调用；删除 Markdown 人群尾巴；短行校验后的正文同步到 JSON、manifest 和 MD |
| `rules/platform-rules.md` | 本次移动端排版规范的唯一可编辑来源；不沿用固定 3–6 行和每行 emoji 要求 |
| `skills/xhs-post-generation/SKILL.md` / `data/distilled-preferences.json` | 技能引用规范与执行步骤，偏好缓存用现有 distill 命令重建；第二次重建 changed=false |

四个界面受管字段在文件存在定义时以文件为准，文件缺项才回退到进程环境；其他设置维持环境变量优先。手改文件后重新打开弹窗会读取新值；下一次生成无需重启。已开始的请求继续使用开始时读到的配置。

`/v1/*` 路由仍为纯透传，不注入 system prompt 或业务上下文。没有保存明文 Key 到响应、交付物或测试日志。

## 接口与界面验收

6187 上实际 GET/POST 验收（2026-11-03 19:43，上海时间）：

| 检查 | 结果 |
|---|---|
| GET `/api/connections` | HTTP 200，Key 仅返回掩码，原始 Key 未泄漏 |
| POST 当前配置、Key 留空 | HTTP 200，saved=true，原 Key 保持不变 |
| 实际上游 `/models` 探针 | HTTP 200，ok=true，随后 GET 保持 ok 状态 |
| 保存文件权限 | 0600 |
| 生成服务读取所选模型 | 与面板配置一致 |
| 跨站 Origin POST | HTTP 403 |
| 模拟新 Key、修改模型、手改文件、重复定义、并发写入 | 隔离文件与假上游单测通过，不改实际凭证 |
| 模拟 401、200 HTML、网络失败 | 均显示失败，GET 不会错误恢复绿灯，不回传上游原始诊断 |
| `/models` 不支持 | 仅 404/405/501 回退到所选文案模型的 1-token 探针；鉴权错误不回退 |

本轮早期已用 ego-browser 检查初版页面：左下角入口可点击，dialog.open=true，四个字段和密码框存在，关闭按钮能关闭弹窗。后续状态语义、模型刷新和报错处理改动由 API 联调及单测覆盖；没有把早期浏览器检查描述为最终版完整交互回归。浏览器 TaskSpace 已结束，没有重新操控已结束空间。

目录测试通过仅说明目录端点可连接并接受当前鉴权，不等于所选每个模型的实际权限、计费或生图额度已验证。本次探针没有调用文案或图片生成。

## 真实生成与全文

正式交付样稿：本目录 `post-1.md`；全部结构与成本原始记录见 `manifest.json`，原始模型返回为 `copy-response.txt`，校验后的结构化终稿为 `copy.json`。本报告不复制另一份全文源；对话交付中展示 Markdown 全文。

输入为 GLM5.3 的开发者需求整理、代码讨论、Agent 流程拆解场景，明确不加入容量、价格、活动、速度/稳定性承诺或个人试用经历。引用历史样本仅学习组织节奏，不将其参数带入本轮事实。

自动验收：

- 正文最长 20 字/行，共 4 个有空行分隔的段落。
- 无「适合人群：」尾巴，无连续标题冒号说明块。
- 正文、标题、标签、封面副标题/亮点及 audience 一并检查，当前风险词 0 命中。
- copy.json、manifest.json、Markdown 正文逐一比对一致，受众元数据保留。
- 最终批次写稿调用 1 次，响应计 34,874 tokens；复用已有背景，新增生图调用 0 次。

早期另有一次写稿调用（8,367 tokens），输出包含未给定的容量及个人使用经历，已移到忽略的 `scratch/t38-first-attempt/` 作为失败审计，不能发布。全任务合计写稿调用 2 次；没有自动付费重试。第二次是明确收紧验收输入并采用最终排版链路的新样稿，非模型自动重写。

正式批次第一次图片步骤遇到同期清理导致的旧背景缺失，保留了文案并以 `--resume` 使用当时仍存在的缓存背景完成；没有再次写稿或生图。manifest 保留原错误于 previous_errors，记录实际背景 hash。

成稿仍有「开发者福音」「一条龙」等营销措辞，末段的人群表达与 CTA 强度、断句自然度交规划 agent 终审。禁词零命中与排版自验不等于风格终审通过，也不代表独立产品能力核验。

## 自动化检查与复跑

```bash
PYTHONPATH=scripts scratch/.venv/bin/python3 -m unittest lib.test_pipeline -v
npm --prefix hanabi test
python3 scripts/build.py distill
python3 scripts/doctor.py
git diff --check
```

Python 22 项通过；Node 7 项通过（含 5 项新配置回归）；JS 语法通过；偏好缓存第二次构建不变；diff 空白检查通过。最终 doctor 结果在交付对话记录。

新样稿重新付费生成时，使用现有 `scripts/generate.py copy`，从本目录 manifest 取 product_model、platform、brief、count；背景取本目录 background-1.png，指定全新输出目录。已有 `copy.json` 是本轮可读终稿，Markdown 可用 `copy.markdown(post)` 从该文件重建，原始响应不改写。偏好缓存来源与重建命令见 docs/GUIDE.md，不直接编辑缓存。

## 提交边界

本工作区同时存在分层收口、数百项旧源删除及未跟踪服务层文件；此前已有改动与本任务在 copy.py、生产服务、文档等文件交叠。执行过程中也持续出现其他任务的文件变更。为保护这些未归属本任务的暂存内容，本报告交付可复核文件和运行结果；没有把整个共享工作区混入一次提交，也没有执行 push。规划 agent 集成时需先完成共同基线提交，再归入本任务增量。
