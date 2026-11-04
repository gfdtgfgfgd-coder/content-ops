---
name: hanabi-packaging
description: 打包当前本机 Hanabi 与双击启动器，从唯一 PNG 重建本机 macOS 启动器；不制作 ZIP 或复制独立运行时。
---

# Hanabi 程序打包

用于用户明确要求备份或交付 Hanabi 程序。程序包与个人资料迁移分别处理；没有明确要求时不复制聊天数据库、上传资料、公司令牌、登录态或企微原文。

1. 读 `AGENTS.md`、任务卡与 `docs/GUIDE.md`。当前交付策略是 Git 源码加本机启动器，不恢复旧 ZIP / 双份源码包。
2. 在仓库根目录运行 `python3 scripts/build.py package --help`。默认 `python3 scripts/build.py package` 生成被忽略的 `releases/Hanabi.app`；需要隔离验收时传 `--output scratch/<任务>/packages`，已有目标不覆盖。
3. `--source` 指定包含 `server.mjs` 与 `assets/app-icon-1024.png` 的源码目录，`--node` 指定本机 Node。旧 `--runtime`、`--python-root`、`--python-packages` 仅保留解析兼容，**不再复制运行时**，不得承诺便携运行或换机免安装。
4. 图标唯一源是 1024 PNG。构建在系统临时目录用 `sips` / `iconutil` 生成 iconset 与 icns，只把 icns 放进成品 App，临时目录自动删除；不要把派生图标重新提交。
5. 校验 App 的 Info.plist、启动脚本语法、图标尺寸与像素、实际源码和 Node 路径。启动器沿用健康的 6187 服务，不停止真实生成任务；测试服务须使用隔离端口和资料目录。不为打包验收调用收费模型。
6. 启动器使用当前源码与本机 Node，源码目录移动后应重建；Python 依赖、网关配置按 GUIDE 准备，凭证、聊天库和附件不放进 App。App 是可删重建的本机派生物，换机仍克隆 Git 并执行 `start.command`。
7. 交付时写清 App 路径、本机依赖与换机要求。更新任务卡和 README，先跑 `python3 scripts/doctor.py`；退出码非 0 时不提交或推送，也不把未验收工作标完成。

## 前端布局验收

1. 使用 ego-browser，在同一任务空间访问实际运行地址。精简 HTML 后逐一核对所有媒体查询中的网格轨道：侧栏和主区两个子元素不能保留旧 resizer 的 8px 中间列；导航文字不能落入已移除图标的窄列。
2. 检查生成图文、素材库、思敏偏好、风险词、预览五页。`hidden`、`.active`、导航当前页与 URL hash 须一致；刷新当前页应恢复，切页应回到顶部。
3. 在 1440、768、390px 实测并截图，实际查看截图。记录主区宽度与 `document.documentElement.scrollWidth`，后者不得超过视口；宽表只在自身容器滚动，长正则可换行，不得挤成单字竖排。
4. 验证素材数量、分页、排序、引用/清空、引用定位、图片及表单打开/取消。沿用实际历史数据；无历史批次时如实记录，预览可映射现有素材做纯内存验收，随后刷新清除，不能伪造保存批次或为布局测试调用收费模型。
5. 运行相关 JavaScript 的 `node --check`、`git diff --check` 和健康端点检查。临时报告与截图放 `scratch/`；验收数量、命令结果、截图路径写入任务卡完成记录。
