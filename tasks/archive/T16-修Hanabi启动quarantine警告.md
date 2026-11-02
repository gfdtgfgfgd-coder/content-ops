# T16 · 修 Hanabi 启动警告 + 打包时清除 quarantine

执行者：Codex
状态：待开始
依赖：T12（打包流程）
提出：lilith 授权，Claude 规划

## 目标

修两件事：
1. 本机 `releases/Hanabi-2026-11-01-mac-arm64/` 下的 `启动Hanabi.command` 每次双击都弹「移到废纸篓」安全警告，需要去设置里手动同意。另一台电脑本地构建的版本没有这个问题。
2. 下次打包后通过 AirDrop / 网络传输的 ZIP，解压后仍然会复现这个问题，需要在打包脚本里一并修掉。

## 原因诊断

`releases/Hanabi-2026-11-01-mac-arm64/启动Hanabi.command` 上有 `com.apple.quarantine` xattr，值为：

```
0081;6ae83190;sharingd;BE336289-105A-4635-8D51-4F2CCD3D06F6
```

`sharingd` 说明是通过 AirDrop 传输到本机的，macOS Gatekeeper 会对有 quarantine 标记的 `.command` 文件弹安全警告，要求手动在「隐私与安全性」里同意。本机原生构建的文件没有这个标记，所以另一台电脑不受影响。

## 步骤

### 1. 立刻修本机（1 分钟）

**注意：这一步不是脚本，Codex 直接在终端跑：**

```bash
xattr -dr com.apple.quarantine "/Users/mac/Desktop/content-ops/releases/Hanabi-2026-11-01-mac-arm64"
```

`-d` 删除这个属性，`-r` 递归处理目录下所有文件。跑完后双击 `启动Hanabi.command` 不再弹警告。

验证：

```bash
xattr /Users/mac/Desktop/content-ops/releases/Hanabi-2026-11-01-mac-arm64/启动Hanabi.command
```

输出里不再有 `com.apple.quarantine` 即为成功。

### 2. 修打包脚本，下次换机不复现（15 分钟）

找到打包脚本（`releases/Hanabi-2026-11-01-mac-arm64-source.tar.gz` 里的打包脚本，或 `hanabi/scripts/` 下负责生成 ZIP 的脚本）。

在脚本里，`zip` 命令之前加一步：

```bash
# 清除 quarantine，防止 AirDrop 传输后触发 Gatekeeper 弹窗
xattr -cr "$DIST_DIR"
```

`-c` 清除所有 xattr，`-r` 递归。放在 `zip -r ...` 之前，这样打进包里的文件就不带 quarantine。

**如果打包是用 `electron-builder` 的 `--mac dmg`：**

在 `hanabi/package.json` 的 `build` 块里加：

```json
"afterPack": "scripts/after-pack.mjs"
```

新建 `scripts/after-pack.mjs`：

```js
import { execSync } from 'node:child_process';

export default function afterPack({ appOutDir }) {
  execSync(`xattr -cr "${appOutDir}"`, { stdio: 'inherit' });
}
```

**如果打包是手工 zip（T12 风格）：**

在 T12 的打包 shell 脚本里，`zip -r "$ZIP_PATH" .` 之前加：

```bash
xattr -cr .
```

### 3. 更新 releases/README.md 换机说明（5 分钟）

在「另一台电脑复制整个 ZIP、解压后双击启动器」那一段加一条：

> 若启动时仍弹「移到废纸篓」安全警告，在终端跑：
> ```bash
> xattr -dr com.apple.quarantine ~/Desktop/content-ops/releases/Hanabi-2026-11-01-mac-arm64
> ```
> 下次打包后的 ZIP 已不含 quarantine 标记，新包不需要此步骤。

## 产出

- 本机 `releases/Hanabi-2026-11-01-mac-arm64/` 下所有文件的 `com.apple.quarantine` 已删除
- 打包脚本加了 `xattr -cr` 步骤
- `releases/README.md` 加了应急说明

## 验收

- [ ] `xattr releases/Hanabi-2026-11-01-mac-arm64/启动Hanabi.command` 输出里无 `com.apple.quarantine`
- [ ] 双击 `启动Hanabi.command` 不弹警告，Hanabi 正常启动
- [ ] 打包脚本里有 `xattr -cr` 步骤（grep 确认）
- [ ] `releases/README.md` 里有应急说明

## 规矩

- 只删 `com.apple.quarantine`，不删其他 xattr（如 `com.apple.macl`）。`-dr` 精确删除，不用 `-cr`
- 不改 Hanabi 任何代码逻辑，只改打包脚本和文档
- commit message 用中文：「修 Hanabi 启动 quarantine 警告」

## 时间估算

25 分钟（跑命令 1min + 改脚本 15min + 改文档 5min + 验收 4min）

## 完成记录

（Codex 填）
