# 系统操作手册

> 本手册是工程架构、角色协作、操作入口、网关配置与仓库治理的唯一说明。业务写稿和做图规则见 `rules/content-spec.md`；原料库事实源仍由对应源文件维护。

## 角色与系统边界

系统按四元角色协作：Lilith 是最终业务拍板人；规划 agent 负责需求拆解、规则维护和风格终审；执行 agent 负责代码、脚本、抓取和单任务自验，不绑定单一模型；批量 agent（Hanabi）是批量图文、素材管理与可视化中枢。模型是可替换的工具，不等同于角色。

仓库按层组织：`data/` 保存帖子、来源索引和经过去敏的反馈；`rules/` 保存机器规则和内容生产规范；`skills/` 保存可复用提示与方法；`scripts/` 提供 fetch/build/generate/check CLI；`hanabi/` 是本机工作台；`outputs/` 保存交付物；`scratch/` 放密钥、虚拟环境和临时中间态。Hanabi 的 `/v1/*` 路由只做网关透传，不注入业务规则或上下文；业务逻辑放在生成脚本或专用业务 API。

抓取只覆盖人工书签、置顶和明确关键词补充，不全站抓取。单账号每分钟最多 10 个浏览器动作，每 50 条休息 5 分钟；支持断点续抓，验证码或登录失效立即停止。企微原文与截图仅存本机 `data/wecom/raw/`，提交内容仅保留去敏提炼。

## 工作台日常操作

启动方式：在仓库根目录运行 `./start.command`，或在 Finder 双击。默认服务地址为 `http://127.0.0.1:6187`。主导航提供生成图文、素材库、原料库、操作规范。文档内容由白名单 API 实时读取仓库源，不保存第二份副本。

生成图文页面设置模型名、平台、图片数、封面风格、文案结构与每图文案数，可填写简报并选择素材。新批次依次调用文案、视觉提示词和图像阶段；视觉阶段读取最多 3 张本地参考封面，图像阶段按平台尺寸生成完整海报。续跑依 manifest 与来源哈希判定，不重复已完成收费阶段。成稿仍需规划 agent 做事实、合规和视觉复核，未经复核不发布。

素材库直接维护 `data/posts.jsonl`：支持图文、纯图、纯文录入，编辑、删除、封面维护及人工模型/版式/精选标签；图片保存在 `data/images/<platform>/<id>/`。未人工标注的模型与版式分类由服务端即时派生，不建映射副本。删除前确认，JSONL 与图片更新由存储层锁和回滚保护。

原料库包含运营偏好和风险词库。两者只增不删：运营偏好基于 persona 标准、反例和已去敏反馈摘录；风险词直接追加到 YAML。新增条目会保存源数据并调用规则提炼分析模型，打开操作规范确认面板。也可在原料库或操作规范点击「同步原料库」进行全量比对。确认后写入 `rules/content-spec.md`、重建偏好包并提交；取消只放弃规范草案，不回滚已成功保存的原料。修改建议可多轮重新分析。

操作规范下提供《内容生产规范》《系统操作手册》和只读《模型语料库》。内容生产规范是业务规则唯一文档；系统手册只说明操作和工程治理；语料库供创作参考，不覆盖事实或规范。

## 本机网关与模型配置

唯一持久配置为本机忽略文件 `scratch/gateway.env`，模板为 `config/gateway.env.example`。配置不得提交或写入日志。接口弹窗支持：

| 字段 | 环境变量 | 用途 |
|---|---|---|
| 文案写稿模型 | `CONTENT_OPS_TEXT_MODEL` | 生成文案 |
| 视觉提示词模型 | `CONTENT_OPS_VISION_MODEL` | 读取参考封面并编写视觉提示词 |
| 文生图模型 | `CONTENT_OPS_IMAGE_MODEL` | 生成完整海报 |
| 规则提炼分析模型 | `CONTENT_OPS_ANALYSIS_MODEL` | 原料库到内容生产规范的草案分析 |

`CONTENT_OPS_BASE_URL` 为 HTTPS 网关地址，`CONTENT_OPS_API_KEY` 为本机密钥。模型 ID 按网关实际权限填写。分析模型只由 `/api/content-ops/spec-sync/*` 专用业务模块调用；通用 `/v1/*` 透传保持原样。连接测试不测试生图权限。

## CLI 与数据构建

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

当前帖子唯一源为 `data/posts.jsonl`；风险规则唯一源为 `rules/banned-words-quick.yaml`；运营偏好事实源为 `skills/simin-persona/SKILL.md` 和 `data/wecom/simin-feedback.jsonl`。模型语料库唯一源为 `data/model-corpus.md`。不要编辑派生包代替源文件。

## 一份事实一个文件与 D20 闸门

同一事实只保留一个可编辑源。索引、缓存或导出物必须注明源和重建命令，通过 doctor 验证，并且可删除后重建。不要为一份规则复制第二份内容；能力扩展优先添加已有 CLI 子命令，不复制 v2 入口；历史重大变更写入 `docs/CHANGELOG.md`，完整 Git 历史留在版本库。

提交前运行 `python3 scripts/doctor.py`，退出码必须为 0。它检查跟踪文件数、总字节、单文件上限、完全重复文件、层入口白名单和 `scratch/` 体量。预算唯一配置为 `config/repo-budget.json`；如确需调整，必须同时在本手册说明原因并记录于现行决策表。

工作台编辑器和规范同步使用仓库锁、版本哈希、原子替换、构建校验和 Git 提交。操作前若受影响的规范源存在未提交改动，服务会拒绝自动提交；先由负责人审核并提交已有工作，再从工作台操作。提交信息使用中文；阶段完成后按协作约定推送。

## 关键工程决策

| 决策 | 当前执行口径 |
|---|---|
| 仓库与入口 | 私有 Git 仓库；每台电脑使用统一目录；每项能力沿用既有 CLI、服务或 Hanabi 入口。 |
| 界面边界 | Hanabi 只做工作台，不重写为独立生成架构；`/v1/*` 是纯透传。 |
| 模型职责 | 文案、视觉、图像、规则提炼模型分别配置；风格终审由规划 agent 负责。 |
| 数据隐私 | 企微原始聊天只留本机，版本库只收去敏后的证据与规则。 |
| 偏好模型 | Persona 是可读可审的 SKILL.md，不训练私有模型；偏好包是派生缓存。 |
| 语料库 | `data/model-corpus.md` 是唯一创作案例语料源，Hanabi 只读展示，生成链路按配置读取。 |
| 拒绝方案 | 不全站抓取、不将 Hanabi 网关层塞入业务 prompt、不复制应用包作为第二套源；旧角色名称按四元分工映射。 |
