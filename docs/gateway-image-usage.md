# 公司网关文生图

2026-11-01 已使用公司控制台现有令牌跑通 `qwen-image-3.0`，没有新建 API key。

## 配置

把 `config/gateway.env.example` 复制为本机 `work/gateway.env`，填入公司控制台已有令牌，并设为仅本人可读：

```bash
mkdir -p work
cp config/gateway.env.example work/gateway.env
chmod 600 work/gateway.env
```

`work/` 已被 git 忽略。切换电脑后需重新配置本机令牌。也可以通过环境变量设置这三个字段，环境变量优先于配置文件。

| 配置项 | 含义 |
|---|---|
| `CONTENT_OPS_API_KEY` | 公司控制台已有 API 令牌 |
| `CONTENT_OPS_BASE_URL` | 带 `/v1` 的公司网关地址 |
| `CONTENT_OPS_IMAGE_MODEL` | 图像模型 ID |

## 调用

```bash
python3 scripts/gen-image.py \
  --prompt "GLM5.3 高性能模型，适合小红书大字报封面" \
  --output outputs/test-image.png
```

可选参数：`--style cartoon`、`--size 1080x1440`、`--model <模型ID>`、`--base-url <地址>`、`--config <本机配置路径>`、`--prompt-file <UTF-8文本文件>`、`--metadata-output <JSON路径>`。

每次请求只生成一张图。PNG 输出只需 Python 标准库，会校验 PNG 头、块校验和与结束块。转换为 `.jpg`、`.jpeg`、`.webp` 或接收其他上游图片格式时需要安装 Pillow。标准输出是一行 JSON（路径、模型、尺寸、字节数、SHA-256），失败以非零状态退出，错误信息写到标准错误。脚本不会自动重试，避免上游已生成但返回中断时重复扣费。

后续脚本既可用 subprocess 调用，也可用 `importlib` 加载 `gen-image.py` 的 `load_config()` 与 `generate_image()`。`generate_image()` 要求显式提供 prompt、output、model、base_url、api_key，返回相同的结果字典。

## 已核验的接口

- 文档：`https://docs.deepwl.cn/duoyuanx/zh/images/qwen-image/generation`
- 入口：`POST https://duoyuanx.com/v1/images/generations`
- 鉴权：`Authorization: Bearer <已有令牌>`
- JSON 请求：`model`、`prompt`、`size`（宽x高）、`n: 1`、`watermark: false`
- 响应：优先读 `data[].url` / `data[].b64_json`，兼容 Qwen 的 `metadata.output.choices[].message.content[].image`。

2026-11-01 模型广场列价（仅为当日控制台显示，实际扣费以账户日志为准）：

| 模型 | 当日列价 | 验证范围 |
|---|---|---|
| `qwen-image-3.0` | ¥0.250 / 次 | 已真实生成 PNG |
| `qwen-image-3.0-pro` | ¥0.500 / 次 | 文档、控制台存在，未调用 |
| `gpt-image-2` | ¥0.100 / 次 | 文档、控制台存在，未调用 |
| `gpt-image-2-all` | ¥0.050 / 次 | 控制台存在，未调用 |
| `gpt-image-2.5-flare` | ¥0.150 / 次 | 文档、控制台存在，未调用 |
| `gpt-image-2.5-sunburst` | ¥0.150 / 次 | 文档、控制台存在，未调用 |

控制台截图：`docs/gateway-models-screenshot.png`。仅截取模型广场，不含令牌。

图反推为 T06 可选项，本次没有实现。图像模型文档里的「图生图/编辑」不能作为已经验证的图反推接口。
