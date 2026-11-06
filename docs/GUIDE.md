# 系统操作手册

> 本手册是工程架构、角色协作、操作入口、网关配置与仓库治理的唯一说明。业务写稿和做图规则见 `rules/content-spec.md`；原料库事实源仍由对应源文件维护。

## 仓库目录与核心文件全景说明

> [!IMPORTANT]
> **新增文件同步规范（Agent 执行铁律）**：
> 任何接手的 Agent（包括规划 agent、执行 agent 等），在后续功能开发、重构、配置调整或数据导入导出时，**每当在项目中新增了任何文件或目录，必须立即在本节对应的清单中添加条目与简要说明**，明确其用途、所有权与生命周期（是否为可随时删除的派生物、是否包含敏感信息）。严禁在仓库内引入未经手册记录的“无名文件”。

本项目根目录核心文件与目录全景如下（对应访达项目根目录 12 项）：

### 1. 根目录核心文件（4 个）

| 文件名 | 类型 | 用途与定位 |
|---|---|---|
| `AGENTS.md` | 规范文档 | **多 Agent 协作工作规矩**。定义 Lilith、规划 agent、执行 agent、批量 agent（Hanabi）的四元分工、开工流程、新需求承接机制以及跨模型接替准则。 |
| `README.md` | 说明文档 | **项目总览与现状看板**。提供项目基本定位、快速接手指南、最新业务指标现状表（更新日期、文案配比、标题版式、图像通路、风险词源等）。 |
| `TODO.md` | 任务文档 | **待办与演进清单**。记录已拍板的需求规划、当前正在执行的重构事项、历史完成记录与后续演进项，Lilith 或 Agent 随时在此维护进度。 |
| `start.command` | 可执行脚本 | **macOS 访达双击一键启动脚本**。支持在 Finder 双击运行，自动检查 Node.js 与 Python 环境、自动补齐依赖、启动 Hanabi 本机后台服务并在浏览器中打开。 |

### 2. 根目录核心文件夹（9 个）

| 目录名 | 架构分层 | 用途与分层职责 |
|---|---|---|
| `config/` | 系统配置层 | **全局系统配置**。存放仓库体量预算规则（`repo-budget.json`）、数据清洗规则（`data-cleaning.json`）、偏好包构建映射（`preference-build.json`）及网关环境示例模板。 |
| `data/posts.jsonl.bak.<时间戳>` | 本机恢复快照 | 合集清理前的原始 JSONL 字节备份，Git 忽略；仅供人工核查恢复，不作为可编辑数据源，不自动回灌。 |
| `data/images/.prune-<token>/`、`data/.posts-prune-*.tmp` | 临时事务文件 | 清理时暂存待删图片及原子写入数据；成功提交后删除，异常时撤回，Git 忽略。 |
| `data/` | 业务数据层 | **业务数据与事实源**。存放全量素材唯一源（`posts.jsonl`）、素材自定义合集（`collections.json`）、模型语料库（`model-corpus.md`）、去敏的企微运营反馈以及派生偏好包。 |
| `docs/` | 文档与治理层 | **系统手册与历史记录**。存放工程治理说明与操作指南（本《系统操作手册》`GUIDE.md`）以及重大版本演进记录（`CHANGELOG.md`）。 |
| `rules/` | 业务规则层 | **核心业务规范与风控源**。存放业务写稿与做图的唯一文档《内容生产规范》（`content-spec.md`）、风险词机器源（`banned-words-quick.yaml`）和受众标签规则（`audience-tags.yaml`）。 |
| `scripts/` | 服务与 CLI 层 | **后端脚本与流水线服务**。提供 fetch（数据抓取）、build（清洗/偏好包提炼/精简）、generate（文案/视觉/生图流水线）、doctor（体量与规范门禁闸门）等核心脚本与测试套件。 |
| `skills/` | Agent 技能层 | **可复用技能与提示词库**。存放思敏运营风格与反例提示（`simin-persona/SKILL.md`）、小红书爆款标题句式库（`xhs-title-patterns/`）等模块化 Agent 技能。 |
| `outputs/` | 业务交付层 | **AI 图文生成交付物与成稿归档**。存放生成图文流水线产出的最终文案 Markdown、海报图片、生成清单（`manifest.json`）及复核日志。其中历史基线样本已由 Git 版本库跟踪；已导出的交付成片不得清空、回滚或覆盖，重跑必须选择新目录。 |
| `scratch/reference-gallery-qa/` | 临时隔离验收仓库 | 从现有 Hanabi 页面/服务与测试图重建，用于多图编辑浏览器验收；独立 JSONL、Git 与 SQLite，不访问生产数据、密钥或历史；验收后删除。 |
| `scratch/` | 本机临时工作区 | **本地敏感配置与临时缓存（Git 忽略）**。存放本机 API Key 密钥文件（`gateway.env`）、Python 虚拟运行环境（`.venv/`）、测试产物、中间调试日志。除 `.venv` 和 `gateway.env` 外，其余内容均可随时清理。本轮局部备份 `scratch/deleted-reference-repair-20261105.json` 保存截图清理与缺图清理的恢复信息，核查后可删。 |
| `hanabi/` | 可视化表现层 | **Hanabi 批量图文与素材管理工作台**。包含本机 Node.js Web 服务端（`server.mjs`）、前端交互页面（`index.html`）、素材库/原料库/生成组件与相关样式资产。 |

---

## 角色与系统边界

系统按四元角色协作：Lilith 是最终业务拍板人；规划 agent 负责需求拆解、规则维护和风格终审；执行 agent 负责代码、脚本、抓取和单任务自验，不绑定单一模型；批量 agent（Hanabi）是批量图文、素材管理与可视化中枢。模型是可替换的工具，不等同于角色。

仓库按层组织：`data/` 保存帖子、来源索引和经过去敏的反馈；`rules/` 保存机器规则和内容生产规范；`skills/` 保存可复用提示与方法；`scripts/` 提供 fetch/build/generate/check CLI；`hanabi/` 是本机工作台；`outputs/` 保存交付物；`scratch/` 放密钥、虚拟环境和临时中间态。Hanabi 的 `/v1/*` 路由只做网关透传，不注入业务规则或上下文；业务逻辑放在生成脚本或专用业务 API。

抓取只覆盖人工书签、置顶和明确关键词补充，不全站抓取。单账号每分钟最多 10 个浏览器动作，每 50 条休息 5 分钟；支持断点续抓，验证码或登录失效立即停止。企微原文与截图仅存本机 `data/wecom/raw/`，提交内容仅保留去敏提炼。

## 工作台日常操作

启动方式：在仓库根目录运行 `./start.command`，或在 Finder 双击。默认服务地址为 `http://127.0.0.1:6187`。主导航提供生成图文、素材库、原料库、操作规范。文档内容由白名单 API 实时读取仓库源，不保存第二份副本。

生成图文页面设置模型名、平台、图片数、封面风格、文案结构与每图文案数，可填写简报并选择素材。新批次依次调用文案、视觉提示词和图像阶段；本批最多选择 3 条本地参考，每张海报只读取一张结构锚图，视觉阶段独立产出结构与封面短字，图像阶段按平台尺寸生成完整海报。续跑依 manifest 与来源哈希判定，不重复已完成收费阶段。成稿仍需规划 agent 做事实、合规和视觉复核，未经复核不发布。

素材编辑弹窗默认展示六行 OCR，最小 120px 且支持纵向拖拽，保存保留换行。图片缩略网格逐张删除、第一张标记封面；可多选或拖拽追加 PNG/JPEG/WebP，每张≤15MB、单次新增≤50张/45MB、总数≤200张。删除只在保存成功后落盘；取消不改原文件。删除全部图片时保留标题或正文即可存为纯文字，OCR 不代替标题正文。新增接口使用 `retained_images`（当前素材的原相对路径，有序且不重复）和 `new_images`（Base64数组），仍兼容旧 `image`；两种协议不可混用。保留图校验所属路径、真实文件和非符号链接，新图随机命名避免覆盖；同一事务原子更换目录与 JSONL、更新跨平台合集引用、Git成功后物理清理旧目录，失败恢复。图库编辑清空历史 `image_urls`，避免下游按旧抓取URL复活已删图片。

素材库直接维护 `data/posts.jsonl`：支持图文、纯图、纯文录入，编辑、删除、封面维护及精选标签；图片保存在 `data/images/<platform>/<id>/`。素材列表只按平台和本地 `data/collections.json` 中的自定义合集筛选，合集支持新建、改名、删除、素材加入/移出；删除合集或素材不会误删其他素材，关系文件与 JSONL 更新由存储层锁和原子替换保护。历史 `model_category`、`layout_style` 字段保留用于兼容旧数据，但不再作为素材库筛选入口。列表以 `limit=5000` 一次加载当前筛选结果（兼容 `limit=all`），不再提供分页按钮；「仅看标题 / 展开图文」保存在 sessionStorage，两种视图均可用卡片箭头单篇展开/收起，顶部切换会清除单篇临时状态并统一全部卡片。正文完整显示，图片仍延迟加载。删除成功仅移除对应卡片，同步数量、引用和合集关系；以存活卡片保持浏览位置，末尾按剩余内容高度自然收拢，不清空重载列表。素材加入/移出合集同样原地更新标签和归属菜单，不重载素材列表；当前筛选不再匹配时仅移除该条目并沿用存活卡片视口锚定，保留图片、单篇展开与引用选择。

素材顺序以文件为唯一源：初始按 JSONL 倒序展示，原生拖拽手柄或 ↑/↓ 触发 250ms 合并保存；全部合集/未分类通过 `POST /api/content-ops/references/reorder`（`{platform,ids}`）重排 `data/posts.jsonl`，只替换所选素材槽位、保留其他平台或隐藏素材的位置。自定义合集通过 `PUT /api/content-ops/collections/:id` 更新 `reference_ids`（`platform:id`），仅改变该合集的顺序。合集 CRUD 使用 `/api/content-ops/collections`（GET/POST）与 `/:id`（PUT/DELETE）；两种写入复用本机同源校验、存储锁、临时文件 fsync 与原子 rename，不创建排序缓存。

原料库包含运营偏好和风险词库。两者只增不删：运营偏好基于 persona 标准、反例和已去敏反馈摘录；风险词直接追加到 YAML。新增条目会保存源数据并调用规则提炼分析模型，打开操作规范确认面板。也可在原料库或操作规范点击「同步原料库」进行全量比对。确认后写入 `rules/content-spec.md`、重建偏好包并提交；取消只放弃规范草案，不回滚已成功保存的原料。修改建议可多轮重新分析。

操作规范下提供《内容生产规范》《系统操作手册》和只读《模型语料库》。内容生产规范是业务规则唯一文档；系统手册只说明操作和工程治理；语料库供创作参考，不覆盖事实或规范。

## 封面同构链路与排障

业务约束唯一源为 `rules/content-spec.md` 的封面章节；模型封面语料唯一源为 `data/model-corpus.md` 各模型专节和文末共享组件。工程实现集中在 `scripts/lib/copy.py`，不新增入口脚本，也不在 `/v1/*` 网关注入上下文。

- `load_references` 读取 `data/collections.json` 为参考标注 `collection_name` / `collection_names`。自动按平台在对应合集的可读图片素材中选最多 3 条，优先覆盖两类结构，再按精选、型号相关性和互动排序；手选顺序优先，未分类手选图由视觉模型识别四类之一。实际合集缺素材/缺图时报告缺口，不换成其他版式。合集文件完全不存在仅兼容孤立旧环境。
- Hanabi 手动流派与 CLI `--style-preset` 对应：`bold_typo`→大字报、`top_middle_bottom`→上中下、`left_right_bottom`→左右下、`surround`→环绕；亦接受中文名。旧 `code_ide` / `card_3d` 映射上中下，`comparison` 映射左右下，`promo` 映射环绕。手选所属合集与预设冲突在收费调用前失败；同帖属多个合集时优先匹配预设，自定义描述不能推翻锚图结构。
- `CONTENT_OPS_VISION_MODEL` 每次接收一张原图、该图 OCR/合集、完整型号、该型号封面专节及当前风险规则；不接收正文、旧 `title_lines`、`cover_subtitle`、`cover_highlight` 或正文人群字段。文案模型不再承担封面短字生成。
- 视觉返回 JSON：`collection_name`、`structure`（布局、分区比例、文字区位置/行数/行长）、`cover_texts`（role/text/position）与 `visual_prompt`。本机校验版式、完整型号、短字容量、风险词及大字报主体禁区，再把方案交给图像模型。空返回、不支持图像、截断或非法方案明确失败，不自动收费重试。
- `manifest.json` 保存结构方案、封面短字、合集、参考原图哈希、视觉 usage 和封面语料哈希，链路标识为 `copy_vision_image_v2`。失败续跑可复用已校验方案和成功图片；旧版在线任务、新旧语料或参考哈希变化要求新目录，不覆盖原交付。显式 `--background` 仍为离线 Pillow 排版，不宣称同构生图。
- 当前图像网关使用 `/images/generations`，未实现参考图片入参；原图只传多模态视觉模型，图像模型依据结构化提示词生成。不宣称已启用图生图垫图能力，也不保证像素级复刻。上线前仍须规划 agent 核对实际成图的文字、结构和合规。

现行风险源优先于语料示例，冲突表达采用允许的替代词，不删除或豁免禁词。修改规范、语料或技能后运行 `python3 scripts/build.py distill`（第二次应为 `changed=false`），再运行 `python3 -m scripts.lib.test_pipeline`、`cd hanabi && node --test` 和 `python3 scripts/doctor.py`。测试使用临时参考图/假模型，不写生产素材、不消耗生图额度；`doctor` 也检查暂存区字节，提交前需复查。

## 本机网关与模型配置

唯一持久配置为本机忽略文件 `scratch/gateway.env`，模板为 `config/gateway.env.example`。配置不得提交或写入日志。接口弹窗支持：

| 字段 | 环境变量 | 用途 |
|---|---|---|
| 文案写稿模型 | `CONTENT_OPS_TEXT_MODEL` | 生成文案 |
| 视觉提示词模型 | `CONTENT_OPS_VISION_MODEL` | 读取参考封面并编写视觉提示词 |
| 文生图模型 | `CONTENT_OPS_IMAGE_MODEL` | 生成完整海报 |
| 规则提炼分析模型 | `CONTENT_OPS_ANALYSIS_MODEL` | 原料库到内容生产规范的草案分析 |

`CONTENT_OPS_BASE_URL` 为 HTTPS 网关地址，`CONTENT_OPS_API_KEY` 为本机密钥。模型 ID 按网关实际权限填写。分析模型只由 `/api/content-ops/spec-sync/*` 专用业务模块调用；通用 `/v1/*` 透传保持原样。连接测试不测试生图权限。

## CLI 与数据构建

合集清理复用 `scripts/lib/store.py`，唯一入口 `python3 scripts/build.py prune-references`：默认只预览；`--apply` 执行，`--platform` 默认 xhs，`--root` 可用于独立测试仓库。所有合集 `reference_ids`（兼容纯 ID）组成白名单，其他平台无条件保留；持有 Hanabi 同一 `.posts.lock`，先备份原始字节，原子替换并隔离提交 posts，失败恢复本次数据和图片。成功后物理删除图片隔离区；不碰合集和已交付成片。

初始化环境使用 `./start.command`。CLI 位于 `scripts/`：

```bash
python3 scripts/fetch.py --help
python3 scripts/build.py clean --platform xhs --report scratch/clean-xhs.json
python3 scripts/build.py audience --report scratch/audience.json
python3 scripts/build.py clean --platform xianyu --report scratch/clean-xianyu.json
python3 scripts/build.py distill
python3 scripts/generate.py copy --model GLM5.3 --platform xhs --count 1
python3 scripts/generate.py image --prompt "产品海报画面说明" --output outputs/test.png
python3 scripts/check.py --help
```

清洗只补充风险检查信号和明确的人群字段，不覆盖帖子原文。配置见 `config/data-cleaning.json`。`data/distilled-preferences.json` 是可删除、可重建的偏好缓存；源路径见 `config/preference-build.json`，使用 `python3 scripts/build.py distill` 重建，第二次应显示 `changed=false`。生成脚本优先读取该包，损坏时在收费调用前失败；缺失时才按代码中的显式回退源加载。

当前帖子唯一源为 `data/posts.jsonl`；风险规则唯一源为 `rules/banned-words-quick.yaml`；运营偏好事实源为 `skills/simin-persona/SKILL.md` 和 `data/wecom/simin-feedback.jsonl`。模型语料库唯一源为 `data/model-corpus.md`。不要编辑派生包代替源文件。

素材库写入：素材增删改、全局排序和合集 CRUD 均在仓库根目录持有 `.posts.lock`，写入临时文件、fsync、原子替换后自动 Git 提交；提交路径仅限本次受影响的 `data/posts.jsonl`、`data/collections.json`，使用 `commit --only`、禁用 hooks/签名，并为缺失的身份提供命令级兜底。提交失败会撤回本次数据和图片变更并向界面报错，不混入其他暂存代码。图片备份待提交成功才删除。素材库要求这两个数据文件已受本仓库 Git 跟踪。

**【最高红线】严禁暴力回滚生产数据（Agent 必读）**：`data/posts.jsonl` 与 `data/collections.json` 属于用户实时维护的生产数据库，界面增删改决定最新业务状态。严禁执行 `git restore data/posts.jsonl`、`git checkout -- data/posts.jsonl`、`git reset` 等覆盖用户数据的命令，整仓回滚也不得覆盖这两个文件！数量变动导致测试或流水线报警时，必须修复断言或同步派生配置，严禁为测试通过还原生产数据。抗回滚测试只能在独立临时 Git 仓库执行。自动提交保证恢复当前 HEAD 不撤销已提交删除；主动切到删除之前的历史或其他分支仍可能取回旧数据，不得据此承诺任意历史操作都安全。

素材删除排障：共同核对页面、API、JSONL 和图片文件，不把一次图片读取失败直接当作删除授权。2026-11-05 按 Lilith 本轮明确要求，检查声明的本地图片是否全部不存在，清理 17 条历史缺图记录及失效合集引用，393 条降至 376 条；保留纯文字素材和仍有任意有效图片的素材。局部恢复记录 `scratch/deleted-reference-repair-20261105.json` 保留此前截图两条记录，并追加本轮删除的 17 条及原合集关系；核查完可删，不作为第二素材源。

偏好构建仅从 `posts.jsonl` 当前存活且标为 good 的素材与 `reference-posts.json` 的交集中取小红书参考；索引过时、精选不足仅记录日志。`config/preference-build.json` 的数量是上限，不能当作生产库固定条数；素材编辑后清洗信号失效时按现行风险规则即时计算。数量测试使用独立临时数据和 Git 仓库，不因用户删帖而还原生产数据。

## 一份事实一个文件与 D20 闸门

同一事实只保留一个可编辑源。索引、缓存或导出物必须注明源和重建命令，通过 doctor 验证，并且可删除后重建。不要为一份规则复制第二份内容；能力扩展优先添加已有 CLI 子命令，不复制 v2 入口；历史重大变更写入 `docs/CHANGELOG.md`，完整 Git 历史留在版本库。

提交前运行 `python3 scripts/doctor.py`，退出码必须为 0。它检查跟踪文件数、总字节、单文件上限、完全重复文件、层入口白名单和 `scratch/` 体量。预算唯一配置为 `config/repo-budget.json`；如确需调整，必须同时在本手册说明原因并记录于现行决策表。

工作台编辑器和规范同步使用仓库锁、版本哈希、原子替换、构建校验和 Git 提交。操作前若受影响的规范源存在未提交改动，服务会拒绝自动提交；先由负责人审核并提交已有工作，再从工作台操作。提交信息使用中文；阶段完成后按协作约定推送。

## 关键工程决策与方案边界

| 决策 | 当前执行口径 |
|---|---|
| D1–D5：仓库、抓取与早期界面 | 使用独立 content-ops 私有 Git 仓库和统一本机路径；抓取按人工书签、置顶与关键词补充并遵守限速。早期「不做界面」已由 D16 推翻。 |
| D6–D9：素材、隐私与模型职责 | 小红书质量以人工精选为准、闲鱼按「想要」排序；企微原文留本机；规则与风格终审交规划 agent，执行与图像任务由可替换模型承担。 |
| D10–D15：内容与偏好事实源 | 平台价格表达及封面层级写入 `rules/content-spec.md`；persona 保存在 `skills/simin-persona/SKILL.md`，每帖受众标签使用 `rules/audience-tags.yaml`。风险词机器源仅 `rules/banned-words-quick.yaml`。 |
| D16–D19：工作台与对外红线 | Hanabi 是 content-ops 专用工作台；Model Price Watch 只用于调研、不进入当日生成链路；小红书与闲鱼禁 API 字样，所有对外内容禁境外模型品牌与型号。 |
| D20–D24：单源、分层与生产链路 | D20 由 `doctor.py` 和 repo budget 落门禁；D21 采用 Lilith、规划 agent、执行 agent、批量 agent 四元分工；D22 文案/视觉/图像分阶段、分类即时派生、文档白名单直读；D23 素材 CRUD 直接维护 `data/posts.jsonl`；D24 模型语料唯一源为 `data/model-corpus.md`，由 Hanabi 只读展示并按配置供生成使用。 |
| 角色术语 | 旧记录中的 Codex/Gemini 等名称仅是历史实现，不是固定角色要求；按四元分工理解，模型供应商可替换。 |
| X1–X4：否决项 | 不以外部大模型重写底层、不全站抓取、不训练思敏偏好模型、不把界面永久排除；偏好以可审的 SKILL.md 管理，当前 Hanabi 工作台按 D16 承担可视化入口。 |

## 系统与本机资料的修改边界

经用户授权的重构可直接修改、重构、合并或删除仓库内任何系统层文件，包括 `hanabi/` 与启动壳、`scripts/`、`config/`、`rules/`、`docs/`、`skills/` 及仓库内 `data/`；不因旧有保守描述停机请示。仅保护本机 `~/Library/Application Support/Content Alchemy/` 下的生成历史数据库和上传图片缓存、`scratch/gateway.env` 中的真实 API Key，以及 `outputs/` 中已导出的交付成片。不得清空、重置或覆盖这些本机运行态资料。需要重启 6187 或 launchd 服务时，可按用户授权直接操作。

历史否决与变更说明集中在本节和 `docs/CHANGELOG.md`；完整时间线以 Git 历史为准，不保留第二份决策文档。

素材编辑保位（2026-11-06）：保存已有素材后按平台与 ID 定向读取规范化记录，只替换该卡片内部内容，不清空或重载全列表；保留 article 节点作为滚动锚点，同步图片、正文、合集、引用与展开状态。关闭编辑弹窗时恢复关闭前的页面坐标，避免焦点恢复引起滚动；若修改平台后不再匹配筛选，仅移除对应列表项并以邻近存活卡片保位。定向读取失败提示“素材已保存，卡片更新失败”，不误报保存失败或清空列表；筛选变化后的过期响应丢弃。回归入口仍为 `cd hanabi && node --test`，不引入新脚本或第二份素材数据。
