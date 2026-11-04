# 服务层入口

命令、配置、文件输出与重建顺序的唯一说明见 [操作手册](../docs/GUIDE.md#5-生成脚本与网关配置)。

- `fetch.py posts|images`：导入浏览器提取记录、补图片。
- `build.py migrate-posts|clean|distill|audience|package|install-runtime`：构建数据、偏好与本机启动器。
- `generate.py copy|image`：文案与生图（收费调用前校验输入）。
- `check.py words`：风险词检查，命中退出码 1。
- `doctor.py`：提交前体量检查（失败禁止提交和推送）。
- `ocr-covers.swift`：系统 OCR。

子命令后加 `--help` 查看参数。内部实现只在 `lib/`，不要直接执行或添加同能力入口。
