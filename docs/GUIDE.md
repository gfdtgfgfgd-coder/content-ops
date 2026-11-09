# 系统操作手册

> 本手册是工程架构、角色协作、操作入口、网关配置与仓库治理的唯一说明。业务写稿和做图规则见 `rules/content-spec.md`；原料库事实源仍由对应源文件维护。

## 仓库目录与核心文件全景说明

本轮开源路线评论索引：`data/model-corpus.md` Kimi 第 11 节“开源路线演进与选择权评论”保存来源指纹、原文主张边界与补测线索；通用方法唯一维护在仓库外 `~/.codex/skills/ai-content-alchemy/references/model-launch-playbook.md`“开源路线评论：权益、生态与能力分轴”，`style-profiles.md` 仅保存低置信结构选项。本轮只更新既有文件，不新增全文或评论副本。

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
| `config/` | 系统配置层 | **全局系统配置**。存放仓库体量预算规则（`repo-budget.json`）、数据清洗规则（`data-cleaning.json`）、偏好包构建映射（`preference-build.json`）、封面可用字体目录（`cover-fonts.json`）及网关环境示例模板。 |
| `data/posts.jsonl.bak.<时间戳>` | 本机恢复快照 | 合集清理前的原始 JSONL 字节备份，Git 忽略；仅供人工核查恢复，不作为可编辑数据源，不自动回灌。 |
| `data/images/.prune-<token>/`、`data/.posts-prune-*.tmp` | 临时事务文件 | 清理时暂存待删图片及原子写入数据；成功提交后删除，异常时撤回，Git 忽略。 |
| `data/` | 业务数据层 | **业务数据与事实源**。存放全量素材唯一源（`posts.jsonl`）、素材自定义合集（`collections.json`）、模型语料库（`model-corpus.md`）、去敏的企微运营反馈以及派生偏好包。 |
| `data/model-corpus.md` | 模型语料唯一源 | 2026-11-09 倪叔样本补充金融严谨性、首版错误与工具归因；专项指标不换算金融任务错误率，通用方法仍只在炼丹炉维护。 2026-11-09 增补 CANN 推理适配样本及一手文档核验，工程知识与性能条件见 Kimi 同名专节；通用方法见外部炼丹炉模型手册。 型号资料、文案候选与带来源的参考样本；2026-11-09 增补视觉编程样本，作者陈述保留待复测状态。通用方法只引用 ai-content-alchemy 模型上新手册，不维护第二份规则。 |
| `docs/` | 文档与治理层 | **系统手册与历史记录**。存放工程治理说明与操作指南（本《系统操作手册》`GUIDE.md`）以及重大版本演进记录（`CHANGELOG.md`）。 |
| `rules/` | 业务规则层 | **核心业务规范与风控源**。存放业务写稿与做图的唯一文档《内容生产规范》（`content-spec.md`）、风险词机器源（`banned-words-quick.yaml`）和受众标签规则（`audience-tags.yaml`）。 |
| `scripts/` | 服务与 CLI 层 | **后端脚本与流水线服务**。提供 fetch（数据抓取）、build（清洗/偏好包提炼/精简）、generate（文案/视觉/生图流水线）、doctor（体量与规范门禁闸门）等核心脚本与测试套件。 |
| `skills/` | Agent 技能层 | **可复用技能与提示词库**。存放思敏运营风格与反例提示（`simin-persona/SKILL.md`）、小红书爆款标题句式库（`xhs-title-patterns/`）等模块化 Agent 技能。 |
| `outputs/` | 业务交付层 | **AI 图文生成交付物与成稿归档**。存放生成图文流水线产出的最终文案 Markdown、海报图片、生成清单（`manifest.json`）及复核日志。其中历史基线样本已由 Git 版本库跟踪；已导出的交付成片不得清空、回滚或覆盖，重跑必须选择新目录。 |
| `outputs/<日期>/hanabi/` | 本机自动批次归档 | 自动生成的文案、模型原始响应、manifest及图片，供本机历史与续跑读取；整批Git忽略，既有已跟踪历史基线继续保留。不因源码预算清理用户成稿，不为新增本机批次放宽仓库预算。 |
| `scratch/reference-gallery-qa/` | 临时隔离验收仓库 | 从现有 Hanabi 页面/服务与测试图重建，用于多图编辑浏览器验收；独立 JSONL、Git 与 SQLite，不访问生产数据、密钥或历史；验收后删除。 |
| `scratch/` | 本机临时工作区 | **本地敏感配置与临时缓存（Git 忽略）**。存放本机 API Key 密钥文件（`gateway.env`）、Python 虚拟运行环境（`.venv/`）、测试产物、中间调试日志。除 `.venv` 和 `gateway.env` 外，其余内容均可随时清理。本轮局部备份 `scratch/deleted-reference-repair-20261105.json` 保存截图清理与缺图清理的恢复信息，核查后可删。 |
| `hanabi/` | 可视化表现层 | **Hanabi 批量图文与素材管理工作台**。包含本机 Node.js Web 服务端（`server.mjs`）、前端交互页面（`index.html`）、素材库/原料库/生成组件与相关样式资产。 |
| `hanabi/lib/content-ops-models.mjs` | 产品型号目录 | 从 `data/model-corpus.md` 解析正式型号、别名与封面短词库是否齐全；与 `scripts/lib/copy.py` 共用匹配规则。生成时对外保留输入显示名，别名命中只用于借用语料。 |

---

### 大字报背景实现

- `config/bold-typo-backgrounds.json`：背景材质配方、默认配色及关键词，唯一可编辑配方源，不保存外部图片或素材库副本。
- `config/cover-fonts.json`：大字报封面可用字体目录（id、显示名、本机候选路径），唯一可编辑字体源；排版参数 `typography.font` 引用其中 id，缺省为默认项。
- `scripts/lib/backgrounds.py`：读取配方，归一化视觉模型的背景描述，生成可复现的纸张/网格/笔记本材质层；供既有生成链路调用。
- `scratch/full-bleed-qa/`：本轮满幅材质的隔离验证输入、背景与成图；由已存视觉方案和现行生成函数重建，不是版本源，验收后删除。

大字报不再固定薄荷网格白底。视觉模型返回 `background_style={profile,description,base,ink,accent,highlight_roles}`，`profile` 从配方源选择；颜色为 `#RRGGBB`，高亮行引用已有 `cover_texts.role`。旧方案缺失此字段时按其视觉描述匹配配方，最终按真实配方记录，不声称旧模型已提取。选中或自动命中的结构锚图必须先有反推提示词（本机 `content_ops_prompt_runs` 就绪缓存复用，否则当场 `reverse` 并落库）；`background_style.description` 须在反推词上轻微改写，保留平面装饰（像素光标、`>>>`、色点、角标等）。图像模型画无营销字材质底图并可含上述平面装饰；`render_surface` 保留 AI 灰度明暗并叠加可复现的材质层，`render_bold_typo` 直接在其上排字，不再盖不透明白卡。深底和浅高亮各自计算可读墨色，留白和行距仍遵守内容规范。反推失败则整批在进入生图前明确失败。

AI 底图接近纯色时记录 `flat_ai_background=true`，补足本机材质，不自动追加收费调用。manifest 记录 `background_recipe_sha256`、实际 `background_style`、AI底纹明暗标准差和材质来源；配方改变后旧大字报需新目录生成，不覆盖原交付。默认配方及参数唯一源为上述 JSON，修改后无需重建纹理资产，下一次生成会重新读取。

材质配方v2统一采用 `surface_layout=full_bleed`：整个画布是一张连续材质，不再合成内缩纸面、矩形投影、第二层衬底或固定角落加号。旧方案的 `paper` 颜色字段兼容忽略，不再生成内层纸面，文字底色按实际 `base` 计算。生图提示只传选中配方及参考细节，并约束材质延伸至四边，不再并列提供多种材质让模型混用。AI仍可能不完全服从提示，真实成图必须检查；本机合成不再主动制造纸框。

背景调研来源：[ambientCG许可](https://docs.ambientcg.com/license/)、[Poly Haven许可](https://polyhaven.com/license)。两者提供 CC0 资产；本轮未引入外部图片，而使用原创程序材质与一张真实生成的无字纹理，避免把下载图、素材库原封面或文字残影当新背景。后续如引入外部资产须逐个保留来源、许可证、校验和重建方式。

### 提示词查看与反推模块

- `hanabi/lib/content-ops-prompts.mjs`：读取批次manifest中的提示词记录，调度单图反推；反推唯一记录存于既有本机SQLite的 `content_ops_prompt_runs`，不修改素材JSONL。
- `hanabi/lib/content-ops-prompt-ui.mjs`：素材单图反推面板及原始生成记录的共享只读渲染；生成记录嵌入统一图片编辑器，样式并入既有修改工作台样式表。
- `scripts/lib/prompts.py`：既有 `scripts/generate.py reverse` 子命令的单图观察与提示词反推实现；输入图片是资料，不是指令。生成链路通过同文件的 `ensure_reference_reverse` 按指纹复用或当场反推，再写入本机 `content_ops_prompt_runs`。
- `scratch/hanabi-runtime/prompts/<id>/`：一次反推的图片快照及文件式CLI输入输出，任务结束删除；原图与本机数据库记录保留，不作为第二份素材源。
- `scratch/prompt-qa/`：提示词面板的隔离浏览器验收环境，含独立素材、历史数据库与离线视觉替身；不访问生产密钥/素材，验收后删除。
- `scratch/repaint-qa/`：统一图片与提示词编辑器的隔离前端验收，使用独立历史数据库与离线图像替身，覆盖提示词生成、字号与对齐、调色盘双向同步、排版即时预览及无模型保存、预览采用、失败恢复及无图补图；验收后删除。

### 图文修改模块

- `~/Library/Application Support/Content Alchemy/recovered-batches/<id>/`：本机失败批次的追加式恢复记录，保存从原导出复制的检查点及后续成图，与本机历史数据库共同长期保留，不进 Git、不作为临时缓存清理；原始 `outputs/` 保持不变。

- `hanabi/lib/content-ops-revisions.mjs`：修改版本存储、并发校验与单篇修改任务；追加记录并保留原始批次。
- `hanabi/lib/content-ops-revision-ui.mjs`、`hanabi/lib/content-ops-revisions.css`：图文编辑、预览采用、区域框选及版本切换。
- `scratch/hanabi-runtime/previews/<id>/`：排版即时预览的请求、结果与PNG，均由当前图片背景层和控件参数重建，结束即删、不入版本历史；不含密钥。

- `scripts/lib/revision.py`：`scripts/generate.py revise` 子命令实现，文件式输入输出，承载文案改写、按提示词重新生成、本机排版预览与保存、原图编辑与替换校验。

## 角色与系统边界

系统按四元角色协作：Lilith 是最终业务拍板人；规划 agent 负责需求拆解、规则维护和风格终审；执行 agent 负责代码、脚本、抓取和单任务自验，不绑定单一模型；批量 agent（Hanabi）是批量图文、素材管理与可视化中枢。模型是可替换的工具，不等同于角色。

仓库按层组织：`data/` 保存帖子、来源索引和经过去敏的反馈；`rules/` 保存机器规则和内容生产规范；`skills/` 保存可复用提示与方法；`scripts/` 提供 fetch/build/generate/check CLI；`hanabi/` 是本机工作台；`outputs/` 保存交付物；`scratch/` 放密钥、虚拟环境和临时中间态。Hanabi 的 `/v1/*` 路由只做网关透传，不注入业务规则或上下文；业务逻辑放在生成脚本或专用业务 API。

抓取只覆盖人工书签、置顶和明确关键词补充，不全站抓取。单账号每分钟最多 10 个浏览器动作，每 50 条休息 5 分钟；支持断点续抓，验证码或登录失效立即停止。企微原文与截图仅存本机 `data/wecom/raw/`，提交内容仅保留去敏提炼。

## 工作台日常操作

启动方式：在仓库根目录运行 `./start.command`，或在 Finder 双击。默认服务地址为 `http://127.0.0.1:6187`。当前包含精选参考图的工作分支为 `codex/reference-collections-outline`，尚未合入 `main`；换机克隆须选该分支，已有仓库先核对 `git branch --show-current` 再拉取。主导航提供生成图文、素材库、原料库、操作规范。文档内容由白名单 API 实时读取仓库源，不保存第二份副本。

生成图文页面设置模型名、平台、图片数、封面风格、文案结构与每图文案数，可填写简报并选择素材。当前草稿引用唯一持久化源为 `sessionStorage['content-ops-reference-selection']`：素材库引用状态与生成表单双向同步，表单移除/清空会立即更新素材库；查看历史批次时，历史引用只在右侧作为只读事实展示，不回灌草稿。新批次依次调用文案、视觉提示词和图像阶段；手选参考按所选内容原样传递，未手选时后端只自动匹配 1 条同平台最佳参考。文案若因风险词校验失败，或返回空/非法 JSON（含未闭合 Markdown 围栏），会带着失败原因自动重出最多 2 次（每图合计最多 3 次文案调用），结构错误等其他校验仍立即失败；视觉与生图阶段仍不自动收费重试。每张海报只读取一张结构锚图，视觉阶段独立产出结构与封面短字，图像阶段按平台尺寸生成完整海报。续跑依 manifest 与来源哈希判定，不重复已完成收费阶段。成稿仍需规划 agent 做事实、合规和视觉复核，未经复核不发布。

素材编辑弹窗默认展示六行 OCR，最小 120px 且支持纵向拖拽，保存保留换行。图片缩略网格逐张删除、第一张标记封面；可多选或拖拽追加 PNG/JPEG/WebP，每张≤15MB、单次新增≤50张/45MB、总数≤200张。删除只在保存成功后落盘；取消不改原文件。删除全部图片时保留标题或正文即可存为纯文字，OCR 不代替标题正文。新增接口使用 `retained_images`（当前素材的原相对路径，有序且不重复）和 `new_images`（Base64数组），仍兼容旧 `image`；两种协议不可混用。保留图校验所属路径、真实文件和非符号链接，新图随机命名避免覆盖；同一事务原子更换目录与 JSONL、更新跨平台合集引用、Git成功后物理清理旧目录，失败恢复。图库编辑清空历史 `image_urls`，避免下游按旧抓取URL复活已删图片。

素材库直接维护 `data/posts.jsonl`：支持图文、纯图、纯文录入，编辑、删除、封面维护及精选标签；图片保存在 `data/images/<platform>/<id>/`。素材列表只按平台和本地 `data/collections.json` 中的自定义合集筛选，合集支持新建、改名、删除、素材加入/移出；删除合集或素材不会误删其他素材，关系文件与 JSONL 更新由存储层锁和原子替换保护。历史 `model_category`、`layout_style` 字段保留用于兼容旧数据，但不再作为素材库筛选入口。列表以 `limit=5000` 一次加载当前筛选结果（兼容 `limit=all`），不再提供分页按钮；「仅看标题 / 展开图文」保存在 sessionStorage，两种视图均可用卡片箭头单篇展开/收起，顶部切换会清除单篇临时状态并统一全部卡片。正文完整显示，图片仍延迟加载。删除成功仅移除对应卡片，同步数量、引用和合集关系；以存活卡片保持浏览位置，末尾按剩余内容高度自然收拢，不清空重载列表。素材加入/移出合集同样原地更新标签和归属菜单，不重载素材列表；当前筛选不再匹配时仅移除该条目并沿用存活卡片视口锚定，保留图片、单篇展开与引用选择。

素材顺序以文件为唯一源：初始按 JSONL 倒序展示，原生拖拽手柄或 ↑/↓ 触发 250ms 合并保存；全部合集/未分类通过 `POST /api/content-ops/references/reorder`（`{platform,ids}`）重排 `data/posts.jsonl`，只替换所选素材槽位、保留其他平台或隐藏素材的位置。自定义合集通过 `PUT /api/content-ops/collections/:id` 更新 `reference_ids`（`platform:id`），仅改变该合集的顺序。合集 CRUD 使用 `/api/content-ops/collections`（GET/POST）与 `/:id`（PUT/DELETE）；两种写入复用本机同源校验、存储锁、临时文件 fsync 与原子 rename，不创建排序缓存。

原料库包含运营偏好和风险词库。两者只增不删：运营偏好基于 persona 标准、反例和已去敏反馈摘录；风险词直接追加到 YAML。新增条目会保存源数据并调用规则提炼分析模型，打开操作规范确认面板。也可在原料库或操作规范点击「同步原料库」进行全量比对。确认后写入 `rules/content-spec.md`、重建偏好包并提交；取消只放弃规范草案，不回滚已成功保存的原料。修改建议可多轮重新分析。

操作规范下提供《内容生产规范》《系统操作手册》和只读《模型语料库》。内容生产规范是业务规则唯一文档；系统手册只说明操作和工程治理；语料库供创作参考，不覆盖事实或规范。

模型文章合并到 `data/model-corpus.md` 对应型号专节，分别记录发布稿、媒体转述及发布前线索的来源指纹、版本/时间边界与证据缺口，不复制原文。Kimi 本轮发布前 3D 样本见第 12 节。创作分析方法统一维护于本机 `~/.codex/skills/ai-content-alchemy/references/model-launch-playbook.md`，仓库不复制该手册。

BubbleBrain 发布速览与个人小测记录位于 `data/model-corpus.md` Kimi 第 11 节同名补充样本，保留四项任务、作者判断、数字差异和重复评论边界；通用取证方法只引用仓库外炼丹炉 `references/model-launch-playbook.md` 的“发布速览附个人小测”节。未新增文件或事实副本。

2026-11-09 新增的“榜单、海外作品与测评导流”样本仍保存在同一 Kimi 专节；其通用方法引用炼丹炉模型上新手册，不建立原文或规则副本。

简单实测与景区漫游样本保存在 `data/model-corpus.md` 的 Kimi 同名吸收节，含来源指纹、案例入口和待核验范围；照片外细节不直接视为忠实还原。通用检查方法仅维护于外部炼丹炉模型上新手册的同名方法节，不另建全文、评论或规则副本。

## 提示词查看与素材单图反推

生成结果卡片点击「图片与提示词」，主区可编辑当前版本的生图提示词；展开「原始提示词与调用记录」，可复制本批视觉方案、原始视觉返回和准确封面文字，按次数查看原始生图请求的模型、画幅、状态及完整提示词。展开记录不调用模型。当前修改版若没有自己的生图词（如上传或局部改图），编辑区明确提示从本批原始方案开始，不冒充当前图的原词；重新生成版本的实际提交词保存在对应版本记录。

新生图在发起调用前将完整请求写入原manifest的 `posts[].image_requests`；失败也保留，续跑复制此前尝试后追加。旧批次从既存 `image_generation.prompt` 读取；未保存的历史或尚未发起的请求明确标为缺失，不通过现行代码重建冒充原词。查询入口为 `GET /api/content-ops/batches/:id/posts/:jobId/prompts`，原始导出只读。

素材库点击任意图片（包括「其余图片」展开后的每张图）会打开反推面板：首次使用当前配置的视觉模型观察这一张原图，返回可复制的复现提示词、排除项及识别文字。已有图与今后新增/追加图片共用同一入口，无需逐张补录。反推是内部参考图观察，不是原始提示词，不作为产品能力事实；不把素材正文或其他图片送入本次请求，也不自动修改或生成图片。

反推记录唯一源是上述本机SQLite表；按图片字节SHA256、视觉模型、网关地址及服务反推版本索引复用。换图、改模型或改网关后不复用旧结果；修改反推观察协议时提升服务中的缓存版本。后端核对图片仍属于当前素材，抓取私有快照，并对照前端查看的哈希防止串图。相同任务/图片并发去重，最多两张同时反推；关面板不取消已开始的请求，稍后重开可查看已保存结果。失败和服务中断不自动重试，点击「重试反推」才再次请求。

接口为 `GET/POST /api/content-ops/image-prompts/:platform/:id/:filename` 与 `GET /api/content-ops/prompt-runs/:id`；写请求只接受本机同源JSON。业务CLI为 `python3 scripts/generate.py reverse --input request.json --output result.json --config scratch/gateway.env`，输入包括可信快照路径、图像哈希与当前视觉模型ID，临时文件在模块说明的目录内完成后删除。图片与素材JSONL不变，`/v1/*` 仍纯透传。

## 图文修改工作台

在生成结果或历史批次的卡片上点击「图片与提示词」或「修改文案」。文案先选择 A/B/C，再修改标题、正文、标签，左侧即时预览；「保存文案并采用」进行本地校验后保存。AI 改写只处理当前文案，遵循原始简报、事实与现行规则，结果需点击「采用此版」。卡片上的复制与 Markdown 下载使用当前采用文案。

图片编辑器默认展示可编辑提示词，点击「按提示词生成新图」只调用当前图像模型，不重新写文案或调用视觉模型。提交词原样传给图像模型，不隐式追加业务提示。大字报编辑背景词及3～4行封面短字、文字/高亮色；高亮色提供预设马克笔色盘，并可点系统调色器或手输HEX，三者双向同步、选色立即触发排版预览，载入历史版时同步恢复。默认高亮型号行；视觉方案漏掉型号时回落为只高亮型号。背景生成后本机准确排字；保留新底图实际颜色与材质，不用旧配方底色重新染色，封面文字区提供「总字号（%）」60～150、「文字对齐」居中/左对齐、「字体」下拉（目录见 `config/cover-fonts.json`，默认思源黑体），以及每一行独立的「字号%」（写入该行 `coverTexts[].scale`，与总字号相乘）。另有「背景调色」亮度/对比度/饱和度/色温滑杆（写入 `colorGrade`，默认100），只改无字背景层再叠字，不调用模型。新生成大字报默认总字号比例120%（编辑器控件同步为120）；100%保持基准自动字号，放大时同步加宽文字区，左对齐共用整组文字的左边线；高亮跟随字形，整组垂直居中，保留安全边距。原批次与未写入排版参数的旧版本在编辑器中仍按100%、居中、默认字体、调色中性载入。排版参数随版本保存，采用、重开与原稿恢复同步载回；调整总字号、每行字号、对齐、字体、封面文字、文字色、高亮或背景调色后，停止输入约180ms自动请求本机排字预览，左侧直接显示真实PNG；连续修改只显示最新结果，预览不会新增修改历史。满意后点击「保存排版」追加本机排版版本并采用，不调用任何模型。改背景提示词仍须点击「按提示词生成新图」；背景词有未生成修改时不能保存排版，避免把旧背景标成新提示词。其他版式编辑完整海报提示词，直接生成整张海报。缺图批次也可补图，采用后工作台显示完成；原任务和原文件不改，恢复原稿仍能显示原始失败状态。

原图修改入口收在「基于当前图片修改或上传替换」：填写修改要求可整图修改；开启框选后拖出矩形，仅修改区域内像素，区域外由本机合成保留。可上传 PNG/JPEG/WebP 替换，最多15MB、2000万像素，按原图尺寸等比适配并补白。改图与上传都先生成预览，再采用；下载预览图可保存尚未采用的候选图。选择历史版本后可继续修改或重新采用，最初原稿始终可恢复。

修改的唯一事实源是本机历史数据库中追加的 `content_ops_revisions`，`content_ops_revision_heads` 仅记录当前采用版本指针。新增修改图片按唯一 ID 写入既有上传缓存，原始 `analysis_jobs`、生成 manifest、已导出 `outputs/` 均不覆盖。工作台响应在原始结果上应用当前指针；重新打开历史批次仍读取已采用版本。新图和AI结果未采用前不影响当前成稿，文案各版本与图片彼此独立。重新生成的提交词与参数在调用前存入同一版本记录，失败/取消也保留，可点击该版本载回编辑重试；未完成图不可采用。改词后必须重新生成才可采用，避免旧预览与新词混淆。

业务入口为 `python3 scripts/generate.py revise --input request.json --output result.json [--image-output new.png] --config scratch/gateway.env`；参数文件由专用修改API构造。`kind=copy|image`，`action=manual|ai|upload|regenerate|typeset`；文案带 `source_text`/`text`，原图修改带可信 `source_image`，AI带 `instructions`，选区为归一化 `region={x,y,width,height}`，上传带 `image_data`。本机排字 `typeset` 复用可信 `source_image` 的背景层，仅执行本机排字；提交词必须与来源图片对应，禁止通过保存排版伪造新背景词。重新生成带原样 `prompt`、`render_mode=layered_poster|direct_poster`；大字报另带 `cover_texts`、`background_style` 与 `typography={scale,align,font}`（比例0.6～1.5，center/left，font 为 `config/cover-fonts.json` 中的 id），不要求已有图片；背景临时文件仅写任务目录。中间文件只在 `scratch/hanabi-runtime/revisions/<id>/`，完成后删除；可由同一输入重建，不作为第二份版本源。

即时预览入口为 `POST /api/content-ops/batches/:id/posts/:jobId/preview`，只接受本机同源JSON，核对当前版本与图片归属，最多2项同时运行、20秒超时。复用 `generate.py revise` 的 `typeset` 和正式保存相同的Pillow排字函数，返回PNG data URL，临时目录完成即删，不写历史数据库或上传缓存；错误不触发模型重试。

新大字报PNG内嵌唯一无字背景层（`hanabi_background_parts` 与分段压缩 `hanabi_background_<n>`，每段不超过512KiB），为可重排的成图组成部分，不能当作第二份可编辑规则或文字源。背景来自该次生图与材质合成，后续排字仅读取这一层，避免重复叠字。旧图没有底层时，只有原manifest的成图SHA256或对应导出审计的SHA256与实际图匹配，才使用可信 `rendered_text` 范围从临近无字区域本机修复；文字区下方纹理无法逐像素恢复，界面明确标记「旧图背景修复」。没有可信记录则明确不支持，不猜位置、不收费清字；用户可主动重新生图建立背景层。历史上传图的导出审计仅从既有 `outputs/<日期>/hanabi/<图片ID>/manifest.json` 读取并核对 `source_image` 与成图哈希，不修改原审计、图片或原版本。修复后保存的新版本保留背景层及 `backgroundRecovered` 标记，原稿可恢复。

AI改写使用当前文案模型；AI改图使用当前图像模型，携带原图和可选透明蒙版请求网关 `/images/edits`（multipart），不会降级到无图重生成。默认 `size=auto`，网关有特殊要求时可在本机配置 `CONTENT_OPS_EDIT_IMAGE_SIZE`。不支持接口、权限错误或超时明确失败并保留原稿；不自动重试。人工修改和上传无需模型调用。图片文字和改写事实仍须人工核对。

同一目标同时只允许一个修改任务；请求ID去重防止重复提交，采用操作用版本号与SQLite事务检测并发，拒绝覆盖其他窗口的新改动。关闭编辑器后可在版本记录继续查看任务；可取消正在进行的修改。取消只停止本机等待，已经发出的网关请求不保证撤销计费。服务重启将未完成修改标为失败，原稿保留。隔离验收使用 `scratch/revision-qa/` 和 `scratch/repaint-qa/`，可删，不访问真实密钥；自动回归仍在既有 Node/Python 测试入口内。

## 封面同构链路与排障

失败或部分完成的历史批次若已有 `copy.json` 与 manifest，可点击「继续完成本批」（`POST /api/content-ops/batches/:id/resume`）。后端新建上述恢复目录，保留原始导出，核对原始需求、参考、偏好、语料及配方哈希后执行既有 `--resume`。已保存但未通过本机校验的 `vision-prompt-N.txt` 优先重新解析校验，成功后直接补缺失图片，不重发已完成的文案或视觉请求；校验仍失败则明确报错，不自动收费重试。恢复请求去重，运行中或完成后再次提交不会启动第二次生成。

背景 `profile` 提示模型填写配方英文 `id`；兼容从唯一配方源读取的中文 `label`，以及英文标识大小写、空格、连字符变体，统一保存为标准 ID。未知显式名称仍拒绝并列出可用名称，缺省字段才沿用旧版关键词匹配，不能把有效中文名称误判为配方缺失。

风险检查先逐项检查准确上屏的 `cover_texts.text`，不对这些字段豁免序号词。自由提示词仅在检查投影中归一化排版序号：单项、并列、共享后缀和范围（如“第一、第三行”“第一至第四行”）是位置元数据；引号内文案保持原样检查，“行业第一”等宣传不豁免。原始响应、已保存提示词及实际排版指令均不改写；报错区分封面短字项与视觉提示词，便于准确定位。

业务约束唯一源为 `rules/content-spec.md` 的封面章节；模型封面语料唯一源为 `data/model-corpus.md` 各模型专节和文末共享组件。工程实现集中在 `scripts/lib/copy.py`，不新增入口脚本，也不在 `/v1/*` 网关注入上下文。

- `load_references` 读取 `data/collections.json` 为参考标注 `collection_name` / `collection_names`。自动按平台在对应合集的可读图片素材中选排名第一的 1 条；手选引用严格按用户选择传递，不静默追加。大字报生图提示词显式量化左右20%留白、文字跨度不超过60%、适中字重和宽松行距，但纯文生图无法保证像素级服从；真实成图仍需视觉验收。未分类手选图由视觉模型识别四类之一。实际合集缺素材/缺图时报告缺口，不换成其他版式。合集文件完全不存在仅兼容孤立旧环境。
- Hanabi 手动流派与 CLI `--style-preset` 对应：`bold_typo`→大字报、`top_middle_bottom`→上中下、`left_right_bottom`→左右下、`surround`→环绕；亦接受中文名。旧 `code_ide` / `card_3d` 映射上中下，`comparison` 映射左右下，`promo` 映射环绕。手选所属合集与预设冲突在收费调用前失败；同帖属多个合集时优先匹配预设，自定义描述不能推翻锚图结构。
- `CONTENT_OPS_VISION_MODEL` 每次接收一张原图、该图 OCR/合集、完整型号、该型号封面专节及当前风险规则；不接收正文、旧 `title_lines`、`cover_subtitle`、`cover_highlight` 或正文人群字段。文案模型不再承担封面短字生成。
- 视觉返回 JSON：`collection_name`、`structure`（布局、分区比例、文字区位置/行数/行长）、`cover_texts`（role/text/position）与 `visual_prompt`。本机校验版式、完整型号、短字容量、风险词及大字报主体禁区（拦截 3D/人物/电脑屏，允许平面光标等装饰），再把方案交给图像模型。空返回、不支持图像、截断、反推失败或非法方案明确失败，不自动收费重试。
- `manifest.json` 保存结构方案、封面短字、合集、参考原图哈希、视觉 usage、封面语料哈希与 `reference_reverse_prompts`（注明缓存复用或本批新反推），当前链路标识为 `copy_vision_image_v3`。大字报走分层路径：图像模型生成无营销字材质底图（可含反推轻改后的平面装饰），Pillow 保留 AI 底纹，结合参考材质配方与本机中等字重中文字体叠加文案和对应强调色；manifest 记录最终文字跨度、最小侧边距和行间空隙。自动与手动选中大字报均适用。上中下、左右下和环绕仍由图像模型生成完整海报。失败续跑可复用已校验方案和成功图片；旧版在线任务、新旧语料或参考哈希变化要求新目录，不覆盖原交付。显式 `--background` 仍为既有离线 Pillow 排版。
- 当前图像网关使用 `/images/generations`，未实现参考图片入参；原图只传多模态视觉模型，图像模型依据结构化提示词生成底图或完整海报。不宣称已启用图生图垫图能力，也不保证背景像素级复刻。大字报排版几何由代码保证；上线前仍须核对实际底图质感、文字、结构和合规。

现行风险源优先于语料示例，冲突表达采用允许的替代词，不删除或豁免禁词。修改规范、语料或技能后运行 `python3 scripts/build.py distill`（第二次应为 `changed=false`），再运行 `python3 -m scripts.lib.test_pipeline`、`cd hanabi && node --test` 和 `python3 scripts/doctor.py`。测试使用临时参考图/假模型，不写生产素材、不消耗生图额度；`doctor` 也检查暂存区字节，提交前需复查。

## 本机网关与模型配置

唯一持久配置为本机忽略文件 `scratch/gateway.env`，模板为 `config/gateway.env.example`。配置不得提交或写入日志。接口弹窗支持：

| 字段 | 环境变量 | 用途 |
|---|---|---|
| 文案写稿模型 | `CONTENT_OPS_TEXT_MODEL` | 生成文案 |
| 视觉提示词模型 | `CONTENT_OPS_VISION_MODEL` | 读取参考封面并编写视觉提示词 |
| 文生图模型 | `CONTENT_OPS_IMAGE_MODEL` | 生成完整海报 |
| 规则提炼分析模型 | `CONTENT_OPS_ANALYSIS_MODEL` | 原料库到内容生产规范的草案分析 |

`CONTENT_OPS_BASE_URL` 为 HTTPS 网关地址，`CONTENT_OPS_API_KEY` 为本机密钥。四项模型的初始默认值统一维护在 `config/gateway.env.example`，Hanabi 与生成 CLI 直接读取其中的模型字段；前端通过配置接口展示。已保存的本机配置优先于默认值。模型 ID 按网关实际权限填写。分析模型只由 `/api/content-ops/spec-sync/*` 专用业务模块调用；通用 `/v1/*` 透传保持原样。连接测试不测试生图权限。生成脚本经 `scripts/lib/gateway.py` 调用网关时，对 `RemoteDisconnected`、连接重置、超时等短暂断连会自动重试有限次数，仍失败则返回「网关连接中断/超时」类中文错误，不把原始英文断连栈直接抛给界面。

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

当前帖子唯一源为 `data/posts.jsonl`；风险规则唯一源为 `rules/banned-words-quick.yaml`；运营偏好事实源为 `skills/simin-persona/SKILL.md` 和 `data/wecom/simin-feedback.jsonl`。模型语料库唯一源为 `data/model-corpus.md`。用户提供的模型文章合并到对应型号专节，保留来源、入库日期、证据状态与数据口径；供稿不等于独立核验，不另存全文/评论副本。Kimi 发布供稿、媒体样本、阿颖作者评测及评论调查线索见该文件第 11 节；同一数据被多次转述不视为独立验证。不要编辑派生包代替源文件。本轮新闻综述的来源与定点核验继续维护在 Kimi 第 11 节；可复用方法唯一维护在本机炼丹炉 `~/.codex/skills/ai-content-alchemy/references/model-launch-playbook.md` 的“模型发布新闻综述”节，仓库只引用。

Rhea 深度实测的来源、逐项结果、完成声明差异与未测条件，维护在 `data/model-corpus.md` 的“深度实测吸收记录：执行结果与自我验收盲区”节。可复用的独立验收方法维护在本机炼丹炉 `ai-content-alchemy/references/workflow-archive.md` 的“交付声明与独立验收”节，模型文章手册提供调用入口；案例数字不在技能内重复保存。

Datawhale 近一周实测稿已合并到 `data/model-corpus.md` 的 Kimi 同名吸收节，补充验收对象、工具/人工贡献、总量与吞吐核对及订阅窗口口径；与其他样本分开归因，不另建全文或评论副本。

本次摸鱼小李六组 3D 参考记录见 `data/model-corpus.md` 同名专节；提示词要求、作者结果描述与实际验收证据分开记录，逆向操作及离线交付方法见仓库外炼丹炉既有模型手册。

小林coding经营游戏供稿索引：`data/model-corpus.md`「小林coding《驿站大亨》实测吸收」保留案例及证据状态；通用方法见外部炼丹炉 `references/model-launch-playbook.md`「完整项目的阶段交付与实测对账」。不据作者推演代替实际运行验收，不复制费用与榜单为第二份事实源。

### 接入新产品型号（避免「缺少封面短词库」）

生成链路区分 **对外显示名** 与 **语料正式名**：表单输入原样写入封面/文案（如 `kimi k3.1`）；若命中别名则只借用对应专节的能力事实与短词，并把短词中的型号位改写成输入名，**不会**把成稿改成 `Kimi K3.1 Pro`。未命中语料时不拦截：封面短词走通用回落，文案/视觉按输入名用公开已知能力适配。操作规范页提供活搜索；「采用」成稿后可由规则分析模型给出语料**缺口**草案，经确认面板人工确认才写入 `data/model-corpus.md`（不盲目改已有段落）。适配新模型时只改这一份语料，不要改脚本硬编码名单：

1. 新增专节标题，格式 `# 一、正式型号名 语料库`；多版本用 `/` 连接，如 `Kimi K3.1 Pro / Highspeed`。
2. 专节下第一行可写 `> 型号别名：kimi k3.1、别名2`，供借用语料；对外仍以用户输入名为准。
3. 建议包含 `## N. 封面吸睛大字与四大版式专属短词库`（含大字报四行组合）；缺失时自动回落，不阻断批次。
4. 解析规则：去标点大小写对齐；去掉 Pro/Highspeed 等版本后缀后若仍唯一命中则借用该专节；完全未命中则自由型号 + 封面回落。
5. 价格活动板块只做 1–3 行归一，**不再经 `mobile_body` 折行**；小红书标题超长一律裁到 20 字；引入超过两行只留前两行。
5. `/api/content-ops/config` 的 `productModels` 与生成页 datalist 均从该文件即时读取；补完语料后刷新页面即可，无需改前端名单。

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
| D20–D25：单源、分层与生产链路 | D20 由 `doctor.py` 和 repo budget 落门禁；跟踪文件预算曾落后实际仓库数量，2026-11-07 按当前131个有效工作区文件同步门槛（含需保留的输出 sidecar），字节及单文件上限不变；D21 采用 Lilith、规划 agent、执行 agent、批量 agent 四元分工；D22 文案/视觉/图像分阶段、分类即时派生、文档白名单直读；D23 素材 CRUD 直接维护 `data/posts.jsonl`；D24 模型语料唯一源为 `data/model-corpus.md`，由 Hanabi 只读展示并按配置供生成使用；D25 大字报改为 AI 无字底图加 Pillow 排字，其他版式继续完整海报直出。 |
| D26：素材库本地参考图纳入 Git 跟踪与体量预算扩容 | 外部图床/CDN URL（小红书等）具有时效签名，过期后报 403 无法重新下载，本机 `data/images/`（共 45 张精选参考图）为唯一生产事实。为确保其他电脑 clone 或下载仓库后完整可用、不出现“本机图片缺失或无法读取”，移除 `.gitignore` 中对 `data/images/` 的忽略，将 45 张精选参考图纳入 Git 跟踪，并将 `config/repo-budget.json` 跟踪文件上限调整为 180 个、体量上限调整为 12000 KB。 |
| 角色术语 | 旧记录中的 Codex/Gemini 等名称仅是历史实现，不是固定角色要求；按四元分工理解，模型供应商可替换。 |
| X1–X4：否决项 | 不以外部大模型重写底层、不全站抓取、不训练思敏偏好模型、不把界面永久排除；偏好以可审的 SKILL.md 管理，当前 Hanabi 工作台按 D16 承担可视化入口。 |

## 系统与本机资料的修改边界

经用户授权的重构可直接修改、重构、合并或删除仓库内任何系统层文件，包括 `hanabi/` 与启动壳、`scripts/`、`config/`、`rules/`、`docs/`、`skills/` 及仓库内 `data/`；不因旧有保守描述停机请示。仅保护本机 `~/Library/Application Support/Content Alchemy/` 下的生成历史数据库和上传图片缓存、`scratch/gateway.env` 中的真实 API Key，以及 `outputs/` 中已导出的交付成片。不得清空、重置或覆盖这些本机运行态资料。需要重启 6187 或 launchd 服务时，可按用户授权直接操作。

历史否决与变更说明集中在本节和 `docs/CHANGELOG.md`；完整时间线以 Git 历史为准，不保留第二份决策文档。

素材编辑保位（2026-11-06）：保存已有素材后按平台与 ID 定向读取规范化记录，只替换该卡片内部内容，不清空或重载全列表；保留 article 节点作为滚动锚点，同步图片、正文、合集、引用与展开状态。关闭编辑弹窗时恢复关闭前的页面坐标，避免焦点恢复引起滚动；若修改平台后不再匹配筛选，仅移除对应列表项并以邻近存活卡片保位。定向读取失败提示“素材已保存，卡片更新失败”，不误报保存失败或清空列表；筛选变化后的过期响应丢弃。回归入口仍为 `cd hanabi && node --test`，不引入新脚本或第二份素材数据。
