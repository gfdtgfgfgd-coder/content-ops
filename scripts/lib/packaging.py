"""Build a local macOS launcher; the checkout remains the sole source (no ZIP copy)."""
import argparse
import json
from pathlib import Path
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main(argv=None):
    parser = argparse.ArgumentParser(description='从当前源码构建本机启动器 App；不复制仓库、个人数据或令牌，不再发布 ZIP')
    parser.add_argument('--source', type=Path, default=ROOT / 'hanabi')
    parser.add_argument('--runtime', type=Path, help='旧参数保留：不再复制独立运行环境')
    parser.add_argument('--node', type=Path, default=Path(shutil.which('node') or 'missing-node'))
    parser.add_argument('--python-root', type=Path, help='旧参数保留：使用当前本机 Python')
    parser.add_argument('--python-packages', type=Path, help='旧参数保留：依赖由 requirements.txt 安装')
    parser.add_argument('--output', type=Path, default=ROOT / 'releases')
    parser.add_argument('--name', default='Hanabi')
    args = parser.parse_args(argv)
    if sys.platform != 'darwin':
        parser.error('图标构建需要 macOS 的 sips 和 iconutil')
    if Path(args.name).name != args.name or args.name in ('', '.', '..'):
        parser.error('--name 必须是单层文件名')
    source = args.source.expanduser().resolve()
    node = args.node.expanduser().resolve()
    if not node.is_file() or not (source / 'server.mjs').is_file():
        parser.error('需要有效的 --source/server.mjs 与 --node')
    destination = args.output.expanduser().resolve() / (args.name + '.app')
    if destination.exists():
        parser.error('目标已存在；使用新的 --name，不覆盖已有交付')
    # The temporary iconset never enters the source tree, including on failure.
    with tempfile.TemporaryDirectory(prefix='hanabi-package-') as temporary:
        stage = Path(temporary) / destination.name
        resources = stage / 'Contents/Resources'
        executable = stage / 'Contents/MacOS/hanabi'
        resources.mkdir(parents=True)
        executable.parent.mkdir(parents=True)
        iconset = Path(temporary) / 'app-icon.iconset'
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                suffix = '@2x' if scale == 2 else ''
                subprocess.run(['/usr/bin/sips', '-z', str(size * scale), str(size * scale),
                                str(source / 'assets/app-icon-1024.png'), '--out',
                                str(iconset / f'icon_{size}x{size}{suffix}.png')],
                               check=True, capture_output=True)
        subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(resources / 'app-icon.icns')], check=True)
        plist = {'CFBundleIdentifier': 'com.lilith.hanabi.local-launcher', 'CFBundleName': 'Hanabi',
                 'CFBundleDisplayName': 'Hanabi·灵感如火花般闪现', 'CFBundlePackageType': 'APPL',
                 'CFBundleExecutable': 'hanabi', 'CFBundleIconFile': 'app-icon.icns', 'CFBundleVersion': '1'}
        with (stage / 'Contents/Info.plist').open('wb') as stream:
            plistlib.dump(plist, stream)
        executable.write_text('''#!/bin/zsh
set -euo pipefail
export PATH=''' + shlex.quote(str(node.parent)) + ''':"$PATH"
url='http://127.0.0.1:6187'
if ! /usr/bin/curl --fail --silent "$url/healthz" >/dev/null; then
  mkdir -p "$HOME/Library/Logs/Hanabi"
  cd ''' + shlex.quote(str(source)) + '''
  nohup ''' + shlex.quote(str(node)) + ''' server.mjs >>"$HOME/Library/Logs/Hanabi/server.log" 2>&1 </dev/null &
fi
for attempt in {1..60}; do
  if /usr/bin/curl --fail --silent "$url/healthz" >/dev/null; then
    /usr/bin/open "$url"
    exit 0
  fi
  sleep 0.5
done
exit 1
''', encoding='utf-8')
        executable.chmod(0o755)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stage, destination)
    print(json.dumps({'app': str(destination), 'source': str(source), 'icon': 'generated from assets/app-icon-1024.png',
                      'portable': False, 'runtime': '本机 Node；源码目录不能移动，换机从 Git 安装'}, ensure_ascii=False))
    return 0
