# content-ops · 内容运营中枢

小红书 / 闲鱼 / 公众号的素材库 + 规则库 + 生成流水线。
分工：Claude 规划与纠偏，Codex 执行，lilith 拍板。

## 接手前先读（3 分钟）

1. 本文件：现状表 + 目录。
2. `docs/01-决策记录.md`：定了什么、否了什么。**不要翻案**，要翻先问 lilith。
3. `tasks/README.md`：进度表，哪张卡在做、卡在哪。
4. `AGENTS.md`：干活规矩，尤其是「接到新需求怎么办」。
5. `docs/GUIDE.md`：架构、用法、网关配置、脚本命令的完整说明。

## 现状

| 项 | 值 |
|---|---|
| 更新日期 | 2026-11-03 |
| 阶段 | T17、T13、T14、T15、T18、T19、T20、T21、T22、T23、T24、T25、T26、T27 完成；下一张 T09（T16 已完成） |
| 标题与版式 | 12 条样本，5 组开场 / 卖点 / 模板；真实封面取色，Claude 已校核 |
| 图像通路 | 公司 qwen-image-3.0 已实测出图；配置见 docs/GUIDE.md |
| 风险词 | 21 条 quick 规则；偏好包保留正则与模型范围，小红书和闲鱼都禁 API（D18） |
| 闲鱼数据 | 34/34 想要数已于 2026-11-02 刷新，最高 379；无 null |
| 思敏偏好 | 15 标准、8 反例、29 行引文、25 条 good；补采 77 屏到当前可加载最早端 2026-10-15，早期缺口见 Q8 |
| 使用者 | lilith 一人；做顺了同事（阮思敏，运营）会用 |
| 生成脚本 | GLM5.3 两套 + Kimi 一套已产出；缓存背景可用，新图需充值，见 docs/GUIDE.md |
| 界面 | Hanabi 6187 已精简为生成图文、素材库、思敏偏好、风险词、预览五页；素材库可浏览398帖、454图 |
| 本轮交付 | T27：撤回抽象中段，Kimi闲鱼1:1双图改为真实Kimi标牌＋编程/网页预览、Kimi标牌＋休闲椅3D作品/建模画面，保留固定占位及模型服务卖点。未生图、未做平台检测，详见 [T27任务卡](tasks/archive/T27-Kimi品牌主体纠偏.md) 和 [闲鱼方图提示词](outputs/2026-11-03/kimi31-xianyu-square-prompts.md) |
| Hanabi 程序包 | T19 精简版源码与本地 ZIP 已生成；打包说明见 [hanabi/releases/README.md](hanabi/releases/README.md) |

## 目录

```
README.md              入口（你在这）
AGENTS.md              agent 工作规矩
data/                  原始数据（进 git）
  sources/             素材来源账号与置顶链接
  xhs/                 小红书帖子 JSON（364 条）
  xianyu/              闲鱼帖子 JSON（34 条）
  wecom/               企微聊天提炼（raw/ 不进 git）
  images/              图片（不进 git，按 JSON 重下）
  reference-posts.json 好帖与高想要帖子索引（25 + 14）
rules/                 规则库
  platform-rules.md    小红书 / 闲鱼 / 公众号能说不能说
  design-rules.md      大字报配色、层次、字号
  banned-words-quick.yaml  禁用词 + 替换词
  cover-palettes.json  封面配色方案
skills/                可复用方法（SKILL.md 格式）
  simin-persona/       思敏偏好
  xhs-title-patterns/  标题句式
  xhs-post-generation/ 生成指导
scripts/               生成脚本
  gen-xhs-post.py      小红书图文生成
  gen-image.py         文生图 API
  check-banned-words.py 风险词检查
outputs/               生成成品（按日期分目录，按需本机产生）
hanabi/releases/       Hanabi 打包发布物
docs/                  文档
  GUIDE.md             操作手册（架构/决策/用法/网关配置，主入口）
  01-决策记录.md        完整决策列表
tasks/                 任务卡
  README.md            进度表
  T09-人群标签.md      待开始任务卡
  archive/             已完成任务卡
scratch/               工作区（不进 git）
  gateway.env          公司网关配置
  .venv/               Python 虚拟环境
  （抓取脚本与验收中间产物也集中放这里）
setup-new-mac.sh       新电脑一键安装
requirements.txt       Python 依赖
config/                清洗与偏好构建配置（网关模板见 config/gateway.env.example）
```

## 换电脑

```bash
cd ~/Desktop && git clone https://github.com/gfdtgfgfgd-coder/content-ops.git
cd content-ops && zsh setup-new-mac.sh
```

私有仓，需 `gh auth login` 登录 gfdtgfgfgd-coder 账号。所有电脑克隆到 `~/Desktop/content-ops`，路径统一任务卡才不断。换电脑前 `git push`，到新电脑先 `git pull`。图片不进 git，靠 `scripts/` 里的脚本按 JSON 重下。
