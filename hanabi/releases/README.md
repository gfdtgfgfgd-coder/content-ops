# Hanabi 程序包

T19 精简版本地 ZIP：`Hanabi-2026-11-03-t19-mac-arm64.zip`（约 453 KB）。

ZIP 只包含 Hanabi 精简源码、生成脚本所需规则与数据入口，不携带旧版独立 Node/Python 运行时、企微原文、个人数据库、附件或令牌。新电脑需要先安装 Node.js 22.13+、Python 3.9+，再运行仓库根目录的 `setup-new-mac.sh`；本机网关凭证放在 `scratch/gateway.env`，不要提交。

服务默认监听 `http://127.0.0.1:6187`。`/v1/*` 只做请求透传，业务偏好和风险词由生成脚本处理。
