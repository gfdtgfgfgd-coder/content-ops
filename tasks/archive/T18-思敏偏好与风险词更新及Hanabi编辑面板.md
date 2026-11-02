# T18 · 思敏偏好与风险词更新到今天 + Hanabi 前端可编辑显示

执行者：Codex
状态：完成（2026-11-02）
依赖：T04（思敏偏好已有基础）、T05 简化版（风险词已有基础）、T11（Hanabi 已通）、T17-C（企微历史读完）
提出：lilith 授权，Claude 规划

## 目标

三件事：
1. 把 `skills/simin-persona/SKILL.md`（思敏偏好）和 `rules/banned-words-quick.yaml`（风险词）的内容更新到今天（2026-11-02），纳入 T17 新抓的企微历史和闲鱼数据
2. 在 Hanabi 前端新增「思敏偏好」和「风险词」两个可查看、可编辑的面板，让 lilith 随时往里加条目，不用改文件再 push
3. 编辑后的内容写回原文件（SKILL.md / banned-words-quick.yaml），保持 git 可追溯

成功标准：lilith 在 Hanabi 里点开「思敏偏好」能看到 15 条标准 + 8 反例 + 24 引文，点「添加标准」能写一条新的进去并保存；风险词面板同理。生成脚本下次跑时自动读到最新内容。

## 背景

当前思敏偏好和风险词散在两个文件里：
- `skills/simin-persona/SKILL.md`：人读 Markdown，生成时整段塞进 system prompt
- `rules/banned-words-quick.yaml`：机器读 YAML，`check-banned-words.py` 用

两份文件 lilith 要改必须动 git，不方便。T17-C 读完企微后会有新条目要加，之后也会持续累积。需要一个前端入口让 lilith 直接在 Hanabi 里增删改查，后台写回文件。

## 步骤

### 1. 更新思敏偏好到今天（30 分钟）

前提：T17-C 已跑完，`data/wecom/simin-feedback.jsonl` 有新条目，`data/wecom/raw/` 有新截图。

1. 读最新 `simin-feedback.jsonl`，把新引文按 `evidence_id` 顺序追加到 `skills/simin-persona/SKILL.md` 的「去敏原话摘录」表。
2. 如果新引文引出新判断标准（如「不要用感叹号超过 3 个」），加到「判断标准」列表，编号续接（当前 15 条，从 16 开始）。
3. 如果新引文引出新反例，加到「反例」列表（当前 8 条，从 9 开始）。
4. 更新 SKILL.md 顶部「证据版本」为 `2026-11-02`，注明新增条目数。
5. 不删旧条目，不覆盖既有判断。冲突记到 `docs/03-开放问题.md`。

### 2. 更新风险词到今天（20 分钟）

1. 读 T17 新抓的闲鱼数据和企微新截图，提取新出现的禁词或允许词。
2. 追加到 `rules/banned-words-quick.yaml`，每条带 `reason` 和 `added_at: 2026-11-02`。
3. 如果新词是某个模型专限（如 Seedance 的「秒级」已是单限），加 `platform` / `model_scope` 字段。
4. 同步更新 `data/wecom/risk-words.md` 的表格。
5. 不删旧词，不改 D10 的历史口径。

### 3. Hanabi 后端：偏好与风险词读写接口（40 分钟）

在 `hanabi/server.mjs` 新增四个路由：

**`GET /api/content-ops/persona`**
返回 `skills/simin-persona/SKILL.md` 解析后的结构化数据：
```json
{
  "version": "2026-11-02",
  "standards": [{"id": 1, "text": "模型名称是封面主标题...", "evidence": ["Q05","Q06"]}],
  "anti_patterns": [{"id": 1, "text": "封面模型名与背景同为浅色...", "evidence": ["Q08"]}],
  "quotes": [{"id": "Q01", "date": "2026-10-19", "text": "AI写完人工可以检查一下..."}],
  "raw_md": "完整 SKILL.md 原文"
}
```

解析方式：用正则按「## 判断标准」「## 反例」「## 去敏原话摘录」分段，编号从 Markdown 列表项提取。解析失败时返回 `raw_md` 让前端兜底显示。

**`POST /api/content-ops/persona`**
Body: `{action: "add_standard"|"add_anti_pattern"|"add_quote", text, evidence?, date?}`
- `add_standard`：在 SKILL.md 「判断标准」列表末尾追加一条，编号续接
- `add_anti_pattern`：在「反例」列表末尾追加
- `add_quote`：在「去敏原话摘录」表追加一行，`evidence_id` 自动生成 `Q{next}`
- 写回 SKILL.md，保持原 Markdown 格式
- 同时 git commit（message: 「思敏偏好：新增 {action} {id}」），不自动 push

**`GET /api/content-ops/banned-words`**
返回 `rules/banned-words-quick.yaml` 解析后的数组：
```json
{
  "words": [
    {"word": "最便宜", "level": "ban", "platform": ["xhs","xianyu","gzh"], "replace": "便宜管饱", "reason": "...", "added_at": "..."}
  ],
  "raw_yaml": "完整原文"
}
```

**`POST /api/content-ops/banned-words`**
Body: `{action: "add"|"remove", word, level, platform, replace, reason, model_scope?}`
- `add`：追加到 YAML，`added_at` 自动填今天
- `remove`：按 `word` 删除（精确匹配）
- 写回 YAML，git commit（message: 「风险词：{action} {word}」）

### 4. Hanabi 前端：偏好编辑面板（1 小时）

新建 `hanabi/lib/content-ops-persona.mjs`，导出 `class ContentOpsPersona`，挂到 `#content-ops-persona` 容器。

**布局：**
```html
<details id="content-ops-persona">
  <summary>思敏偏好 <span id="persona-version"></span></summary>
  <div class="persona-section">
    <h3>判断标准 <button id="persona-add-standard">+ 添加</button></h3>
    <ol id="persona-standards">
      <li>模型名称是封面主标题... <span class="evidence">Q05,Q06</span></li>
    </ol>
  </div>
  <div class="persona-section">
    <h3>反例 <button id="persona-add-anti">+ 添加</button></h3>
    <ol id="persona-anti">
      <li>封面模型名与背景同为浅色... <span class="evidence">Q08</span></li>
    </ol>
  </div>
  <div class="persona-section">
    <h3>原话摘录 <button id="persona-add-quote">+ 添加</button></h3>
    <table id="persona-quotes">
      <tr><td>Q01</td><td>2026-10-19</td><td>AI写完人工可以检查一下...</td></tr>
    </table>
  </div>
</details>
```

点「+ 添加」弹出内联表单（不用 window.prompt），填完提交到 POST 接口，成功后刷新面板。

### 5. Hanabi 前端：风险词编辑面板（40 分钟）

新建 `hanabi/lib/content-ops-banned-words.mjs`，导出 `class ContentOpsBannedWords`，挂到 `#content-ops-banned-words` 容器。

**布局：**
```html
<details id="content-ops-banned-words">
  <summary>风险词 <span id="banned-count"></span></summary>
  <table id="banned-words-table">
    <thead><tr><th>词</th><th>级别</th><th>平台</th><th>替换</th><th>原因</th><th>操作</th></tr></thead>
    <tbody>
      <tr><td>最便宜</td><td>ban</td><td>xhs,xianyu,gzh</td><td>便宜管饱</td><td>广告法极限词</td><td><button data-remove="最便宜">删</button></td></tr>
    </tbody>
  </table>
  <button id="banned-add">+ 添加风险词</button>
</details>
```

添加表单：词 / 级别（ban/warn 下拉）/ 平台（多选）/ 替换词 / 原因 / 模型范围（可选）。删除按钮直接调 POST remove。

### 6. 改 HTML 和 app.js 挂载（10 分钟）

`hanabi/index.html` 在 `#content-ops-references` 下方加：
```html
<details id="content-ops-persona"><summary>思敏偏好</summary></details>
<details id="content-ops-banned-words"><summary>风险词</summary></details>
```

`hanabi/app.js` 初始化两个新组件。

### 7. 验收自测（20 分钟）

1. 打开 Hanabi，展开「思敏偏好」，看到 15 标准 + 8 反例 + 24 引文
2. 点「+ 添加标准」，写一条「第 16 条」，提交后列表更新，SKILL.md 文件也更新
3. `git log` 看到自动 commit：「思敏偏好：新增 add_standard 16」
4. 展开「风险词」，看到当前所有词
5. 添加一条新风险词，YAML 文件更新，`check-banned-words.py` 能命中
6. 删除一条风险词，YAML 更新
7. 生成脚本 `gen-xhs-post.py` 跑一次，确认读到的是更新后的 SKILL.md 和 YAML

## 产出

- `skills/simin-persona/SKILL.md`（更新到 2026-11-02）
- `rules/banned-words-quick.yaml`（更新到 2026-11-02）
- `data/wecom/risk-words.md`（同步更新）
- `hanabi/server.mjs`（四个路由）
- `hanabi/lib/content-ops-persona.mjs`（新建）
- `hanabi/lib/content-ops-banned-words.mjs`（新建）
- `hanabi/index.html`（加两个面板容器）
- `hanabi/app.js`（挂载新组件）

## 验收

- [x] SKILL.md 证据版本是 2026-11-02，现有引文已逐条复核（无新增）
- [x] banned-words-quick.yaml 的 21 条规则均有 `added_at` 元数据（新增禁词 0 条）
- [x] Hanabi 偏好面板显示 15+ 标准、8+ 反例、29+ 引文
- [x] 添加一条标准后，SKILL.md 文件更新且 Git 有中文 commit
- [x] 添加一条风险词后，YAML 更新且 `check-banned-words.py` 命中
- [x] 删除风险词后，YAML 对应行移除
- [x] 生成脚本继续读取源文件；编辑后运行目录同步到最新偏好包与词库
- [x] 解析失败时前端显示 raw_md / raw_yaml 兜底，不白屏

## 规矩

- **不自动 push**：编辑后只 git commit，lilith 想同步到另一台电脑时自己 push
- **不删旧条目**：只追加，删除仅限 lilith 在前端明确点「删」
- **解析兜底**：SKILL.md / YAML 格式若被 lilith 手改坏，前端显示原文，不崩
- **不动生成脚本逻辑**：生成脚本继续读文件，不读 Hanabi 数据库
- **commit message 用中文**，每次编辑自动 commit 一条
- 改 Hanabi 只加面板，不影响生成流程、历史批次、预览

## 时间估算

3.5 小时（更新文件 50min + 后端 40min + 偏好面板 1h + 风险词面板 40min + HTML/app 10min + 验收 20min）

## 完成记录

- 2026-11-02：SKILL.md 复核完成，证据版本 2026-11-02；保留 15 条标准、8 条反例、29 条去敏引文，Claude 复核新增标准/反例/引文均为 0。
- 2026-11-02：风险词 quick YAML 保留 21 条、补录 `added_at: "2026-11-02"`；新增禁词 0 条；D18 已统一为小红书与闲鱼均禁 API。
- 2026-11-02：新增 `hanabi/lib/content-ops-editor.mjs` 固定路径编辑服务与四个接口；支持原子写入、Git 中文提交、版本冲突、坏文件 raw 兜底、同源 JSON 校验、运行目录同步；企微摘录新增必须确认已去敏并使用「…」格式。
- 2026-11-02：新增 `hanabi/lib/content-ops-editors.mjs`、CSS 与 `index.html` 双面板；可查看/添加标准、反例、去敏摘录，添加/确认删除风险词；安全文本渲染，无 `prompt`。
- 2026-11-02：验收通过：隔离测试 12 项全通过（偏好包重建、运行目录同步、Git 精确提交、并发冲突、回滚、坏 YAML/Markdown 兜底、风险词 checker 命中）；真实隔离服务 6188 GET 为 15/8/29/21，新增标准提交成功，风险词新增/删除成功，未去敏摘录返回 400；ego 截图 `tmp/t18-final-1440.png`、`tmp/t18-final-768.png`、`tmp/t18-final-390b.png`，390px 横向无溢出（scrollWidth 375 <= viewport 390）。
- 2026-11-02：未调用收费模型；编辑面板与服务源码已同步到 `releases/Hanabi-2026-11-01-mac-arm64/app`，主 6187 服务待 T19 精简后统一重启。
