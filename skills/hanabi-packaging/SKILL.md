---
name: hanabi-packaging
description: 打包当前本机 Hanabi 与双击启动器，制作 macOS arm64 可运行交付及可同步源码快照。
---

# Hanabi 程序打包

用于用户明确要求备份或交付 Hanabi 程序。程序包与个人资料迁移分别处理；没有明确要求时不复制聊天数据库、上传资料、公司令牌、登录态或企微原文。

1. 读当前 Hanabi 开发目录和 content-ops 的 AGENTS.md；比对开发代码与 `~/Library/Application Support/Content Alchemy/runtime`，确认所打包版本。
2. 使用 `scripts/package-hanabi.py --help` 的参数指定源码、已部署运行目录、Node、独立 Python 根目录、Pillow/PyYAML 所在 site-packages、输出路径和新的包名。默认构建本机 Apple Silicon 包，不冒充 Intel 或 universal 版本。
3. 打包脚本按白名单携带源码、生产依赖、原生助手、Node/Python、生成规则与背景。Python 自带开发元数据的旧绝对链接必须重定位，包内不能依赖原开发目录。
4. 完整 ZIP 和解压程序目录在 releases 下本机保留；源码 tar.gz、SHA-256、交付说明和打包脚本可入 Git。不要强行提交超过普通 Git 限制的 ZIP。
5. 从 ZIP 解压副本执行 `启动Hanabi.command --self-test`，确认健康端点、最新图文表单、无令牌状态和离线中文封面。此测试不调用收费模型、不读写真实资料库。
6. 校验 ZIP CRC、SHA-256、manifest 文件哈希、源码对应关系和启动器签名；扫描本机已知令牌，结果只报告通过与否，不输出令牌。
7. 测试启动器打开真实 Hanabi；沿用原服务，不中断任务。部署沿用 `install-background-service.mjs`，保留已有数据库、附件、知识和配置。
8. 交付时写清完整 ZIP 所在位置、双击入口、架构和换机配置要求；更新任务卡、README、总表，中文 commit 并 push。
