# content-ops · 内容运营中枢

一句话：小红书 / 闲鱼 / 公众号的素材库 + 规则库 + 生成流水线。
分工：Claude 规划与纠偏，Codex 执行，lilith 拍板。

## 任何 agent 接手前先读这四个文件（3 分钟）

1. 本文件：是什么、现状、目录。
2. `docs/01-决策记录.md`：已经定了什么、否决了什么。**不要翻案**，要翻先问 lilith。
3. `tasks/README.md`：进度表，哪张卡在做、卡在哪。
4. `AGENTS.md`：干活规矩，尤其是「接到新需求怎么办」。

## 现状

| 项 | 值 |
|---|---|
| 更新日期 | 2026-11-02 |
| 阶段 | T17、T13、T14 完成；当前 T15，之后 T18→T19→T20（T16 已完成） |
| 标题与版式 | 12 条样本，5 组开场 / 卖点 / 模板；真实封面取色，Claude 已校核 |
| 图像通路 | 公司 qwen-image-3.0 已实测出图；本机令牌配置见 docs/gateway-image-usage.md |
| 风险词 | 21 条 quick 规则；偏好包保留正则与模型范围，小红书和闲鱼都禁 API（D18） |
| 闲鱼数据 | 34/34 想要数已于 2026-11-02 刷新，最高 379；无 null |
| 思敏偏好 | 15 标准、8 反例、29 行引文、25 条 good；补采 77 屏到当前可加载最早端 2026-10-15，早期缺口见 Q8 |
| 使用者 | lilith 一人；做顺了同事（阮思敏，运营）会用 |
| 生成脚本 | GLM5.3 两套 + Kimi 一套已产出；缓存背景可用，新图需充值，见 docs/xhs-generation-usage.md |
| 界面 | Hanabi 6187 provider 已实测显示偏好 v1（2026-11-02）；当前三栏页旧 app.js 初始化错误待后续卡处理，见 docs/GUIDE.md |
| 本轮交付 | T14：生成脚本接入统一偏好包，版本写入 manifest，缺包回退可生成，Hanabi 显示偏好版本；详见归档任务卡 |
| Hanabi 程序包 | T12 完成：releases/ 下完整 ZIP；根目录可双击启动Hanabi.app（Apple Silicon）；源码快照可随 Git 同步，见 [打包说明](releases/README.md) |

## 这个项目不是什么

- **不是 Hanabi 的重写。** Hanabi 被写死了，接不住新需求。备份在 `~/Desktop/Hanabi完整备份_2026-10-27`，按 D16 / T11 只改必要的接口与表单，接入独立脚本。
- **不是一个大应用。** 它是一堆小而独立的能力（抓、学、查、写、画），用文件连起来。每个能力单独可用、单独可换。新需求来了加一张任务卡和一个脚本，不改架构。

## 目录

```
README.md              入口（你在这）
AGENTS.md              agent 工作规矩
data/                  原始数据（进 git）
  sources/             素材来源账号与置顶链接（先看这个）
  xhs/                 小红书帖子 JSON
  xianyu/              闲鱼帖子 JSON
  wecom/               企微聊天提炼
  images/              图片（不进 git，按 JSON 重下）
  reference-posts.json 好帖与高想要帖子索引（25 + 14）
rules/                 规则库
  platform-rules.md    小红书 / 闲鱼 / 公众号各自能说不能说
  design-rules.md      大字报配色、层次、字号规则
  banned-words-quick.yaml  禁用词 + 替换词
  cover-palettes.json  封面配色方案
  README.md            规则使用说明
skills/                可复用方法（SKILL.md 格式）
  simin-persona/       思敏偏好（15 标准 + 8 反例）
  xhs-title-patterns/  标题句式（12 样本 + 5 组模板）
  xhs-post-generation/ 生成指导
scripts/               生成脚本
  gen-xhs-post.py      小红书图文生成主脚本
  gen-image.py         文生图 API 调用
  check-banned-words.py 风险词检查
  README.md            脚本使用说明
outputs/               生成成品（按日期分目录）
releases/              打包发布物
  Hanabi-macOS-arm64.zip  完整程序包
  README.md            打包说明
docs/                  文档
  00-需求原文.md
  01-决策记录.md        定了什么、否了什么
  02-架构.md
  03-开放问题.md
  gateway-image-usage.md  公司网关配置
  xhs-generation-usage.md 生成脚本使用
  hanabi-usage.md       Hanabi 使用说明
  诊断-2026-11-01-质量问题.md
  修复总结-2026-11-01.md
  文件夹整理方案.md
tasks/                 任务卡
  README.md            进度表
  T01-T12-*.md         任务卡
work/                  工作文件（不进 git）
  gateway.env          公司网关配置
  .venv/               Python 虚拟环境
  tests/               测试文件
```

## 换电脑

```bash
cd ~/Desktop && git clone https://github.com/gfdtgfgfgd-coder/content-ops.git
```

私有仓，需要 `gh auth login` 登录 gfdtgfgfgd-coder 账号。所有电脑都克隆到 `~/Desktop/content-ops`，路径统一，任务卡里的路径才不会断。每次换电脑前 `git push`，到新电脑先 `git pull`。
图片不进 git，`scripts/` 里会有按 JSON 重下图片的脚本（T02 产出）。

## 相关资产（都在本机，不在本仓库）

| 资产 | 位置 | 用途 |
|---|---|---|
| Hanabi 备份 | `~/Desktop/Hanabi完整备份_2026-10-27` | 小红书读取、OCR、资料库代码参考 |
| 价格监控站 Model Price Watch | `~/Documents/ChatGPT/【市场调研】/model-price-monitoring`，本地 3100 端口 | T07 接入为一个技能 |
| Obsidian 总纲 | `~/Documents/Obsidian Vault/AI市场运营工作台.md` | 公司业务线、渠道、节奏 |
| Codex 技能 | `~/.codex/skills/`：avoid-ai-writing、lieflat-less-ai-tone、gzh-design-skill、md2wechat、agent-reach | 去 AI 味、公众号排版，直接复用 |
| 浏览器 | ego-browser（登录态）、opencli | 抓小红书 / 闲鱼 |
| 模型网关 | `~/.codex/config.toml` 里的 custom provider（公司网关） | 所有模型调用走这里 |
