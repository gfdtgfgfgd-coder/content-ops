# T15 · Hanabi 内建图文素材库（图 + 文案内联查看）

执行者：Codex
状态：完成（2026-11-02）
依赖：T13（signal 字段 + distilled-preferences.json）
提出：lilith 授权，Claude 规划

## 目标

在 Hanabi 里新增一个**全量素材库**面板，展示所有已抓取帖子（XHS 364 条 + 闲鱼 34 条），图片直接渲染，文案正文、封面 OCR、互动数、标注状态全部内联显示，不跳转到原帖页面。

支持按质量排序筛选，让用户能快速看到最有价值的帖子。排序方案（模仿 npm 的 Best Match / Most Stars）：

- **精选（Best Match）**：`label.good=true` 且 `clean_for_style_reference=true` 的帖子排前，其余按 engagement_tier 降序（good > high > mid > low）
- **互动最高（Most Engaged）**：按 likes + collects × 2 + comments 降序
- **最新（Newest）**：按 fetched_at 降序
- **闲鱼最想要（Most Wanted）**：闲鱼帖按 wants 降序

全量展示，不预先过滤，让用户自己判断；精选排序把最有参考价值的帖子置顶，不默认隐藏其他帖子。

这样当生成结果不满意时，可以直接在 Hanabi 里对照所有参考素材的图和文案，生成 manifest 里被引用的帖子会被高亮，直接定位。

## 背景

之前的设计只打算展示 16+14 条精选帖子，但 XHS good posts 被思敏漏标了很大一部分，闲鱼 wants 数据也需要重抓（T17）。在 T17 跑完补齐标注之前，直接看全量更可靠——用户能肉眼发现漏标的好帖，也能手动补充标注。

## 步骤

### 1. 新增后端接口（30 分钟）

在 `hanabi/server.mjs` 里新增两个路由：

**`GET /api/content-ops/references?platform=xhs|xianyu&sort=best|engaged|newest|wanted&offset=0&limit=30`**

从 `data/xhs/*.json`（排除 `_` 开头）和 `data/xianyu/*.json` 读全量数据，按 `sort` 参数排序后分页返回：

- `best`：`label.good=true && clean_for_style_reference=true` 优先；其次按 `engagement_tier` 枚举顺序（good > high > mid > low）；同 tier 按 likes 降序
- `engaged`：`likes + collects*2 + comments` 降序，null 视为 0
- `newest`：`fetched_at` 降序
- `wanted`（仅闲鱼）：`metrics.wants` 降序，null 排末尾

`signal` 字段由 T13 产出，T13 未跑时回退：`engagement_tier` 从 metrics 实时算，`clean_for_style_reference` 从 `label.good` 推断（true 且无禁词命中）。

返回结构：
```json
{
  "total": 364,
  "offset": 0,
  "limit": 30,
  "posts": [
    {
      "id": "6ae44af7...",
      "platform": "xhs",
      "title": "GLM-5.3入手真的香！",
      "body_preview": "正文前 300 字...",
      "body_full": "完整正文",
      "cover_ocr": "GLM5.3 / 便宜量大",
      "image": "/api/content-ops/image/xhs/6ae44af7.../1.jpg",
      "metrics": {"likes": 0, "collects": 1, "comments": 0, "wants": null},
      "label_good": true,
      "clean_for_style_reference": true,
      "banned_word_hits": [],
      "engagement_tier": "good",
      "model": "GLM-5.3",
      "tags": ["#GLM5.3", "#AI"],
      "url": "https://..."
    }
  ]
}
```

**`GET /api/content-ops/image/:platform/:id/:filename`**
把 `data/images/:platform/:id/:filename` 以对应 MIME 类型返回。严格校验路径在 `data/images/` 目录内，路径穿越返回 400。

### 2. 新增前端面板 `lib/content-ops-references.mjs`（1.5 小时）

新建文件，导出 `class ContentOpsReferences`。

**面板结构：**
```html
<details id="content-ops-references">
  <summary>
    素材库
    <span id="content-ops-ref-total"></span>
    <select id="content-ops-ref-platform">
      <option value="xhs">小红书</option>
      <option value="xianyu">闲鱼</option>
    </select>
    <select id="content-ops-ref-sort">
      <option value="best">精选优先</option>
      <option value="engaged">互动最高</option>
      <option value="newest">最新</option>
      <option value="wanted">最想要</option>（闲鱼时显示）
    </select>
  </summary>
  <div id="content-ops-ref-grid">
    <!-- 卡片列表，滚动加载 -->
  </div>
  <button id="content-ops-ref-more">加载更多</button>
</details>
```

**卡片结构：**
```html
<article class="ref-card [ref-card--good] [ref-card--cited] [ref-card--warned]" data-id="...">
  <img src="/api/content-ops/image/..." loading="lazy" width="160" height="160" alt="封面">
  <div class="ref-body">
    <div class="ref-badges">
      <span class="ref-badge-good">✅ 精选</span>       <!-- label_good=true -->
      <span class="ref-badge-warn">⚠️ 含禁词: API</span> <!-- banned_word_hits 非空 -->
      <span class="ref-badge-cited">🔗 已引用</span>    <!-- 当前批次 manifest 中 -->
    </div>
    <div class="ref-title">GLM-5.3入手真的香！</div>
    <div class="ref-ocr">封面：GLM5.3 / 便宜量大</div>
    <div class="ref-text">正文前 300 字…</div>
    <div class="ref-meta">❤️ 0 &nbsp; ⭐ 1 &nbsp; 💬 0</div>
    <button class="ref-expand" aria-expanded="false">展开全文</button>
  </div>
</article>
```

- 默认加载 30 条，点「加载更多」追加 30 条（`offset` 递增）
- 切换 platform 或 sort 时重置 offset 重新加载
- 当前批次 manifest 里的被引用帖子加 `ref-card--cited` class，黄色左边框，`<details>` 展开时自动滚动到第一个被引用卡片

### 3. 改 HTML 加入面板（5 分钟）

在 `hanabi/index.html` 的 `#content-ops-panel` 内部合适位置加：
```html
<details id="content-ops-references">
  <summary>素材库 <span id="content-ops-ref-total"></span></summary>
</details>
```

### 4. 改 app.js 挂载（5 分钟）

Import `ContentOpsReferences`，和 `ContentOpsUI` 同时初始化。

### 5. 改 content-ops-ui.mjs：批次结果加引用跳转（15 分钟）

在每篇结果卡片下方，若 manifest 有 `references`，加一行：
```
参考了：[便宜量大的GLM-5.2太香了！] [🥳SD2.5便宜又好用的视频模型]
```
点击按钮：展开 `#content-ops-references` 面板，高亮对应卡片并滚动到它。

### 6. 验收自测（20 分钟）

1. 展开素材库，默认「精选优先」：`label.good=true` 的帖子排在最前面
2. 切「互动最高」：按 `likes+collects×2+comments` 得分最高的 `6a02c2ed000000003502f752`（612/481/1532，3106 分）排第一
3. 切闲鱼 tab，切「最想要」：wants=379 的 Seedance2.5 排第一
4. 7 条含禁词的精选帖有 ⚠️ 标记
5. 点「加载更多」，第 31 条开始追加
6. 有刚生成的批次时，被引用卡片有黄色左边框
7. `/api/content-ops/image/xhs/../../work/gateway.env` 返回 400

## 产出

- `hanabi/lib/content-ops-references.mjs`（新建）
- `hanabi/server.mjs`（新增两个路由）
- `hanabi/index.html`（加面板容器）
- `hanabi/app.js`（挂载新组件）
- `hanabi/lib/content-ops-ui.mjs`（批次结果加引用跳转）

## 验收

- [x] XHS 364 条全部可浏览（分页，每次 30 条）
- [x] 闲鱼 34 条全部可浏览
- [x] 「精选优先」排序：good 帖在前，low 帖在后
- [x] 「互动最高」：按公式得分 3106 的帖子排第一（612赞、481收藏、1532评论）
- [x] 「最想要」（闲鱼）：wants=379 的帖子排第一
- [x] 含禁词帖有 ⚠️ 标记，精选帖有 ✅ 标记
- [x] 路径穿越攻击返回 400
- [x] 批次 manifest 引用帖高亮并可跳转
- [x] T13 未跑时，面板仍能降级展示（engagement_tier 实时计算）

## 规矩

- 图片接口严格校验路径只服务 `data/images/` 内文件
- `loading="lazy"` 必须加，不能全量预加载
- 不改 Hanabi 其他面板，不影响生成流程
- commit 分两步：先 server 路由，再前端组件

## 时间估算

2.5 小时

## 完成记录

2026-11-02 完成。验收数字以 T17/T13 当前数据和卡内排序公式为准，旧例 140赞 / 352想要 / 6条风险精选已更正为 612赞（互动分3106）/ 379想要 / 7条。

- `node tmp/t15-reference-store-test.mjs`：PASS。小红书364、闲鱼34，分页无重复；全部398条去掉signal后实时回退与原值一致，缺偏好包回退现有Python风险检查；454张图片均可读（452张实际WEBP、2张JPEG），按内容返回MIME。
- HTTP：`/healthz` 200、素材接口200、图片200 image/webp；`curl --path-as-is .../image/xhs/../../work/gateway.env` 400，缺图404；隔离路径/软链穿越400、非图片415。
- ego TaskSpace34实测：XHS加载到364/364，364个唯一ID；25条精选含7条风险提示；默认前18条为干净精选。闲鱼wanted第一379；正文展开、多图延迟加载、30条追加、平台与排序切换、待引用选择/刷新恢复/清空均通过。
- 本地UI夹具验证结果引用按钮定位到 `1094357447758`，显示已引用高亮，主列表仍30条、offset仍30；空态、失败与重试兜底通过。夹具不代表真实收费生成。
- production隔离SQLite+fake spawn回归11项通过：旧表迁移、幂等、默认无引用、真实manifest引用、正常/失败/停止/重启清理、并发与忙锁503。测试未使用真实数据库或收费模型。
- 生成引用离线回归6组通过：显式引用进入上下文和manifest、空引用、坏输入、超限、续跑哈希、安装/打包素材白名单。实际运行目录已安装364+34帖及454图，SHA一致，无企微raw，gateway.env为0600。
- JavaScript `node --check`、Python `py_compile`、`git diff --check`通过。截图：`tmp/t15-desktop.jpg`、`tmp/t15-tablet.jpg`、`tmp/t15-mobile.jpg`（1440/768/390，横向溢出均0）。来源截图是历史素材，不是新成品。
- 设计检查保留既有字体与三栏外壳，修正定位单卡留白、范围内低对比文字；全页检查仍报告旧调配页与旧app初始化问题，本卡素材/结果模块独立运行，不以此声称旧通用工作台已恢复，T19处理。检查见tmp/t15-inspect、tmp/t15-library-inspection.json。历史原文表情与卡片要求的✅/⚠️保留；两列历史图文长度不同，按内容自然高度避免拉伸空白；分页长列表不适用所有块均首屏可见的概览规则。已移除不应包住整个面板的data-ui标记。
- 限制：现有 `scripts/hanabi-package/` 模板目录缺失，因此只核验全量素材打包白名单，未重新构建完整ZIP；T19轻量包需重新建立打包入口。新背景余额限制仍见Q9。
- 清理：临时验证脚本/夹具在忽略的tmp，未新增重复偏好或风险词文件；任务卡已归档。
