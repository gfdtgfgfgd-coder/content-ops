#!/usr/bin/env python3
"""文件式 CLI；参数名与原能力保持一致，子命令 --help 查看详情。"""
import argparse
import importlib
import importlib.util
import os
from pathlib import Path
import sys

COMMANDS = {'migrate-posts': ('store', 'migrate'), 'clean': ('cleaning', 'clean'), 'distill': ('preferences', 'main'), 'audience': ('cleaning', 'audience'), 'package': ('packaging', 'main'), 'install-runtime': ('runtime', 'main')}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=COMMANDS)
    args = parser.parse_args(sys.argv[1:2])
    rest = sys.argv[2:]
    # Keep full sys.argv: a fallback interpreter must retain the subcommand.
    required = ('yaml', 'PIL') if args.command == 'copy' else ('yaml',) if args.command in ('clean', 'distill', 'words') else ()
    if any(importlib.util.find_spec(name) is None for name in required):
        root = Path(__file__).resolve().parents[1]
        for runtime in (root / 'scratch/.venv/bin/python3', root / '.venv/bin/python'):
            if runtime.exists() and Path(sys.executable).absolute() != runtime.absolute():
                os.execv(str(runtime), [str(runtime), *sys.argv])
        parser.error('缺少依赖；请先运行 ./start.command 初始化环境')
    module, function = COMMANDS[args.command]
    return getattr(importlib.import_module('lib.' + module), function)(rest)

if __name__ == '__main__':
    raise SystemExit(main())
