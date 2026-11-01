# 规则库使用说明

本目录存放平台规则、设计规范、禁用词等约束。

## 文件清单

### platform-rules.md
各平台（小红书、闲鱼、公众号）的发布规则：
- 什么能说、什么不能说
- 价格表达方式（小红书用区块词，闲鱼可写折扣）
- 标签规则、字数限制

### design-rules.md
大字报配色与排版规则：
- 字号层次（标题、副标题、说明文字）
- 配色方案（背景、强调色、文字色）
- 从置顶两篇提炼的实际参数

### banned-words-quick.yaml
风险词库（T05 快速版）：
- 20 条规则（小红书 12 条、闲鱼 4 条、公众号 4 条）
- 包含替换建议
- 支持 `scripts/check-banned-words.py` CLI 检查

### cover-palettes.json
封面配色方案：
- 6 组配色（背景、卡片、强调色）
- 生成脚本轮换使用

## 使用

生成脚本（`scripts/gen-xhs-post.py`）会自动加载这些规则作为 system prompt 的一部分。

单独检查风险词：
```bash
python3 scripts/check-banned-words.py --platform xhs --model GLM5.3 --text "你的文案"
```

## 维护

- 发现新的禁用词 → 加到 `banned-words-quick.yaml`
- 平台规则变化 → 更新 `platform-rules.md`
- 需要新配色 → 加到 `cover-palettes.json`
