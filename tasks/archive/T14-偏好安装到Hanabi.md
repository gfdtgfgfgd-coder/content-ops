# T14 · 把清洗后的偏好安装到 Hanabi，让接入的任意 AI 快速上手

执行者：Codex
状态：完成（2026-11-02）
依赖：T13（distilled-preferences.json 已产出）、T11（Hanabi 生成链路已通）
提出：lilith 授权，Claude 规划

## 目标

把 T13 产出的 `data/distilled-preferences.json` 接入 Hanabi 的生成脚本和系统提示，让不管换成 Claude / GPT / Kimi / Gemini 哪个模型，只要调 Hanabi 的生成接口，就自动带上思敏偏好、平台规则、禁词和设计规范——不需要人工把偏好文件名记在脑子里，也不需要每次改 prompt。

成功标准：新建一个接入 GLM5.3 的生成请求，后台日志里能看到 distilled-preferences.json 被加载；产出文案里没有禁词；封面层次符合 design 规则。

## 背景

当前 `scripts/gen-xhs-post.py` 用硬编码路径分别读 simin-persona、quick.md、banned-words-quick.yaml、design-rules.md 四个文件，拼进 system prompt。T13 之后，这四个来源的信息已经合并并去除矛盾，distilled-preferences.json 是唯一权威来源。但脚本还不知道这个文件存在。

Hanabi 前端（`hanabi/lib/content-ops-production.mjs`、`content-ops-ui.mjs`）把模型名、数量、背景模式传给脚本，不传偏好上下文。脚本里当前的偏好加载是硬编码的 4 个文件路径，换一个被接入模型不会自动带上偏好。

## 步骤

### 1. 改生成脚本的偏好加载（45 分钟）

改 `scripts/gen-xhs-post.py`，偏好加载改为：

1. 优先读 `data/distilled-preferences.json`（T13 产出）。
2. 如果该文件不存在，回退到旧的 4 个文件拼接方式（兼容 T13 没跑完时的情况），并在日志里打一行警告：`[WARN] distilled-preferences.json 不存在，回退到分散文件加载，建议先跑 T13`。
3. distilled-preferences.json 存在时，从中提取 system prompt 所需的 6 块内容：
   - `persona.standards`（15 条）
   - `persona.anti_patterns`（8 条反例）
   - `platform_rules.xhs.banned`（禁词列表）
   - `platform_rules.xhs.allowed_price_words`（替换词列表）
   - `title_patterns.openers` + `title_patterns.structures`（句式模板）
   - `design.hierarchy_rules` + `design.cover_palettes`（封面规则）
4. 把这 6 块内容拼成一段结构化的 system prompt 前置块，格式如下（截断到安全 token 数以内）：

```python
PREFERENCE_BLOCK = f"""
=== 思敏偏好（内容审核标准，优先级高于你的默认写法）===

【判断标准 · {len(standards)} 条】
{chr(10).join(f"{i+1}. {s}" for i,s in enumerate(standards))}

【反例 · {len(anti_patterns)} 条（这些写法要避免）】
{chr(10).join(f"- {a}" for a in anti_patterns)}

【小红书禁词】（出现任意一个则此稿不通过）
{', '.join(banned)}

【允许的价格表达】
{', '.join(allowed_price_words)}

【标题句式】（首行行动词，第二行模型名，第三行卖点）
{chr(10).join(structures)}

【封面层次规则】
{chr(10).join(hierarchy_rules)}
=== 以上为偏好块结束 ===
"""
```

5. 在脚本顶部加一行注释：`# 偏好加载路径：data/distilled-preferences.json（T13 产出），回退：skills/simin-persona/SKILL.md 等 4 个文件`

### 2. 把偏好版本号写入 manifest（10 分钟）

改 `scripts/gen-xhs-post.py`：在每次生成的 manifest JSON 里加一个字段：

```json
"preference_version": {
  "source": "distilled-preferences.json | fallback",
  "distilled_at": "2026-11-02",
  "version": 1
}
```

这样 Hanabi 的历史批次列表可以知道「这一批是用哪个版本的偏好生成的」，T13 更新偏好后可以追溯旧批次是否需要重生成。

### 3. 在 Hanabi server 暴露偏好状态（30 分钟）

改 `hanabi/lib/content-ops-production.mjs` 的 `config()` 方法，在返回对象里加：

```js
preferencesReady: existsSync(join(this.root, 'data/distilled-preferences.json')),
preferencesVersion: (() => {
  try {
    const p = JSON.parse(readFileSync(join(this.root,'data/distilled-preferences.json'),'utf8'));
    return { version: p.version, distilledAt: p.distilled_at };
  } catch { return null; }
})(),
```

### 4. 在 Hanabi UI 展示偏好状态（20 分钟）

改 `hanabi/lib/content-ops-ui.mjs` 的 `init()` 方法：

- 若 `config.preferencesReady=true`，在面板顶部的 provider 说明行追加：`· 偏好 v{version}（{distilledAt}）`
- 若 `config.preferencesReady=false`，在说明行显示：`· 偏好：⚠️ distilled-preferences.json 未生成，请先跑 T13`

不新增 UI 元素，只改已有的 `#content-ops-provider` 文本节点。

### 5. 更新 xhs-post-generation SKILL.md（15 分钟）

改 `skills/xhs-post-generation/SKILL.md` 的第 1 步说明，把：

> 整段读取 simin-persona、quick 标题句式、平台规则、设计规则和 quick 风险 YAML

改为：

> 读取 `data/distilled-preferences.json`（T13 产出）。若该文件不存在，回退到 `skills/simin-persona/SKILL.md`、`skills/xhs-title-patterns/quick.md`、`rules/banned-words-quick.yaml`、`rules/design-rules.md` 四个文件。任何接入模型都通过 distilled-preferences.json 获取偏好，不直接读分散文件。

### 6. 验收自测（30 分钟）

1. 确认 T13 已跑完，`data/distilled-preferences.json` 存在。
2. 跑 `python3 scripts/gen-xhs-post.py --model GLM5.3 --count 2 --platform xhs`。
3. 检查 manifest.json 里的 `preference_version.source` 是 `distilled-preferences.json`（不是 `fallback`）。
4. 检查产出文案无禁词：`python3 scripts/check-banned-words.py outputs/<日期>/<批次>/post-1.md`。
5. 把 `data/distilled-preferences.json` 临时重命名成 `.json.bak`，再跑一次，确认 `[WARN]` 日志出现且脚本仍能完成（回退路径通）。改回来。
6. 刷新 Hanabi，确认 provider 说明行出现「偏好 v1（2026-11-02）」字样。

## 产出

- `scripts/gen-xhs-post.py`（改偏好加载 + manifest 字段）
- `hanabi/lib/content-ops-production.mjs`（加 preferencesReady/preferencesVersion）
- `hanabi/lib/content-ops-ui.mjs`（UI 展示偏好状态）
- `skills/xhs-post-generation/SKILL.md`（更新说明）

## 验收

- [x] manifest.json 里 `preference_version.source = "distilled-preferences.json"`
- [x] 产出文案通过 `check-banned-words.py` 检查（0 命中）
- [x] distilled-preferences.json 不存在时，脚本打 `[WARN]` 并走回退路径完成生成
- [x] Hanabi 界面 provider 说明行出现偏好版本号
- [x] `skills/xhs-post-generation/SKILL.md` 第 1 步说明已更新

## 规矩

- **只改必要文件**：不动 Hanabi 的其他模块，不改数据库 schema，不影响既有历史批次。
- **回退路径必须通**：T13 没跑时 Hanabi 仍然能生成，不能因为 distilled-preferences.json 缺失就直接报错退出。
- **不新增 UI 元素**：只改已有的 provider 说明文本，不加按钮、不加配置项。
- **commit message 用中文**，按改脚本、改 Hanabi 两次分提交，分别 `git push`。
- **不自动发布**，不改 Hanabi 的发布和预览逻辑。

## 时间估算

2.5 小时（脚本 45min + server 30min + UI 20min + SKILL 15min + 验收 30min）

## 完成记录

- 2026-11-02：主路径 `tmp/t14-primary-final` 完成 2 篇，manifest 来源为 `distilled-preferences.json`、版本 1、日期 2026-11-02，SHA256 `08a45246c5dcf74c602e5aa0864660d17bed7152013c4f1f005e9dc752c08451`；回退路径 `tmp/t14-fallback-final` 完成 1 篇，启动日志含精确 `[WARN]`，manifest 来源 `fallback`。三篇 Markdown 风险词检查均 `[]`；三张 PNG 均为 1080×1080，文件 SHA 与 manifest 一致。Claude 复核封面层级、可读性和两篇结构差异通过；当前稿按建议验证任务表述，没有无来源的发布状态断言。
- 2026-11-02：通过单元边界检查：缺失包回退6个现有配置来源；偏好块超长时在调用网关前明确失败；合法 JSON 围栏及前后说明可解析，多个围栏、额外 JSON 和尾随垃圾均拒绝。版本号及真实日期格式验证通过。
- 2026-11-02：实际 Hanabi 6187 provider 行显示“偏好 v1（2026-11-02）”；config 返回 ready/version。ready、missing、请求失败及无 provider 节点四种状态均验证；两个模块 `node --check` 通过。当前旧 `app.js` 仍会因缺少旧 `#entry-form-home` 节点在初始化时报错，provider 版本状态独立可用；整页工作台状态不作为 T14 验收结论。
- 提交：`338adbb`（脚本）及本卡 Hanabi 提交（见 Git 记录），均推送 `origin/main`。
