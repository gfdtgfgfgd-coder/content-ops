# 脚本使用说明

本目录存放生成和检查脚本。

## 主要脚本

### gen-xhs-post.py
生成小红书图文（标题 + 正文 + 配图）

**用法：**
```bash
python3 scripts/gen-xhs-post.py \
  --model GLM5.3 \
  --count 2 \
  --output outputs/2026-11-01
```

**参数：**
- `--model`：产品模型名（如 GLM5.3、Kimi K3.1 Pro）
- `--count`：生成数量（1-10）
- `--platform`：平台（默认 xhs）
- `--facts`：可选，产品事实 JSON 文件
- `--background`：可选，复用已有背景图
- `--resume`：可选，续跑失败任务

**输出：**
- `outputs/日期/manifest.json`：批次元数据
- `outputs/日期/post-1.md`、`post-2.md`：文案
- `outputs/日期/post-1.png`、`post-2.png`：成图

**依赖：**
需要配置 `work/gateway.env`：
```
CONTENT_OPS_API_KEY=your_key
CONTENT_OPS_BASE_URL=https://your-gateway.com
CONTENT_OPS_TEXT_MODEL=claude-sonnet-4-6
CONTENT_OPS_IMAGE_MODEL=qwen-image-3.0
```

### gen-image.py
单独调用文生图 API（被 gen-xhs-post.py 调用）

### check-banned-words.py
检查文案是否含风险词

**用法：**
```bash
python3 scripts/check-banned-words.py \
  --platform xhs \
  --model GLM5.3 \
  --text "你的文案内容"
```

**返回：**
- 无风险词：退出码 0
- 有风险词：退出码 1，输出违规词列表

### 清洗与蒸馏

完整用法、字段来源和重跑顺序见 [操作手册](../docs/GUIDE.md#6-数据清洗与偏好包)。四个入口：`clean-xhs-data.py`、`parse-audience.py`、`clean-xianyu-data.py`、`distill-preferences.py`；配置在 `config/`，禁词只读取 `rules/banned-words-quick.yaml`。所有入口可用 `--help` 查看文件参数。

## 环境准备

```bash
cd ~/Desktop/content-ops
python3 -m venv work/.venv
work/.venv/bin/pip install -r requirements.txt
```

本卡新增的清洗、蒸馏与风险词入口在缺少 PyYAML 时会尝试 `work/.venv/bin/python3`；其他脚本可显式用该解释器运行。

## 在 Hanabi 中使用

Hanabi 的「生成小红书图文」表单会调用 `gen-xhs-post.py`，配置同上。

访问 http://127.0.0.1:6187 → 展开「生成小红书图文」→ 填模型名和数量 → 生成。
