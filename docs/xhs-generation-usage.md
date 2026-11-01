# 小红书生成脚本

产品名是宣传主题，实际写稿与终审使用公司 `claude-sonnet-4-6`；新背景使用 `qwen-image-3.0`。现在只支持小红书草稿，不自动发布。

## 首次配置

在 content-ops 根目录运行：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

令牌按 `docs/gateway-image-usage.md` 放在本机 `work/gateway.env`，不要提交。字体由 `CONTENT_OPS_FONT` 配置，默认使用本机思源黑体。日常 `python3 scripts/gen-xhs-post.py` 会自动转到仓库 `.venv`。

## 生成

```bash
python3 scripts/gen-xhs-post.py --model GLM5.3 --platform xhs --count 2
python3 scripts/gen-xhs-post.py --model 'Kimi 2.6' --count 1 --output outputs/2026-11-01/kimi-new
```

默认写 `outputs/<上海日期>/`。每次请用新的输出目录，已有结果不会覆盖。生成过程中会保存 manifest、草稿、终稿及已经成功的图文；失败返回非零，manifest 如实记 failed。

截至 2026-11-01 晚，公司通用网关生图余额不足：当时余约 0.05，Qwen 单次需预扣 0.25。本轮 GLM 第一张背景已真实生成，第二张与 Kimi 使用显式缓存模式完成。补充额度后可选择新背景；当前可用：

```bash
python3 scripts/gen-xhs-post.py --model GLM5.3 --count 2 \
  --output outputs/2026-11-01/new-batch \
  --background data/images/backgrounds/company-qwen-2026-11-01.png
```

缓存图只复用背景，新文案仍走 Claude，两篇采用不同配色和结构。背景及原始图片不进 Git，换电脑需单独复制该文件或重新生成。Hanabi 有明确的模式选择。

## 失败续跑

```bash
python3 scripts/gen-xhs-post.py --model GLM5.3 --count 2 --resume \
  --background data/images/backgrounds/company-qwen-2026-11-01.png
```

`--resume` 仅对相同产品名、平台、数量有效。已有终稿不重新付费写稿，成功且未改变的图片不重画；未完成图像请求仍可能收费。没有终稿时停止并保留原响应，不机械修补非法 JSON。

## 事实与规则

- 读取 persona、quick、平台、配色、风险库及生成 Skill；公司 Claude 再做风格与去 AI 味终审。
- 没有产品资料时，输出任务试用建议，不编能力参数、价格、活动或亲测。可通过 `--facts` 传 `{ "model": "GLM5.3", "verified_claims": [{"claim":"已核验主张", "source":"来源与日期"}] }`。
- 风险检查覆盖三行封面标题、正文、标签及人群。Seedance 的限制通过产品名范围匹配。
- 图片为 1080×1080，模型名最大，准确中文在本机排版。通用 3:4 建议保留，今晚按 persona 用 1:1。
- `manifest.json` 保存模型、规则哈希、事实依据、背景模式与图片哈希。部分结果不冒充完整成套。
