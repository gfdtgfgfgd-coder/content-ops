# content-ops · 内容运营中枢

小红书 / 闲鱼 / 公众号的素材库 + 规则库 + 生成流水线。
分工：Lilith 拍板，规划 agent 定方向与复核，执行 agent 跑单卡，批量 agent（Hanabi）负责批量图文与可视化中枢。

## 接手前先读（3 分钟）

1. 本文件：现状表 + 目录。
2. `docs/GUIDE.md`：系统架构、操作方法与已确认工程决策；业务写稿规则见 `rules/content-spec.md`。
3. `TODO.md`：待办与演进清单。
4. `AGENTS.md`：干活规矩，尤其是「接到新需求怎么办」。
5. `docs/GUIDE.md`：架构、用法、网关配置、脚本命令的完整说明。

## 现状

| 项 | 值 |
|---|---|
| 最新参考吸收 | 2026-11-09：摸鱼小李六组 3D 实测已入 Kimi 语料；沉淀逆向操作、状态互锁、离线交付验收，追平与价格结论保留待核验。 巧儿三任务样本已吸收：维护选择、状态联动与分阶段用量假说已落档；省 Token 尚无对照实测。 |
| 量子位实测吸收 | 2026-11-09：新增自主迭代过程与交付分层账本，23轮自检等保留作者报告；方法归入炼丹炉，不作我方复测结论。 |
| 更新日期 | 2026-11-09 |
| 发布综述补充样本 | 2026-11-09：追加“王炸登场”供稿，去重既有案例，记录榜单/游戏费用与测评导流边界；方法见炼丹炉模型上新手册。 |
| 本篇知识沉淀 | 2026-11-09：Rhea 深测已并入 Kimi 专节，保留逐项结果与未测边界；独立验收方法写入炼丹炉既有工作流档案。 |
| 最新样本补充 | 2026-11-09：BubbleBrain 发布速览与四项创作小测入库；保留 SVG 弱项、审美主观归属、历史对照条件及金融基准数字差异，方法同步炼丹炉。 |
| 阶段 | 已增加逐张改图与逐篇改文案编辑器、预览采用及历史恢复；素材引用草稿与历史批次解耦；生成草稿唯一读取 sessionStorage 选区，历史引用只读展示，自动参考收敛为单篇；大字报按参考图保留材质与配色，AI 无字底纹结合本机材质与精准排字，不再统一白卡；几何留白和行距由代码锁定 |
| 文案配比 | 支持三种结构或全套轮替；默认每图3篇，可调1–5；多文案Tab与当前版本复制、旧批次单文案兼容；契约见 GUIDE「文案结构与图文配比」 |
| 标题与版式 | 结构模板见 `skills/xhs-title-patterns/`；统一规范见 `rules/content-spec.md` |
| 图像通路 | 大字报先复用/当场反推参考图提示词，再轻改平面装饰生成无营销字底图，Pillow 精确排字；其余版式由图像模型直出完整海报；小红书 1080×1440、闲鱼 1080×1080 |
| 风险词 | 唯一源见 `rules/banned-words-quick.yaml`；小红书和闲鱼都禁 API，所有平台对外内容禁写境外模型名（D18、D19） |
| 闲鱼数据 | 来源于 `data/posts.jsonl`（platform=xianyu） |
| 最新语料吸收 | 2026-11-09：Kimi 发布前 3D 媒体样本并入语料库第 12 节；成本、匿名身份和工业级交付保留待核验，独立于发布稿口径。 |
| 同题对照沉淀 | 2026-11-09：西羊石AI视频五类任务已入 Kimi 语料；记录展示阶段、返工、预演与额度等待，方法同步炼丹炉，结果保留作者报告等级。 |
| 运营偏好 | 提炼自企微运营反馈，详见 `skills/simin-persona/SKILL.md` |
| 使用者 | lilith 一人；做顺了同事（阮思敏，运营）会用 |
| 生成脚本 | 文案与封面已解耦；自动参考从四大人工合集按平台选 1 篇，手选严格按用户选区；单张海报只看一张结构锚图；视觉模型返回结构、独立短字与同构换装方案，图像模型按平台规格直出完整海报。校验器对结构辅助字段自动推断修复；详见本轮 CHANGELOG。四项模型默认值统一读取 `config/gateway.env.example`，本机配置优先。 |
| 界面 | 生成与预览合为双栏工作台，导航为生成图文、素材库、原料库、操作规范。原料库含运营偏好与风险词库（只增不删）；规范同步支持分析、建议重分析、确认/取消。模型配置读写本机 `scratch/gateway.env`，含文案、视觉、生图与规则提炼分析模型。文档由白名单 API 实时读取仓库源文件 |
| 本轮进展 | 2026-11-09：阿颖 Kimi 评价入库，新增 3D 双路径、运行代价与评论证据边界；赛博禅心“秦始皇骑北极熊”及动效文章参考入库，补充作品证明、过程图解与移动端阅读验收；2026-11-09：补入七题功能验收、速度／额度口径及具身推测边界；吸收 Kimi K3.1 Pro 发布供稿与智东西实测文章，区分案例、工具依赖和待核验事实；修复网关断连并自动重试。详见 TODO；另吸收 Kimi 视觉编程参考文，案例保留来源与待复测状态，通用方法归入炼丹炉；新闻综述已补历史评测与权重现状 |
| 最新吸收样本 | 2026-11-09：猿大侠五组视觉编程横测已入库，保留作者分项判断、费用复算与证据缺口；汇总与分项验收方法并入炼丹炉。 |
| 本次知识沉淀 | 2026-11-09：Datawhale Kimi 实测稿已并入模型语料库，补充交付验收、外部工具与人工贡献、吞吐/总量核对及订阅窗口成本边界。 |
| 简单实测吸收 | 2026-11-09：景区漫游与基础排障样本已入库，补充照片外细节核对、测试鉴别力及榜单改题边界；原文数字保留待核验。 |
| 最近内容交付 | T28：Kimi闲鱼双方图中段沿品牌黑白灰＋蓝色；顶部型号/价词设专属黄粉紫、朱红暖黄，不扩散至场景。占位与卖点保留，预设色值对比4.882—12.238:1。未生图或做平台检测，详见 [T28任务卡](docs/CHANGELOG.md) 和 [闲鱼方图提示词](outputs/2026-11-03/kimi31-xianyu-square-prompts.md) |
| Hanabi 程序包 | 源码即仓库内 `hanabi/`，双击或运行 `start.command`；不再发布 ZIP（旧 ZIP 是 app 与 content-ops 双份副本，已删），说明见 [hanabi/releases/README.md](hanabi/releases/README.md) |

## 目录

```
README.md              入口（你在这）
AGENTS.md              agent 工作规矩
data/                  原始数据（进 git）
  sources/             素材来源账号与置顶链接（选材口径见内容规范）
  posts.jsonl          素材唯一源；条数随用户维护变化，不作为固定测试基线
  wecom/               企微聊天提炼（raw/ 不进 git）
  images/              精选参考图（进 git，随修复分支同步）
  reference-posts.json 好帖与高想要帖子索引（25 + 14）
rules/                 规则库
  content-spec.md      内容生产、视觉、平台与素材选用统一规范
  banned-words-quick.yaml  禁用词 + 替换词
  cover-palettes.json  封面配色方案
skills/                可复用方法（SKILL.md 格式）
  simin-persona/       运营偏好（底层事实源）
  xhs-title-patterns/  标题句式
  xhs-post-generation/ 生成指导
scripts/               fetch / build / generate / check 四个 CLI + doctor / OCR
  lib/                 数据、清洗、网关、偏好等内部实现
outputs/               生成成品（按日期分目录，按需本机产生）
hanabi/releases/       换机说明（派生 App 在忽略的 releases/）
docs/                  文档
  GUIDE.md             系统操作手册（架构/决策/用法/网关配置，主入口）
  CHANGELOG.md         已完成任务的完成记录（全文见 Git 历史）
TODO.md                待办与演进清单
scratch/               工作区（不进 git）
  gateway.env          公司网关配置
  .venv/               Python 虚拟环境
  （抓取脚本与验收中间产物也集中放这里）
start.command          一键启动与初始化（支持 Finder 双击）
config/                清洗与偏好构建配置（网关模板见 config/gateway.env.example）
```

## 启动与换电脑

在新电脑克隆仓库后，或日常启动服务：

```bash
cd ~/Desktop && git clone --branch codex/reference-collections-outline https://github.com/gfdtgfgfgd-coder/content-ops.git
cd content-ops && ./start.command
```
（或者直接在访达中双击 `start.command`）

私有仓，需 `gh auth login` 登录 gfdtgfgfgd-coder 账号。所有电脑克隆到 `~/Desktop/content-ops`，路径统一任务卡才不断。换电脑前 `git push`，到新电脑先 `git pull`。精选参考图已进 Git，随 `codex/reference-collections-outline` 分支同步；该分支尚未合入 `main`。
