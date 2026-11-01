#!/usr/bin/env python3
"""Build a local Mac arm64 Hanabi package from the current source and runtime."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / 'scripts/hanabi-package'
EXCLUDED = {'.DS_Store', '__pycache__', '.git', '.env', '.venv', '.transfer-seed'}


def ignore(directory, names):
    return [name for name in names if name in EXCLUDED or name.endswith(('.pyc', '.env'))]


def copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, symlinks=True, ignore=ignore)
    else:
        shutil.copy2(source, target)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, default=Path.home()/'Library/Application Support/Content Alchemy/runtime')
    parser.add_argument('--node', type=Path, default=Path(shutil.which('node') or 'missing-node'))
    parser.add_argument('--python-root', type=Path, default=Path(sys.base_prefix))
    parser.add_argument('--python-packages', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'releases')
    parser.add_argument('--name', default='Hanabi-2026-11-01-mac-arm64')
    args = parser.parse_args()
    if sys.platform != 'darwin' or os.uname().machine != 'arm64':
        parser.error('此构建流程仅打包当前 Mac 的 arm64 运行环境')
    source, runtime = args.source.resolve(), args.runtime.resolve()
    output = args.output.resolve()
    bundle = output / args.name
    archive = output / (args.name + '.zip')
    source_archive = output / (args.name + '-source.tar.gz')
    if any(path.exists() for path in [bundle, archive, source_archive]):
        parser.error('目标已存在；使用新的 --name，不覆盖已有交付')
    output.mkdir(parents=True, exist_ok=True)
    bundle.mkdir()
    app = bundle/'app'
    app.mkdir()
    for name in ['server.mjs', 'app.js', 'index.html', 'styles.css', 'lib/content-ops-production.mjs', 'lib/content-ops-ui.mjs']:
        if digest(source/name) != digest(runtime/name):
            raise RuntimeError(f'开发版与运行版不一致：{name}，请先确认最新版再打包')
    # Explicit code allowlist excludes personal data, credentials and old installers.
    for name in ['server.mjs', 'app.js', 'index.html', 'styles.css', 'package.json', 'package-lock.json', 'electron-main.mjs', 'README.md', 'AGENTS.md', 'lib', 'scripts', 'tests', 'docs', 'knowledge', 'assets']:
        copy(source/name, app/name)
    for name in ['node_modules', '.build/ContentAlchemySpeech.app', '.build/HanabiDocuments.app']:
        copy(runtime/name, app/name)

    content = bundle/'content-ops'
    for name in ['scripts/gen-xhs-post.py', 'scripts/gen-image.py', 'scripts/check-banned-words.py', 'requirements.txt', 'rules', 'skills/simin-persona', 'skills/xhs-title-patterns', 'skills/xhs-post-generation', 'data/images/backgrounds/company-qwen-2026-11-01.png']:
        copy(ROOT/name, content/name)
    content_version = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    for name in ['launcher.mjs', '启动Hanabi.command', '配置公司网关.command', 'configure-gateway.py']:
        copy(TEMPLATES/name, bundle/name)
    for path in bundle.glob('*.command'):
        path.chmod(0o755)
    node = bundle/'runtimes/node/bin/node'
    copy(args.node.resolve(), node)
    node.chmod(0o755)
    python = bundle/'runtimes/python'
    for name in ['lib', 'include', 'share']:
        if not (args.python_root/name).exists():
            continue
        # Site packages from the authoring runtime contain unrelated tools. Take only stdlib.
        target = python/name
        if name == 'lib':
            shutil.copytree(args.python_root/name, target, symlinks=True,
                            ignore=lambda directory, names: ignore(directory,names) + (['site-packages'] if 'site-packages' in names else []))
        else:
            copy(args.python_root/name, target)
    copy(args.python_root/'bin/python3.12', python/'bin/python3.12')
    (python/'bin/python3').symlink_to('python3.12')
    (python/'bin/python').symlink_to('python3.12')
    site = python/'lib/python3.12/site-packages'
    site.mkdir(parents=True, exist_ok=True)
    for path in args.python_packages.iterdir():
        if path.name in ['PIL', 'yaml', '_yaml'] or path.name.startswith(('pillow-', 'pyyaml-')):
            copy(path, site/path.name)
    # Relocate the Python distribution's internal absolute metadata links.
    for path in python.rglob('*'):
        if path.is_symlink() and os.readlink(path).startswith('/'):
            original = Path(os.readlink(path))
            sibling = path.parent/original.name
            if sibling.is_file():
                replacement = original.name
            else:
                relative = original.resolve().relative_to(args.python_root.resolve())
                replacement = os.path.relpath(python/relative, path.parent)
            path.unlink()
            path.symlink_to(replacement)
    # No link in the delivery may depend on the author machine.
    for path in bundle.rglob('*'):
        if path.is_symlink():
            target = os.readlink(path)
            if target.startswith('/'):
                raise RuntimeError(f'程序包包含绝对符号链接：{path.relative_to(bundle)}')

    applet = bundle/'启动Hanabi.app'
    apple_script = '''on run
  set launcherPath to (POSIX path of (path to me)) & "Contents/Resources/launch.sh"
  try
    do shell script (quoted form of launcherPath)
  on error messageText
    display dialog messageText with title "Hanabi 启动提示" buttons {"好"} default button "好"
  end try
end run
'''
    subprocess.run(['/usr/bin/osacompile', '-o', str(applet), '-e', apple_script], check=True)
    plist_path = applet/'Contents/Info.plist'
    with plist_path.open('rb') as stream:
        plist = plistlib.load(stream)
    plist.update(CFBundleIdentifier='com.lilith.hanabi.portable-launcher', CFBundleName='启动Hanabi', CFBundleDisplayName='启动 Hanabi', CFBundleIconFile='hanabi.icns')
    with plist_path.open('wb') as stream:
        plistlib.dump(plist, stream)
    shutil.copy2(source/'assets/app-icon.icns', applet/'Contents/Resources/hanabi.icns')
    launch = applet/'Contents/Resources/launch.sh'
    launch.write_text('''#!/bin/zsh
set -euo pipefail
HANABI_BUNDLE_DIR="$(cd -- "$(dirname -- "$0")/../../.." && pwd -P)"
exec "$HANABI_BUNDLE_DIR/启动Hanabi.command"
''')
    launch.chmod(0o755)
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(applet)], check=True, stdout=subprocess.DEVNULL)

    settings = {}
    for line in (ROOT/'work/gateway.env').read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            if key in ['CONTENT_OPS_BASE_URL', 'CONTENT_OPS_TEXT_MODEL', 'CONTENT_OPS_IMAGE_MODEL']:
                settings[key] = value.strip().strip('\'"')
    settings.setdefault('CONTENT_OPS_TEXT_MODEL', 'claude-sonnet-4-6')
    settings.setdefault('CONTENT_OPS_IMAGE_MODEL', 'qwen-image-3.0')
    for key in ['CONTENT_OPS_BASE_URL', 'CONTENT_OPS_TEXT_MODEL', 'CONTENT_OPS_IMAGE_MODEL']:
        if not settings.get(key):
            raise RuntimeError('本机非私密网关配置不完整：' + key)
    (bundle/'gateway.env.example').write_text(''.join(f'{key}={value}\n' for key,value in settings.items())+'CONTENT_OPS_API_KEY=请在本机配置，不要提交\n')
    (bundle/'使用说明.md').write_text('''# Hanabi 最新程序包 · 2026-11-01

这份是 11 月 1 日接入小红书生成器后的当前源码和可运行程序，适用于 Apple Silicon Mac（M 系列），不是 10 月 18 日的旧 DMG。

## 启动

1. 解压 ZIP，保留整个文件夹；双击「启动Hanabi.app」。也可双击「启动Hanabi.command」。
2. 启动器会把运行文件安装到本机应用数据目录，确认后台服务就绪后打开浏览器中的 Hanabi。以后双击同一个启动器即可。首次复制运行环境稍久。
3. 本机已有模型配置、资料库与历史仍在原位置使用。另一台电脑首次运行，请先双击「配置公司网关.command」输入公司 Key；程序包不携带令牌或订阅登录态。普通对话的模型仍从界面左下角「接入」配置。
4. 内容工作台展开「生成小红书图文」：GLM5.3／小红书／数量 2／复用已有背景，再点生成。

Node、Python、Pillow、PyYAML、生成规则和已有背景均已随包带上，首次启动无需 npm 或 pip 下载。新背景仍取决于公司账户额度。浏览器抓取、Codex 订阅等外部连接需在新电脑另行安装或登录原有工具。

如果 macOS 要求确认打开本地程序，可在 Finder 中右键启动器选择「打开」。这份是本地签名程序，未经过 Apple 公证。

## 包含内容

- app/：最新 Hanabi 源码、生产依赖、文档、测试和两个原生助手。
- content-ops/：生成脚本、偏好与风险规则、封面背景。
- runtimes/：本机同架构的 Node 和 Python，以及图像与 YAML 依赖。
- 启动Hanabi.app、启动Hanabi.command：日常启动入口；配置公司网关.command：换机本地配置。
- manifest.json：核心版本与文件 SHA-256 清单。运行「启动Hanabi.command --verify」校验，「--self-test」做隔离离线启动检查，不收费调用模型。

程序包没有聊天数据库、附件资料库、企微原文、公司令牌或登录态。需要迁移个人历史时另行备份 `~/Library/Application Support/Content Alchemy/`，请勿把该目录直接提交 Git。

## 安装位置

服务：`http://127.0.0.1:6187`，仅本机监听。

源码运行副本及工具：`~/Library/Application Support/Content Alchemy/portable/<本包版本>/`。
后台运行代码：`~/Library/Application Support/Content Alchemy/runtime/`。
脚本和本机网关配置：`~/Library/Application Support/Content Alchemy/content-ops/`。

启动器沿用现有安全部署脚本；有正在运行的对话或生成任务时会提示，待任务完成再打开。它不会替换现有数据库、上传文件或用户知识档案。

完整 ZIP 是本地程序包，体积超过普通 Git 单文件限制，保留在 releases/。同目录另有源码快照可通过 Git 同步；源码快照需要自行安装运行环境和依赖，不等于完整 ZIP。
''',encoding='utf-8')
    version_hash = hashlib.sha256(b''.join((source/name).read_bytes() for name in ['server.mjs','app.js','index.html','styles.css'])).hexdigest()[:12]
    manifest = {'format':'hanabi-local-package','version':1,'bundleVersion':args.name+'-'+version_hash,
                'createdAt':datetime.now(timezone.utc).isoformat(),'platform':'darwin','architecture':'arm64',
                'contentOpsCommit':content_version,'gatewayDefaults':settings,
                'excludes':['personal library.sqlite','uploads','gateway.env','subscription credentials','wecom raw'], 'files':{}}
    for path in sorted(bundle.rglob('*')):
        relative = path.relative_to(bundle).as_posix()
        if path.is_symlink():
            manifest['files'][relative] = {'symlink':os.readlink(path)}
        elif path.is_file():
            manifest['files'][relative] = {'bytes':path.stat().st_size,'sha256':digest(path)}
    manifest['bundleVersion'] = args.name+'-'+hashlib.sha256(json.dumps(manifest['files'],sort_keys=True).encode()).hexdigest()[:12]
    (bundle/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    subprocess.run([str(node),str(bundle/'launcher.mjs'),'--verify'],check=True)
    # Source snapshot is small enough for Git; never include binaries/dependencies or credentials.
    def source_filter(info):
        parts=Path(info.name).parts
        if any(part in ['runtimes','node_modules','.build','启动Hanabi.app'] for part in parts):
            return None
        return info
    with tarfile.open(source_archive,'w:gz') as stream:
        stream.add(bundle, arcname=args.name, filter=source_filter)
    print('正在压缩完整程序包……',flush=True)
    subprocess.run(['/usr/bin/ditto','-c','-k','--norsrc','--noextattr','--noqtn','--keepParent',str(bundle),str(archive)],check=True)
    checksum = archive.with_suffix('.zip.sha256')
    checksum.write_text(f'{digest(archive)}  {archive.name}\n')
    print(json.dumps({'bundle':str(bundle),'zip':str(archive),'zipBytes':archive.stat().st_size,
                      'source':str(source_archive),'sourceBytes':source_archive.stat().st_size,
                      'fileCount':len(manifest['files'])},ensure_ascii=False))


if __name__=='__main__':
    main()
