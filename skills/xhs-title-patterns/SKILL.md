---
name: xhs-title-patterns
description: 制作或复核小红书模型推广标题与封面时，参考已核对的 12 条样本结构；不把历史样本当作当前能力事实或风险词许可。
---

# 小红书标题句式

读取同目录 [quick.md](quick.md)，使用其中固定样本 ID、开场与结构模板，不另维护一份句式表。

生成时同时应用 [思敏偏好](../simin-persona/SKILL.md)、[平台规则](../../rules/platform-rules.md) 和 [风险词源表](../../rules/banned-words-quick.yaml)。历史原文和标注【已禁】的表达仅用于核对来源；当前规则优先。模型能力须另有事实依据，同批标题与海报结构须有变化。

机器读取用 `scripts/distill-preferences.py` 重建的 `data/distilled-preferences.json`；修改来源后重建，避免手改派生文件。
