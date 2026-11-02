#!/usr/bin/env python3
"""Install content-ops generation rules and reference assets in Hanabi's local data area."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
FILES=['scripts/gen-xhs-post.py','scripts/gen-image.py','scripts/check-banned-words.py',
       'rules','skills/simin-persona','skills/xhs-title-patterns','skills/xhs-post-generation',
       'data/distilled-preferences.json','data/reference-posts.json','data/xhs','data/xianyu',
       'data/images/xhs','data/images/xianyu','config/data-cleaning.json','requirements.txt']

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target',type=Path,default=Path.home()/'Library/Application Support/Content Alchemy/content-ops')
    parser.add_argument('--config',type=Path,default=ROOT/'scratch/gateway.env')
    parser.add_argument('--background',type=Path,default=ROOT/'data/images/backgrounds/company-qwen-2026-11-01.png')
    args=parser.parse_args()
    if not args.config.is_file():parser.error('未找到本机网关配置；先按 docs/GUIDE.md 配置')
    target=args.target.expanduser().resolve()
    if target==ROOT:parser.error('运行目录不能与源码目录相同')
    for name in FILES:
        source=ROOT/name;destination=target/name;destination.parent.mkdir(parents=True,exist_ok=True)
        if source.is_dir():shutil.copytree(source,destination,dirs_exist_ok=True)
        else:shutil.copy2(source,destination)
    config=target/'scratch/gateway.env';config.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(args.config,config);os.chmod(config,0o600)
    if args.background.is_file():
        background=target/'data/images/backgrounds/company-qwen-2026-11-01.png';background.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(args.background,background)
    else:
        print(f'[WARN] 缓存背景不存在，跳过复制：{args.background}',file=sys.stderr)
    python=target/'.venv/bin/python'
    if not python.exists():subprocess.run([sys.executable,'-m','venv',str(target/'.venv')],check=True)
    subprocess.run([str(python),'-m','pip','install','-r',str(target/'requirements.txt')],check=True)
    print(f'Hanabi 生成与素材运行目录已准备：{target}。已复制全量帖子与图片；未复制企微聊天原文或修改 Hanabi 历史数据。')

if __name__=='__main__':main()
