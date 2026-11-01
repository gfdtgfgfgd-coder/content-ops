#!/usr/bin/env python3
"""Configure the generation gateway locally without including a key in the bundle."""
from pathlib import Path
import getpass
import json
import os

root = Path(__file__).resolve().parent
settings = json.loads((root / 'manifest.json').read_text())['gatewayDefaults']
target = Path.home() / 'Library/Application Support/Content Alchemy/content-ops/work/gateway.env'
print('配置 Hanabi 小红书生成的公司网关。Key 仅写入这台电脑，输入时不显示。')
if target.exists():
    answer = input('这台电脑已有配置。输入 yes 才替换，直接回车保留：').strip()
    if answer != 'yes':
        print('已保留原配置。')
        raise SystemExit(0)
endpoint = input(f"网关地址 [{settings['CONTENT_OPS_BASE_URL']}]：").strip() or settings['CONTENT_OPS_BASE_URL']
key = getpass.getpass('公司 API Key：').strip()
if not key or any(c in key + endpoint for c in '\r\n'):
    raise SystemExit('地址和 Key 不能为空或含换行，未写入。')
settings['CONTENT_OPS_BASE_URL'] = endpoint
settings['CONTENT_OPS_API_KEY'] = key
target.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.fchmod(fd, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(''.join(f'{name}={value}\n' for name, value in settings.items()))
print('配置已保存在本机。重新打开 Hanabi，选择复用已有背景即可。新背景仍需账户有额度。')
