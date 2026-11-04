# 规则库使用说明

本目录存放内容生产规范、机器风险词规则与封面配色数据。

## 文件清单

### content-spec.md
内容生产唯一规范，按写稿、做图、平台适配和参考素材选用顺序组织。工程操作见 `docs/GUIDE.md`。

### banned-words-quick.yaml
风险词库（机器检查唯一事实源）：
- 平台、模型和正则条件组合
- 包含建议替换词与违禁原因
- 支持 `scripts/check.py words` CLI 检查

### cover-palettes.json
封面配色方案：
- 配色定义（背景、卡片、强调色）
- 生成脚本轮换使用

## 使用

生成脚本（`scripts/generate.py copy`）会自动加载这些规则作为 system prompt 的一部分。

单独检查风险词：
```bash
python3 scripts/check.py words --platform xhs --model GLM5.3 --text "你的文案"
```

## 维护

- 发现新的禁用词 → 加到 `banned-words-quick.yaml`
- 业务规则变化 → 更新 `content-spec.md`
- 需要新配色 → 加到 `cover-palettes.json`
- 企微证据仅保留在 `data/wecom/risk-words.md`，不作为机器规则重复读取；新增规则只写入 quick YAML。
