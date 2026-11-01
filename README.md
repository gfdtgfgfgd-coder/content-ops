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
| 更新日期 | 2026-11-01 晚 |
| 阶段 | T02 完成，今晚并行做 T03–T11（6 张卡），目标：12–15 小时后 Hanabi 界面能生成小红书帖子 |
| 使用者 | lilith 一人；做顺了同事（阮思敏，运营）会用 |
| 界面 | **改 Hanabi 接入 content-ops 脚本**（D16：推翻 D4"暂不做界面"，今天必须有界面） |

## 这个项目不是什么

- **不是 Hanabi 的重写。** Hanabi 被写死了，接不住新需求。备份在 `~/Desktop/Hanabi完整备份_2026-10-27`，只读，当代码和素材参考，不往里改。
- **不是一个大应用。** 它是一堆小而独立的能力（抓、学、查、写、画），用文件连起来。每个能力单独可用、单独可换。新需求来了加一张任务卡和一个脚本，不改架构。

## 目录

```
README.md            入口（你在这）
AGENTS.md            Codex / 任何 agent 的工作规矩
docs/
  00-需求原文.md      lilith 的原始笔记，原样保留
  01-决策记录.md      定了什么、否了什么、为什么
  02-架构.md          五层结构、模型分工、数据流
  03-开放问题.md      还没定的事，谁来定
tasks/
  README.md          进度表 + 任务卡模板
  T01…T09-*.md       任务卡，Codex 按卡执行
rules/
  platform-rules.md  小红书 / 闲鱼 / 公众号 各自能说不能说
  design-rules.md    大字报配色、层次、字号规则
  banned-words.yaml  禁用词 + 替换词（T05 填充）
data/
  sources/           素材来源账号与置顶链接（先看这个）
  xhs/ xianyu/       抓取的帖子，JSON，进 git
  wecom/             企微记录提炼出的偏好与风险词，进 git；原始截图不进
  images/            图片，不进 git，按 JSON 里的 url 可重下
skills/              沉淀下来可复用的方法（SKILL.md 格式，Codex 和 Claude 都能读）
scripts/             抓取、清洗、生成脚本
outputs/             成品，按日期分目录
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
