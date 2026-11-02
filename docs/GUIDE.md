# content-ops 操作手册

> 接手前先读 README.md（现状表）+ AGENTS.md（干活规矩）+ tasks/README.md（进度）。这份文档是补充细节，不是必读入口。

---

## 1. 架构

五层，层与层之间只通过文件（JSON / Markdown / 图片）传递，任何一层可以单独跑、单独换。

```
5 产出层   outputs/<日期>/          小红书图文 / 闲鱼帖 / 公众号 HTML
4 生成层   scripts/gen-*            Claude 写稿 → 去AI味 → 风险词过滤 → 文生图
3 规则层   rules/ + skills/         平台规则 / 设计规则 / 禁词 / 思敏偏好 / 配色
2 学习层   scripts/learn-*          从 data/ 提炼标题句式、版式特征、人群标签
1 采集层   scripts/fetch-*          ego 浏览器抓小红书 / 闲鱼 / 企微截图 OCR
```

**模型分工**

| 环节 | 用谁 |
|---|---|
| 规划、规则、风格判断、文案 | Claude（公司网关） |
| 抓取、批量脚本、跑任务卡 | GPT（Codex 桌面版） |
| 去 AI 味 | `avoid-ai-writing` 技能，不够接 Gemini |
| 文生图 | `qwen-image-3.0`（公司网关，已实测） |

**平台区分**

| | 小红书 | 闲鱼 | 公众号 |
|---|---|---|---|
| 调性 | 不油腻、不偷袭 | 直给，像个人卖家 | 深度、可信 |
| 好坏信号 | 思敏企微红勾 / 单独截出 | 想要人数 | 阅读/在看 |
| 价格表达 | 不说具体折扣，可说「便宜管饱」 | 可说具体 | 可说具体 |

**帖子 JSON 格式**（`data/xhs/<id>.json` 和 `data/xianyu/<id>.json`）

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
| D3 | Claude 规划 + 纠偏，Codex 执行，lilith 拍板 |
| D5 | 抓取用 Codex 操控 ego 浏览器（已登录态），不用接口爬虫 |
| D7 | 闲鱼好坏用「想要数」；小红书好坏用思敏企微红勾 / 单独截出 |
| D9 | 文案 = Claude；批量执行 = GPT；去AI味 = avoid-ai-writing 技能；图 = 公司网关图像模型 |
| D10 | 价格区块词：允许「便宜管饱」「便宜量大」「活动价」；禁具体折扣和金额 |
| D14 | 思敏偏好以 `skills/simin-persona/SKILL.md` 形式沉淀 |
| D16 | 允许改 Hanabi，接 content-ops 生成脚本，不重构整个项目 |
| D18 | 小红书与闲鱼都禁 API；旧样本和 T13 旧示例不构成放行依据 |

---

## 3. 开放问题

| # | 问题 | 状态 |
|---|---|---|
| Q7 | D10 允许「便宜管饱」，但 2026-10-30 18:55 禁「量大管饱」；口径是否统一扩展？ | 开放：生成先用便宜量大/活动价，等 lilith 决定 |
| Q8 | 企微更早历史尚有缺口，未读取到 2024 年记录 | T17-C 已补采 77 屏并复查到客户端当前最早可加载端（2026-10-15 14:18）；更早历史未证明不存在 |
| Q9 | 公司网关余额约 0.05，Qwen 单次预扣 0.25，新背景生图受阻 | 阻塞中：补充额度后可用「生成新背景」 |

历史已关闭问题见 `docs/01-决策记录.md`。

---

## 4. Hanabi 怎么用

本机地址：`http://127.0.0.1:6187`（后台 LaunchAgent 已安装，关终端不影响）。

**生成小红书图文**
1. 点左上「Hanabi／内容工作台」→ 展开「生成小红书图文」
2. 填模型名（如 `GLM5.3`）、平台选「小红书」、数量填 `2`
3. 背景选「复用已有背景 · 本机换色排版」（当前网关余额不足，新背景会失败）
4. 点「生成图文」，约 1 分钟
5. 完成后可复制文案、保存图片、进入燃放预览
6. 「历史批次」可找回已保存结果；「另做一批」开新请求

**换电脑**：从 `releases/Hanabi-2026-11-01-mac-arm64.zip` 解压，运行「配置公司网关.command」填入公司 Key，双击「启动Hanabi.command」（若弹安全警告：`xattr -dr com.apple.quarantine <解压目录>`）。个人数据库和附件不含在包里。

**文件位置**

| 项目 | 路径 |
|---|---|
| content-ops 源码与规则 | `~/Desktop/content-ops`（Git 同步） |
| Hanabi 最新开发源码 | `~/Documents/ChatGPT/【探索】/content-alchemy` |
| Hanabi 运行副本 | `~/Library/Application Support/Content Alchemy/runtime` |
| 生成成品 | `~/Library/Application Support/Content Alchemy/content-ops/outputs/<日期>/hanabi/<批次ID>/` |
| 数据库与图片附件 | `~/Library/Application Support/Content Alchemy/library.sqlite` + `uploads/` |

---

## 5. 生成脚本与网关配置

**首次配置**
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp config/gateway.env.example work/gateway.env
chmod 600 work/gateway.env
# 编辑 work/gateway.env，填入 CONTENT_OPS_API_KEY / BASE_URL / IMAGE_MODEL
```

**生成**
```bash
# 复用本机缓存背景（当前推荐）
python3 scripts/gen-xhs-post.py --model GLM5.3 --platform xhs --count 2 \
  --background data/images/backgrounds/company-qwen-2026-11-01.png

# 有额度时生成新背景
python3 scripts/gen-xhs-post.py --model GLM5.3 --platform xhs --count 2

# 续跑失败批次
python3 scripts/gen-xhs-post.py --model GLM5.3 --count 2 --resume \
  --background data/images/backgrounds/company-qwen-2026-11-01.png
```

**偏好版本**：生成脚本优先读 `data/distilled-preferences.json`，日志输出 `preferences_loaded`，manifest 保存来源、日期、版本和 SHA256。缺包时会明确警告并回退旧来源；损坏或超长包会在收费调用前失败，不截断硬规则。可用 `--preferences <文件>` 指定路径，用 `--preference-max-chars` 调整上限。部分失败批次续跑要求同一偏好哈希，已完成历史保持原版本。Hanabi provider 行显示当前偏好版本。安装/打包脚本会同步偏好包，源规则改动后先蒸馏再安装。

2026-11-02 本机验收使用 `tmp/t14-neutral-test-background.png` 浅灰测试底图，不代表恢复了旧公司背景或调用了新生图。跨机缺少缓存时 `cachedAvailable=false`；新背景仍受 Q9 限制。当前三栏页面的旧 `app.js` 有缺失旧 DOM 的初始化错误；T14 provider 状态独立可读，完整工作台由后续卡处理，不能据版本显示推断整页生成功能已验收。

**文生图（单独调用）**
```bash
python3 scripts/gen-image.py \
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

先安装 `requirements.txt` 到 `work/.venv`。在仓库根目录按顺序运行：

```bash
python3 scripts/clean-xhs-data.py --report tmp/clean-xhs.json
python3 scripts/parse-audience.py --report tmp/audience.json
python3 scripts/clean-xianyu-data.py --report tmp/clean-xianyu.json
python3 scripts/distill-preferences.py
```

清洗只增加 `signal`、解析有明确列表的 `audience`；不改帖子原文、好帖标签或最新 wants。`_notes-index.json` 是另一抓取时点的导航快照，不参与清洗和互动分层，以单帖 JSON 的 `metrics` 为准。闲鱼 `_ranked.md` 仅为缺失 wants 提供按 ID 回填的依据，排序并列按 ID 字典序。

清洗阈值、扫描字段和输入目录见 `config/data-cleaning.json`。风险检测扫描正文、封面 OCR 和标签；标题等字段仅提供模型范围上下文。`--input-dir`、`--output-dir` 可处理副本，`--dry-run` 只报告，`--rules` 可指定词库。人群 raw 只有标题时不补造列表。

偏好包 `data/distilled-preferences.json` 是可重建缓存，来源仍是 `rules/` 与 `skills/`。`config/preference-build.json` 指定来源与引用数量，脚本保留来源哈希、引文、正则和模型范围；默认日期取 persona 证据版本，也可传 `--date YYYY-MM-DD`。不要直接修改缓存。源规则更新后先重跑清洗，再重建偏好包。第二轮应显示 `changed=0`（清洗）或 `changed=false`（偏好包）。GPT 执行提取与检查，Claude 负责偏好、风格和文案判断。

---

*原始详细文档保留在：`01-决策记录.md`（完整决策列表）。其余 00/02/03/gateway/hanabi/xhs-generation 内容已并入本文件，可归档。*
