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
| 更新日期 | 2026-11-08 |
| 阶段 | 素材引用草稿与历史批次解耦；生成草稿唯一读取 sessionStorage 选区，历史引用只读展示，自动参考收敛为单篇；大字报提示词加入留白、字重和行距量化约束，仍需真实成图视觉验收 |
| 文案配比 | 支持三种结构或全套轮替；默认每图3篇，可调1–5；多文案Tab与当前版本复制、旧批次单文案兼容；契约见 GUIDE「文案结构与图文配比」 |
| 标题与版式 | 结构模板见 `skills/xhs-title-patterns/`；统一规范见 `rules/content-spec.md` |
| 图像通路 | 新图由 qwen-image-3.0 直出完整海报；小红书 1080×1440、闲鱼 1080×1080；Pillow 仅显式 `--background` 离线兜底 |
| 风险词 | 唯一源见 `rules/banned-words-quick.yaml`；小红书和闲鱼都禁 API，所有平台对外内容禁写境外模型名（D18、D19） |
| 闲鱼数据 | 来源于 `data/posts.jsonl`（platform=xianyu） |
| 运营偏好 | 提炼自企微运营反馈，详见 `skills/simin-persona/SKILL.md` |
| 使用者 | lilith 一人；做顺了同事（阮思敏，运营）会用 |
| 生成脚本 | 文案与封面已解耦；自动参考从四大人工合集按平台选 1 篇，手选严格按用户选区；单张海报只看一张结构锚图；视觉模型返回结构、独立短字与同构换装方案，图像模型按平台规格直出完整海报。校验器对结构辅助字段自动推断修复；详见本轮 CHANGELOG |
| 界面 | 生成与预览合为双栏工作台，导航为生成图文、素材库、原料库、操作规范。原料库含运营偏好与风险词库（只增不删）；规范同步支持分析、建议重分析、确认/取消。模型配置读写本机 `scratch/gateway.env`，含文案、视觉、生图与规则提炼分析模型。文档由白名单 API 实时读取仓库源文件 |
| 本轮进展 | 当前49条素材（合集内小红书26条、闲鱼23条），按合集白名单清理316条未分类小红书及316个图片目录，释放32.2MiB；备份留本机，数据提交 `30aeb25` 已推送。编辑支持多图预览、逐张删除、多选/拖拽追加及纯文字保存；OCR默认六行、可纵向拖拽且保留换行。工作区Node45项、Python38项通过；本轮隔离提交版本Node44项、Python36项与doctor通过；编辑保存改为单卡原位更新，深滚动与大纲不再跳顶；新增两项回归，上轮工作区Node47项、Python38项与doctor通过。本轮新增合集选图、四类结构、独立短词风控、断点与旧链路隔离回归；最终验收见 CHANGELOG。生产数据禁止暴力回滚，详情见GUIDE。 |
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
  images/              图片（不进 git，按 JSON 重下）
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
cd ~/Desktop && git clone https://github.com/gfdtgfgfgd-coder/content-ops.git
cd content-ops && ./start.command
```
（或者直接在访达中双击 `start.command`）

私有仓，需 `gh auth login` 登录 gfdtgfgfgd-coder 账号。所有电脑克隆到 `~/Desktop/content-ops`，路径统一任务卡才不断。换电脑前 `git push`，到新电脑先 `git pull`。图片不进 git，靠 `scripts/` 里的脚本按 JSON 重下。
