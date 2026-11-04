# 生成链路解防御与简报贯通 · 规划复核交付

日期：2026-11-03（Asia/Shanghai）。执行范围：用户本轮派发的生成、自动参考、Hanabi 简报及验收；本报告供规划 agent 复核。功能与实测已完成，规划复核、仓库闸门与提交推送尚未完成；未发布内容。

本报告是代码与验收证据的派生交付物。事实源为下列代码、实测 manifest/成稿及 scratch 验证记录；更新时按本文命令重新验收，再据对应日志更新本报告。涉及付费的真实生成不自动重跑；原始产物保留在独立批次目录。

## 核心代码 Diff 摘要

| 文件 | 本轮具体修改 |
| --- | --- |
| `scripts/lib/copy.py` | 将 Draft → Review → Fact Review 三段代码改为一次 `claude_call`，随后只做本地 JSON/版式/风险词检查；移除要求删除具体功能卖点、强改读者试用建议的二、三轮 Prompt。保留响应原文和一次调用用量，不自动重试付费请求。 |
| 同上 | 删除标题首行动词枚举校验，以及正文“我/亲测/实测/用下来”触发 ValueError 的正则。删除固定 `AUDIENCE`，使用模型返回的场景人群；现有风险词库继续检查全部对外文字。 |
| 同上 | 两套 `cover()` 布局使用模型返回的 `cover_subtitle`、`cover_highlight`；旧稿兼容回退为稿件标题卖点/受众。移除“先拿一个真实任务试试”“写清限制 → 检查结果”等固定封面文案。 |
| 同上 | 未指定 references 或指定空数组时，从 `data/posts.jsonl` 自动选择同平台最多3篇，优先人工 good/高互动分级，再看型号相关性、点赞或想要。手选优先。原帖标题/正文/OCR以 `few_shot_examples` 进入同一次生成请求，记录实际来源及哈希；学习标题节奏、分段和痛点切入。 |
| `hanabi/index.html`、`hanabi/styles.css` | 新增 `textarea#content-ops-brief`，使用用户指定的完整占位文案、多行输入和1000字上限。 |
| `hanabi/lib/content-ops-ui.mjs` | 表单请求携带 brief，批次历史恢复并转义回显原文。`hanabi/app.js` 已导入这个控制器，因此本轮改动落在实际控制器中。 |
| `hanabi/lib/content-ops-production.mjs` | 接收/校验/持久化 brief，兼容迁移旧 SQLite；以独立 `--brief` argv、`shell:false` 传入现有 `scripts/generate.py copy`。同 requestId 不同 brief 返回409；恢复批次保留需求。临时引用文件落入 scratch。 |
| `scripts/lib/test_pipeline.py`、`hanabi/lib/content-ops-production.test.mjs`、`hanabi/package.json` | 补充离线生成与端到端参数集成回归，纳入 npm test。 |
| `skills/xhs-post-generation/SKILL.md`、`data/distilled-preferences.json`、`docs/GUIDE.md`、`README.md`、`TODO.md`、`docs/CHANGELOG.md` | 更新现行用法、复用方法和进度，偏好包由现有 `python3 scripts/build.py distill` 重建；再次构建 changed=false。 |

任务开始前代码快照与本轮补丁在 `scratch/t37/before/`、`scratch/t37/copy.py.patch`、`scratch/t37/content-ops-production.mjs.patch`。工作区还包含此前分层收口改动和他人更新的任务管理方式，普通 git diff 不是本轮独立 Diff；这些外部改动未由本轮提交或覆盖。`hanabi/server.mjs` 的 `/v1/*` 透传路由未改。

## 真实生成与来源

实际执行命令（本轮只执行一次真实文字生成）：

```bash
python3 scripts/generate.py copy \
  --model 'Kimi K3.1 Pro' --count 1 \
  --brief 'Kimi K3.1 Pro 编程与长程 Agent 全面升级，支持 100 万超长上下文，成本低便宜量大，适合程序员和独立开发者。' \
  --output outputs/2026-11-03/t37/kimi-brief \
  --background scratch/t14-primary-final/background-1.png
```

真实结果为 completed；实际写稿模型 claude-sonnet-4-6，文字调用1次，输入7428、输出359、合计7787 token。封面复用指定旧背景，在本机换色排版为1080×1080；本轮图片模型调用0次，不把复用背景当作新生图。

自动选中3篇小红书帖子（均为人工 good，不以低点赞冒充高热度）：

| ID | 标题 | 点赞 |
| --- | --- | --- |
| 6ae04e58000000001601b3e9 | Kimi K3.1 Pro便宜入不烧心！ | 1 |
| 6ae055f3000000001503ba84 | 冲！Kimi K3.1 Pro重磅来袭！ | 0 |
| 6ae19a71000000003501e174 | 挖到宝了🤯Kimi K3.1 Pro好价来袭！ | 0 |

唯一原始语料源为 `data/posts.jsonl`。具体参考 ID、每条来源哈希、brief_source=user_provided、generation_pipeline=single_pass_v1、reference_mode=automatic 和计费返回均在本次 [manifest](kimi-brief/manifest.json)。用户简报用于创作，未冒充独立产品事实核验。

## 修改前与修改后：真实成稿对照

**对照边界：**旧稿是历史 GLM5.3 输出，新稿是本轮 Kimi 输出，型号和输入不同，不能当同输入受控 A/B。检查到修改前代码有3段模型调用；所选历史旧稿的 manifest 记录为2次调用，不把代码轮数套到历史样本上。

旧稿原件：`scratch/t14-primary-final/post-1.md`。典型摘录：

> 速来体验！ · GLM5.3 · 可以试试电商脚本和短视频文案
>
> ✅ 验证能否生成商品详情页文案
> ✅ 测试写短视频脚本和口播稿
>
> 建议先拿几个常见场景跑一跑，看看输出质量是否符合你们的投放标准。
>
> 开发者们，可以先用一个真实任务试试，看看能不能适配内容生产流程。

旧稿受众固定为“电商商家、广告工作室、短视频创作者”。

本轮新稿原件：[完整真实成稿](kimi-brief/post-1.md)，保留模型原始输出，未人工替换。摘录：

> 100万上下文，长任务不崩不断 · Kimi K3.1 Pro · 编程+Agent双升级，便宜量大
>
> 写过复杂项目的都懂那种崩溃感——
> 上下文一满，模型开始「失忆」，前面写的逻辑全白费 😮‍💨
>
> Kimi K3.1 Pro 这次直接给到 100万超长上下文
>
> 💰 成本友好，便宜量大，高频调用也扛得住

本次模型返回受众为“独立开发者、程序员、搭建 Agent 流水线的技术用户”，不再由固定全局常量覆盖。封面副标题与亮点见 [copy.json](kimi-brief/copy.json)；[真实封面](kimi-brief/post-1.png) 已目视检查，文字可读、未发现裁切。

## 验证结果与复跑入口

统一日志：[validation.log](validation.log)。详细原始记录与截图在 `scratch/t37/`。

| 验证 | 命令/证据 | 结果 |
| --- | --- | --- |
| Python 回归 | `PYTHONPATH=scripts scratch/.venv/bin/python3 -m unittest lib.test_pipeline -v` | 18项通过；单调用、自动/手选参考、宽松开场与第一人称、动态人群、所有封面文字风险检查、brief校验、续跑输入一致性。 |
| Hanabi Node 集成与语法 | `npm --prefix hanabi test` | 2项通过；旧库新增brief字段、多行Unicode独立argv、持久化、409去重、历史转义。 |
| 素材库/生产回归 | `node scratch/t36/node-regression.mjs` | 398帖（小红书364/闲鱼34）、454图；模拟生成completed，付费0次。 |
| 真实正文禁词 | `python3 scripts/check.py words --file outputs/2026-11-03/t37/kimi-brief/post-1.md --platform xhs --model 'Kimi K3.1 Pro' --json` | `[]`，退出码0。 |
| 全部可见文字禁词 | 由manifest取标题/正文/标签/受众/封面副标题/封面亮点，传入同一check words命令的 `/dev/stdin` | `[]`，退出码0；详细命令在validation.log。 |
| 浏览器表单与回显 | ego-browser，6198隔离服务；`browser-check.json`、`brief-form.png`、`brief-result.png` | 实际textarea能输入，POST携带完整brief，结果回显，未横向溢出。浏览器拦截POST返回真实成稿的展示夹具，不代表又调用了一次模型。 |
| HTTP错误输入 | `http-validation.log` | 非字符串、超1000字、控制字符均400，未创建批次、未计费。 |
| 偏好包 | `python3 scripts/build.py distill` | 重建后再跑changed=false。 |
| 差异空白检查 | `git diff --check` | 退出码0。 |
| 仓库闸门 | `python3 scripts/doctor.py` | 退出码1；详见validation.log与现有Q11。 |

独立6198验收服务已停止；现有6187常驻服务未重启。修改位于源码，部署/重启不在本轮验收内。

## 待规划复核的具体表述与仓库阻塞

本次模型保留了用户要求的长上下文、编程/Agent升级、成本与程序员受众，但也扩写了“长任务不崩不断”“不截断不失忆”“闭环自动执行，不用人盯”“推理更稳/逻辑链路不跑偏”。这些表述没有本轮提供的独立证据。基础禁词检查通过不代表这些性能承诺成立；本报告保留原始输出供规划复核，未将它标为事实已核验或批准发布。未再引入第二、三轮模型审查。

仓库闸门仍因既有数据迁移保留与预算冲突失败：398条JSONL约811KB超过400KB单文件限制，旧索引740项差异使旧源暂不能删，跟踪文件/总字节及scratch亦超预算。预算未修改、旧源未删除，未绕过doctor，未提交或push。详情参见 `docs/GUIDE.md` Q11。

未找到可明确识别的规划 agent 接收会话，本报告作为可直接复核的交付文件提供给当前派发方，未声称已向未知会话发送消息。
