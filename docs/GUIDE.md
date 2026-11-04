# content-ops 操作手册

> 接手前先读 README.md（现状表）+ AGENTS.md（干活规矩）+ TODO.md（待办清单）。这份文档是补充细节，不是必读入口。

---

## 1. 架构

五层，层与层之间只通过文件（JSON / Markdown / 图片）传递，任何一层可以单独跑、单独换。

```
5 产出层   outputs/<日期>/          小红书图文 / 闲鱼帖 / 公众号 HTML
4 生成层   scripts/generate.py copy / image            文案模型写稿 → 视觉模型分析参考封面并写 Prompt → 图像模型直出海报
3 规则层   rules/ + skills/         平台规则 / 设计规则 / 禁词 / 思敏偏好 / 配色
2 学习层   scripts/build.py clean / distill / audience
                                    从 data/ 提炼标题句式、版式特征、人群标签
1 采集层   scripts/fetch.py posts / images          ego 浏览器抓小红书 / 闲鱼 / 企微截图 OCR
```

**四元角色与模型分工**

由于模型时不时会报错、单点 agent 容易不可用，角色分工精简解耦为四元角色（Lilith、规划 agent、执行 agent、批量 agent/Hanabi）：

| 角色 / 环节 | 职责定位 | 承接方 / 模型 |
|---|---|---|
| **Lilith** | 业务拍板 | 需求定夺、最终决策拍板 |
| **规划 agent** | 规划与复核 | 需求拆解、任务卡编排、规则维护、风格终审把关 |
| **执行 agent** | 单卡执行与自验 | 改代码、跑脚本、执行单卡；不与单一模型绑定，报错时可用备选模型热备 |
| **批量 agent（Hanabi）** | 批量生产与中枢 | 批量图文生成、素材浏览与编辑；在单点 agent 异常时提供可视化生产兜底 |
| 文案写稿 | 生成脚本调用的写稿模型 | 本机接口面板选定的公司网关文案模型 |
| 视觉提示词 | 分析真实参考封面并转写原创视觉提示词 | 本机接口面板选定的多模态视觉模型；最多读取 3 张参考图 |
| 去 AI 味 | 文本润色 | `avoid-ai-writing` 技能，不够接可用模型 |
| 文生图 | 海报背景与图直出 | `qwen-image-3.0`（公司网关，已实测） |

**平台区分**

| | 小红书 | 闲鱼 | 公众号 |
|---|---|---|---|
| 调性 | 不油腻、不偷袭 | 直给，像个人卖家 | 深度、可信 |
| 好坏信号 | 思敏企微红勾 / 单独截出 | 想要人数 | 阅读/在看 |
| 价格表达 | 不说具体折扣，可说「便宜管饱」 | 可说具体 | 可说具体 |

**帖子 JSON 格式**（`data/posts.jsonl` 每行一条，按 platform / id 排序）

```json
{
  "id": "平台内id", "platform": "xhs|xianyu", "url": "...",
  "title": "...", "body": "...", "cover_ocr": "封面大字OCR",
  "images": ["data/images/xhs/<id>/1.jpg"], "image_urls": ["原图url"],
  "tags": ["#glm5"], "metrics": {"likes":0,"collects":0,"comments":0,"wants":null},
  "label": {"good":true,"by":"思敏","reason":"企微红勾 2026-10-30","evidence_type":"red_tick"},
  "signal": {"engagement_tier":"good|high|mid|low","banned_word_hits":[],"clean_for_style_reference":true},
  "fetched_at": "2026-11-01T17:00:00+08:00", "source": "bookmark|pinned"
}
```

---

## 2. 决策记录

只列关键决定，全量见 `docs/01-决策记录.md`（该文件保留，不覆盖）。

| # | 决定 |
|---|---|
| D1 | 不重写 Hanabi，新建薄仓库 content-ops，每个能力独立成脚本 |
| D3 | 规划与复核 agent 负责规划纠偏，Codex 执行，lilith 拍板 |
| D5 | 抓取用 Codex 操控 ego 浏览器（已登录态），不用接口爬虫 |
| D7 | 闲鱼好坏用「想要数」；小红书好坏用思敏企微红勾 / 单独截出 |
| D9 | 文案 = 公司网关文案模型；批量执行 = GPT；去AI味 = avoid-ai-writing 技能；图 = 公司网关图像模型 |
| D10 | 价格区块词：允许「便宜管饱」「便宜量大」「活动价」；禁具体折扣和金额 |
| D14 | 思敏偏好以 `skills/simin-persona/SKILL.md` 形式沉淀 |
| D16 | 允许改 Hanabi，接 content-ops 生成脚本，不重构整个项目 |
| D18 | 小红书与闲鱼都禁 API；旧样本和 T13 旧示例不构成放行依据 |
| D19 | 所有对外可见内容禁写境外模型品牌和型号；内部事实源必须标注「仅事实源，不进文案」 |
| D20 | 一份事实一个文件，设置体量预算闸门 |
| D21 | 角色简化为四元分工：Lilith、规划 agent、执行 agent、批量 agent（Hanabi），解耦模型强绑定以应对模型与 agent 故障 |

---

## 3. 开放问题

| # | 问题 | 状态 |
|---|---|---|
| Q7 | D10 允许「便宜管饱」，但 2026-10-30 18:55 禁「量大管饱」；口径是否统一扩展？ | 开放：生成先用便宜量大/活动价，等 lilith 决定 |
| Q8 | 企微更早历史尚有缺口，未读取到 2024 年记录 | T17-C 已补采 77 屏并复查到客户端当前最早可加载端（2026-10-15 14:18）；更早历史未证明不存在 |
| Q9 | 公司网关余额约 0.05，Qwen 单次预扣 0.25，新背景生图受阻 | 阻塞中：补充额度后可用「生成新背景」 |
| Q11 | T36 无损 JSONL 约 811 KB，超过不可自行修改的 400 KB 单文件预算；旧索引又有 740 项差异，删旧源被禁止 | 待 lilith 确认：差异数据的保留/裁决方式，以及单文件预算与单 JSONL 要求如何协调；不改预算、不删旧源、不提交推送 |
| Q10 | D8 的隐私口径（企微原文只留本机、进 git 的只有提炼物）是否同样适用于 ChatGPT 对话原文？ | 开放：T31 暂按 D8 类推执行，原文放 `data/gpt-chat/raw/` 并 gitignore，等 lilith 确认 |

历史已关闭问题见 `docs/01-决策记录.md`。

---

## 4. Hanabi 怎么用

本机地址：`http://127.0.0.1:6187`（这台机器已装 LaunchAgent `com.lilith.hanabi.server`，关终端不影响；该 plist 未进 git、路径写死 `/Users/mac`，换机要单独装）。

**生成与审阅图文**
1. 打开「生成图文」。主导航为生成图文、素材库、运营规则、文档与决策四项。
2. 左侧填写模型名、数量，选择小红书或闲鱼、cached/fresh 封面背景；无可用缓存时仅可选 fresh。
3. 选择自动封面风格，或切换手动并填写预设/画面描述；「需求与卖点」选填，最多1000字。
4. 点击「开始生成」，右侧显示本批需求、风格、进度和平台卡片；生成中可停止，已有结果保留。
5. 卡片内复制完整文案、保存海报/主图；点击封面在当前页放大，按 Escape 或「关闭」返回。小红书按3:4、闲鱼按1:1展示，保存原图不缩放。
6. 左侧「历史批次」找回已保存结果并回填参数；「另做一批」开始新请求。窗口宽度小于1024px时设置与预览上下排列。

前端展示复用 `hanabi/lib/content-ops-ui.mjs` 的 Markdown 派生逻辑：标题、段落和末尾标签仅供排版，复制始终使用原始 `post.text`；不写回批次、不新增数据源。生成/历史接口结构不变。价格高亮只取已保存文案，互动区无虚构计数。回归命令见第9节，展示解析与转义测试并入现有 Node 测试文件。

**换电脑或启动服务**：克隆仓库后双击或运行 `./start.command`。它做四件事：检查 Node ≥22.13 与 Python ≥3.9、初始化 Python 虚拟环境并自动装好 Pillow/PyYAML、从 `config/gateway.env.example` 复制出 `scratch/gateway.env`、装 Hanabi npm 依赖并在后台启动服务后打开 6187。不再需要解压 ZIP。新图由图像模型直接生成完整海报；Pillow 仅在显式传入 `--background <图片>` 时用于离线合成兜底。小红书使用 1080×1440（3:4），闲鱼使用 1080×1080（1:1），尺寸与生成参数写入 manifest。旧版曾在 `hanabi/releases/` 放打包 ZIP，里面同时是 app 与 content-ops 的双份副本（套娃），已删除；说明见 `hanabi/releases/README.md`。个人数据库与附件始终不含在仓库里。

**文件位置**

| 项目 | 路径 |
|---|---|
| content-ops 源码与规则 | `~/Desktop/content-ops`（Git 同步） |
| Hanabi 源码 | `hanabi/`（本仓库内，源码即发布物，不再另发 ZIP） |
| Hanabi 运行副本 | `~/Library/Application Support/Content Alchemy/runtime` |
| 生成成品 | `~/Library/Application Support/Content Alchemy/content-ops/outputs/<日期>/hanabi/<批次ID>/` |
| 数据库与图片附件 | `~/Library/Application Support/Content Alchemy/library.sqlite` + `uploads/` |

---

## 5. 生成脚本与网关配置

**首次配置**

启动后点击左下角「接口接入」，填写 Base URL、API 密钥、文案写稿模型、视觉提示词模型和文生图模型，点击「保存并测试连接」。密钥不回传明文，输入框留空保留原密钥。保存直接原子写入 `scratch/gateway.env`（权限 0600）；没有第二份数据库配置。手改同文件后，再开弹窗会重新读取。五个受管字段以文件为准；文件缺少时才使用进程环境变量，其他设置保持环境变量优先。Node 生成服务、`/v1/*` 透传和 Python 生成脚本遵循同一优先级，无需重启服务即可用于下一次请求；已开始的生成使用启动时配置。

`GET /api/connections` 只读取并返回脱敏配置及本进程最近一次探测状态；手改文件或重启后显示未测试。`POST /api/connections` 保存后最多用 10 秒读取上游 `/models`，该端点不支持（404/405/501）时才以所选文字模型发起 1-token 探针。目录测试通过表示地址/鉴权可用，不代表每个模型的调用权限或生图额度已验证。测试失败仍保留所保存配置并明确显示失败；不会触发生图。接口仅允许本机地址，修改需 JSON 且校验浏览器同源。

```bash
./start.command  # 自动完成虚拟环境与依赖安装、模板复制与服务启动
# 或手动编辑同一 scratch/gateway.env（字段名见 config/gateway.env.example）
```

**生成**
```bash
# 新生成完整海报（文案与图像模型均调用）
python3 scripts/generate.py copy --model GLM5.3 --platform xhs --count 2 \
  --output outputs/<日期>/<新批次目录>

# 显式离线兜底：仅复用给定底图并用 Pillow 合成，不调用生图模型
python3 scripts/generate.py copy --model GLM5.3 --platform xhs --count 2 \
  --background <本机已有背景.png>

# 续跑失败批次
python3 scripts/generate.py copy --model GLM5.3 --count 2 --resume \
  --output outputs/<日期>/<同一批目录>
```

**简报与事实输入**
```bash
python3 scripts/generate.py copy --model GLM5.3 --count 2 \
  --facts data/corpus/glm-5.3/facts.json
```
运营输入可直接用 `--brief "本次卖点与人群"`，不填仍能生成；不是必须另造 facts 文件。`brief` 原文、`brief_source=user_provided`、三阶段链路标记写入 manifest。模型据本次输入自主判断受众、生成封面副标题与亮点。Hanabi 会持久化 brief；同一 requestId 修改需求返回409，另做一批使用新标识。

可选 `--facts` 用于独立核验资料：`{"model": "GLM5.3", "verified_claims": [{"claim": "断言", "source": "官方链接"}]}`。脚本仍校验型号一致且 claim 有 source；缺少 facts 不再统一删掉用户提供卖点或只写任务建议。用户输入与历史参考不等于独立核验，不凭空编造评测或活动；成稿交规划 agent 复核。每批只做一次文案模型调用并执行本地结构/禁词检查；每张新海报再独立调用视觉提示词模型与图像模型。这两个阶段不承担二次改稿或风格终审。参考帖即使与产品同型号也不作为产品事实源。

```bash
python3 scripts/generate.py copy --model 'Kimi K3.1 Pro' --count 1 \
  --brief '编程与长程 Agent 升级，便宜量大，适合程序员和独立开发者' \
  --output outputs/<日期>/<新批次目录> --background <本机已有背景.png>
```

最多1000字，多行可用；通过 argv 单参数传入，生产子进程使用 `shell:false`。所有最终可见文字（含封面亮点）按同一风险库检查；禁词不因简报或旧参考帖而豁免。

**偏好版本**：生成脚本优先读 `data/distilled-preferences.json`，日志输出 `preferences_loaded`，manifest 保存来源、日期、版本和 SHA256。缺包时会明确警告并回退旧来源；损坏或超长包会在收费调用前失败，不截断硬规则。可用 `--preferences <文件>` 指定路径，用 `--preference-max-chars` 调整上限。部分失败批次续跑要求同一偏好哈希，已完成历史保持原版本。Hanabi provider 行显示当前偏好版本。安装/打包脚本会同步偏好包，源规则改动后先蒸馏再安装。

2026-11-02 本机验收使用 `scratch/t14-neutral-test-background.png` 浅灰测试底图，不代表恢复了旧公司背景或调用了新生图。跨机缺少缓存时 `cachedAvailable=false`；新背景仍受 Q9 限制。当前导航为生成图文、素材库、预览、运营规则、文档与决策；偏好和风险词编辑入口在运营规则子 Tab，provider 显示文案、视觉与图像模型。

**文生图（单独调用）**
```bash
python3 scripts/generate.py image \
  --prompt "GLM5.3 高性能模型封面" \
  --output outputs/test.png
```

**已核验图像接口**：`POST https://duoyuanx.com/v1/images/generations`，Bearer Token，JSON 体含 `model`/`prompt`/`size`/`n:1`/`watermark:false`。

**当日列价（2026-11-01，实际以账户日志为准）**

| 模型 | 列价 | 状态 |
|---|---|---|
| `qwen-image-3.0` | ¥0.25/次 | 已实测 |
| `gpt-image-2` | ¥0.10/次 | 文档存在，未调用 |
| `gpt-image-2-all` | ¥0.05/次 | 未调用 |
| `gpt-image-2.5-flare` | ¥0.15/次 | 未调用 |

## 6. 数据清洗与偏好包

先运行 `./start.command` 初始化环境。在仓库根目录按顺序运行：

```bash
python3 scripts/build.py clean --platform xhs --report scratch/clean-xhs.json
python3 scripts/build.py audience --report scratch/audience.json
python3 scripts/build.py clean --platform xianyu --report scratch/clean-xianyu.json
python3 scripts/build.py distill
```

清洗只增加 `signal`、解析有明确列表的 `audience`；不改帖子原文、好帖标签或最新 wants。`_notes-index.json` 是另一抓取时点的导航快照，不参与清洗和互动分层，以 posts.jsonl 记录的 `metrics` 为准。闲鱼 `_ranked.md` 仅为缺失 wants 提供按 ID 回填的依据，排序并列按 ID 字典序。

清洗阈值、扫描字段和输入目录见 `config/data-cleaning.json`。风险检测扫描正文、封面 OCR 和标签；标题等字段仅提供模型范围上下文。`--input-dir`、`--output-dir` 可处理副本，`--dry-run` 只报告，`--rules` 可指定词库。人群 raw 只有标题时不补造列表。

偏好包 `data/distilled-preferences.json` 是可重建缓存，来源仍是 `rules/` 与 `skills/`。`config/preference-build.json` 指定来源与引用数量，脚本保留来源哈希、引文、正则和模型范围；默认日期取 persona 证据版本，也可传 `--date YYYY-MM-DD`。不要直接修改缓存。源规则更新后先重跑清洗，再重建偏好包。第二轮应显示 `changed=0`（清洗）或 `changed=false`（偏好包）。GPT 执行提取与检查，规划与复核 agent 负责偏好与风格判断。

---

*原始详细文档保留在：`01-决策记录.md`（完整决策列表）。其余 00/02/03/gateway/hanabi/xhs-generation 内容已并入本文件，可归档。*

## 7. 全量素材库与生成引用

Hanabi「素材库」展示小红书364帖、闲鱼34帖，默认30条，按需加载更多。精选优先保留全量并把所有精选放前，同为精选时优先干净素材；互动最高按点赞+收藏×2+评论，闲鱼可选最想要。精选含禁词仍展示风险提示，历史内容不能直接当现行事实或合规文案。

工具栏「➕ 添加素材」和卡片「编辑」共用弹窗，支持图文、纯图、纯文；图片、标题、正文至少有一项，OCR 单独填写不算有效素材。上传支持选择与拖拽、预览和移除，PNG/JPEG/WebP 最大15MiB。删除须确认并同步清理本地图片，取消不写入。编辑后刷新当前列表，仍遵守当前平台与分类筛选；默认精选优先时，勾选精选后移至前列。纯文可保存、检索及参与文案参考；新图生成链路仍要求所选参考中至少一张可读取本地图片，全部纯文会在收费调用前报缺图。

CRUD 直接操作唯一源 `data/posts.jsonl`，不调用模型。接口契约：

- `POST /api/content-ops/references` 新增，返回201及 `{reference}`；`POST /api/content-ops/references/:id/edit`（或 `PUT /api/content-ops/references/:id`）编辑；`POST /api/content-ops/references/:id/delete`（或 `DELETE /api/content-ops/references/:id`）删除，返回 `{deleted:{id,platform}}`。写入请求仅允许同源，新增/编辑要求 JSON。
- 字段为 `platform`（默认xhs，也支持xianyu）、`title`、`body`、`cover_ocr`、`model`、`model_category`、`layout_style`、`label:{good:boolean}` 和 `image`；分类取值以现有筛选/编辑表单为准。人工分类存原记录并优先于自动推断，风险提示仍按当前规则重算。
- `image` 可为原始 Base64、data URL、`{data,mimeType}`；数据层还接收 Buffer/Uint8Array。按实际字节识别格式并检查声明与大小。新增生成24位十六进制ID、`source:user_added` 和ISO时间，图片写至 `data/images/<platform>/<id>/1.<ext>`。不传图片时 `images:[]`，列表封面为null。
- 编辑省略 `image` 保留原图，传新图替换封面并保留其他轮播图，传null移除全部图片；修改平台同时迁移目录和记录路径。文字和标签只更新显式提交字段。
- 写入经同进程队列及跨进程临时锁保护，JSONL 使用临时文件、fsync和rename；图片目录暂存与回滚避免普通写入失败造成丢图。删除清理整条素材目录。锁和暂存目录为运行时产物，不是第二事实源；不支持绕过该入口的外部并发改写。

卡片「引用到下一批」最多选择8条；选择仅保留在当前浏览器会话中，生成时才显式传给脚本。结果里的「本批参考了」来自实际manifest，点击可定位高亮素材，不影响分页。命令行可用 `--references <JSON>`，文件是 `[{"platform":"xhs","id":"帖子ID"}]`；manifest记录标题与来源哈希，失败续跑要求引用一致。未手选（包括空数组）时，自动从 `data/posts.jsonl` 取同平台最多3条，人工good优先，再按型号相关性和点赞/想要排序；manifest保留实际引用数量，少于2条时不补造样本。手选优先。仅学习节奏、排版、痛点和卖点组织，不照搬别的产品参数；当前风险库始终有效。

2026-11-03 更正：运行源码就是仓库里的 `hanabi/`（index.html、app.js、server.mjs、lib/、styles.css），不再有 releases 下的 ZIP，也没有「解压后的 app/」这一层。业务数据仍在 Application Support/Content Alchemy/content-ops。素材与结果组件可独立于旧 app.js 运行，旧通用工作台已收敛为核心操作与规则知识两组导航。


## 8. 收口与可重建性（T36，2026-11-03）

- 数据当前供新 CLI / Hanabi 读取 `data/posts.jsonl`；Python reader 是 `scripts/lib/store.py` 的 `load_posts(platform=None)` / `post_count()`。显式旧目录输入只用于迁移核验或隔离测试，不做隐式回退。
- **历史迁移记录（当前收口状态以README/TODO为准）**：`python3 scripts/build.py migrate-posts --report scratch/t36/migration.json --delete-legacy` 原样导出 398 条后发现索引差异。导出后又执行了清洗验收，仅 signal 与旧源不同；不要重新覆盖导出物。若需重验原始迁移，用 `--output scratch/t36/original-posts.jsonl`。逐项原值见 T36「疑点待复核」。在明确处置旧索引之前，旧目录不能删除。
- 偏好派生包：源由 `config/preference-build.json` 指定；重建命令 `python3 scripts/build.py distill`，第二遍 `changed=false`。删包不影响重建，生成入口缺包时有明确回退警告。
- 本机 App 图标：唯一图源 `hanabi/assets/app-icon-1024.png`；`python3 scripts/build.py package` 用 sips / iconutil 在系统临时目录生成 iconset / icns，成品在被忽略的 `releases/Hanabi.app`；可删后重建。它只是指向当前源码的本机启动器，不是独立运行时或可搬电脑的 ZIP。旧 package 的 runtime / Python 参数只为参数兼容保留，不再复制运行时，换机仍跑 ./start.command。
- 历史归档已压为 `docs/CHANGELOG.md`，仅保留完成记录原文；历史全文查 Git 历史。不再维护 `tasks/` 目录与卡片。
- 提交前跑 `python3 scripts/doctor.py`（工作区候选文件，含未跟踪、排除已删除），Git hook 再跑 `--staged`（索引字节，不被工作区修改绕过）。本机启用 `git config core.hooksPath .githooks`；检查失败禁止提交与 push。预算仍只在 `config/repo-budget.json`，不得为 T36 私自放宽。
- 当前预算以 `config/repo-budget.json` 为准：文件数105、总体2400KB、单文件1000KB；D22仅将文件数从95调至105，其他既有预算保持。以上迁移差异保留为历史证据。
- 服务实现复用放 scripts/lib；新增平台/账号只改配置与数据，不增加入口。OCR 同样只更新 JSONL，不写回旧目录。图像缓存路径 data/images/<platform>/<id>/ 保持不变。


## 9. 多模态链路、分类与业务文档

新海报流程为 `copy_vision_image_v1`：文案输出标题/正文/标签/人群/封面卖点；视觉模型通过多模态 `image_url` data URL 实际接收最多3张本地 JPEG/PNG/WebP，再写原创视觉 Prompt；图像模型生成完整海报。阶段相互独立，文案与视觉模型可按权限配置为同型号的不同调用。视觉输入只允许 `data/images/` 内真实图片，单张最多15MiB，记录源路径/SHA256。输出、usage、实际型号与画幅见 manifest。完成任务续跑不重新收费；失败任务显式 `--resume` 才续跑，同文案/参考图时复用已保存的视觉 Prompt。

素材库新增模型和版式筛选，服务端组合过滤后分页；勾选状态跨筛选保留。分类优先读取 `data/posts.jsonl` 内人工保存的 `model_category` / `layout_style`；未标注时由标题/正文/标签/OCR即时派生，版式推断仅使用标题和OCR线索，不宣称像素级识别。通用“编程/代码”主题不能单独判为代码屏。分类无独立映射文件，刷新 `GET /api/content-ops/references` 即重建，源改动下一请求生效；可随时丢弃响应。使用者需结合原图核对。

运营规则包含平台、设计、思敏偏好、风险词；后两者继续编辑原有唯一源。文档与决策包含手册、决策、素材来源。五份Markdown由 `GET /api/content-ops/documents?doc=<白名单名称>` 直接读取对应源文件，不写索引或副本、不缓存，每次打开重新读取；浏览器以 marked + DOMPurify 渲染并生成目录。接口拒绝任意路径、重复参数与原型字段名。原始聊天、密钥、代码和仅供agent的规矩不在文档白名单。

验收命令：`scratch/.venv/bin/python -m unittest scripts.lib.test_pipeline`、`npm test --prefix hanabi`、`python3 scripts/doctor.py`。CLI与Hanabi生成子进程优先使用启动脚本创建的 `scratch/.venv`；工作区其他改动和暂存内容需单独核对后提交，不混入本任务。
