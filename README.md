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
| 更新日期 | 2026-11-05 |
| 阶段 | 原料库与操作规范重构、分析模型同步确认闭环已完成；生成与预览工作台、素材库 CRUD、三阶段多模态链路及平台/合集筛选已验收；本轮完成自定义合集、全量加载、标题大纲与持久化拖拽排序，并修复文案微超自动修剪与视觉模型错误提示；真实生成结果仍交规划 agent 复核，未发布 |
| 文案配比 | 支持三种结构或全套轮替；默认每图3篇，可调1–5；多文案Tab与当前版本复制、旧批次单文案兼容；契约见 GUIDE「文案结构与图文配比」 |
| 标题与版式 | 结构模板见 `skills/xhs-title-patterns/`；统一规范见 `rules/content-spec.md` |
| 图像通路 | 新图由 qwen-image-3.0 直出完整海报；小红书 1080×1440、闲鱼 1080×1080；Pillow 仅显式 `--background` 离线兜底 |
| 风险词 | 唯一源见 `rules/banned-words-quick.yaml`；小红书和闲鱼都禁 API，所有平台对外内容禁写境外模型名（D18、D19） |
| 闲鱼数据 | 来源于 `data/posts.jsonl`（platform=xianyu） |
| 运营偏好 | 提炼自企微运营反馈，详见 `skills/simin-persona/SKILL.md` |
| 使用者 | lilith 一人；做顺了同事（阮思敏，运营）会用 |
| 生成脚本 | 文案模型只写文案；视觉模型读取最多 3 张本地参考封面并产出独立视觉 Prompt；图像模型按平台规格直出完整海报。本机文案/视觉均为 `claude-sonnet-4-6` 的独立调用，图像为 `qwen-image-3.0`，已读取3张真实封面并生成1080×1440海报 |
| 界面 | 生成与预览合为双栏工作台，导航为生成图文、素材库、原料库、操作规范。原料库含运营偏好与风险词库（只增不删）；规范同步支持分析、建议重分析、确认/取消。模型配置读写本机 `scratch/gateway.env`，含文案、视觉、生图与规则提炼分析模型。文档由白名单 API 实时读取仓库源文件 |
| 本轮进展 | 398 帖仍以 `data/posts.jsonl` 为唯一源；本轮文案结构与图文配比通过Python29项/Node24项离线回归；doctor与界面验收见TODO。三阶段实测日志与成图见 `outputs/2026-11-04/three-stage-reviewed/`，未人工标注的版式分类为OCR/标题启发式，需人工核图 |
| 最近内容交付 | T28：Kimi闲鱼双方图中段沿品牌黑白灰＋蓝色；顶部型号/价词设专属黄粉紫、朱红暖黄，不扩散至场景。占位与卖点保留，预设色值对比4.882—12.238:1。未生图或做平台检测，详见 [T28任务卡](docs/CHANGELOG.md) 和 [闲鱼方图提示词](outputs/2026-11-03/kimi31-xianyu-square-prompts.md) |
| Hanabi 程序包 | 源码即仓库内 `hanabi/`，双击或运行 `start.command`；不再发布 ZIP（旧 ZIP 是 app 与 content-ops 双份副本，已删），说明见 [hanabi/releases/README.md](hanabi/releases/README.md) |

## 目录

```
README.md              入口（你在这）
AGENTS.md              agent 工作规矩
data/                  原始数据（进 git）
  sources/             素材来源账号与置顶链接（选材口径见内容规范）
  posts.jsonl          398 帖（小红书364、闲鱼34）；当前唯一帖子源，旧目录已收口
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
