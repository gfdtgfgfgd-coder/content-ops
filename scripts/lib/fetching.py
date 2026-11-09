"""File ingestion and image recovery; browser access remains outside this CLI."""
from __future__ import annotations
import argparse
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from .store import POSTS, ROOT, read_posts, write_posts


def id_from_url(url, platform):
    pattern = r'/explore/([0-9a-zA-Z]+)' if platform == 'xhs' else r'[?&]id=([0-9]+)'
    match = re.search(pattern, url)
    if not match:
        raise ValueError('cannot infer id: ' + url)
    return match.group(1)


def parse_num(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    value = str(value).strip().replace(',', '')
    if not value:
        return None
    if value.endswith('万+'):
        return int(float(value[:-2]) * 10000)
    if value.endswith('万'):
        return int(float(value[:-1]) * 10000)
    match = re.search(r'[0-9]+(?:\.[0-9]+)?', value)
    return int(float(match.group())) if match else None


def norm(rec, platform, url):
    note = {key: rec.get(key, default) for key, default in {
        'author': '', 'title': '', 'images': [], 'image_urls': [], 'tags': [],
        'label': None, 'audience': [], 'audience_raw': '', 'source': 'bookmark',
        'published_at': '', 'published_at_source': '', 'author_id': '', 'metrics_observed_at': '', 'metrics_history': []}.items()}
    note.update(id=str(rec.get('id') or id_from_url(url, platform)), platform=platform, url=url,
                body=rec.get('body', rec.get('desc', '')),
                cover_ocr=rec.get('cover_ocr') or rec.get('title') or '（待补 OCR）',
                is_pinned=bool(rec.get('is_pinned', False)),
                fetched_at=rec.get('fetched_at') or datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds'),
                metrics={key: parse_num((rec.get('metrics') or {}).get(key)) for key in ('likes', 'collects', 'comments', 'wants')})
    return note


def download(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 100:
        return True
    try:
        with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as response:
            data = response.read()
        if len(data) < 100:
            return False
        path.write_bytes(data)
        return True
    except Exception as error:
        print(f'WARN image {url}: {error}', file=sys.stderr)
        return False


def posts_main(argv=None):
    parser = argparse.ArgumentParser(description='导入浏览器已提取 JSON；默认合入唯一 posts.jsonl，已有 id 可断点跳过')
    parser.add_argument('--platform', required=True, choices=['xhs', 'xianyu'])
    parser.add_argument('--urls')
    parser.add_argument('--records', required=True)
    parser.add_argument('--out-dir', type=Path, help='旧目录参数保留，仅用于显式导出；默认写 posts.jsonl')
    parser.add_argument('--output', type=Path, default=POSTS)
    parser.add_argument('--images-root', type=Path, default=Path('data/images'))
    parser.add_argument('--skip-existing', action='store_true')
    parser.add_argument('--ranked', type=Path)
    args = parser.parse_args(argv)
    incoming = json.loads(Path(args.records).read_text(encoding='utf-8'))
    if not isinstance(incoming, list):
        parser.error('--records 必须是数组')
    rows = read_posts(args.output) if args.output.exists() else []
    records = {(row['platform'], row['id']): row for row in rows}
    done, failed = 0, []
    for rec in incoming:
        try:
            rid = id_from_url(rec.get('url', ''), args.platform)
            if rec.get('id') is not None and str(rec['id']) != rid:
                raise ValueError('提取 id 与 URL 不一致')
            destination = args.out_dir / (rid + '.json') if args.out_dir else None
            key = (args.platform, rid)
            if args.skip_existing and ((destination and destination.exists()) or (not destination and key in records)):
                done += 1
                continue
            note = norm(rec, args.platform, rec['url'])
            local = []
            for index, url in enumerate(note['image_urls'], 1):
                ext = '.png' if '.png' in url.lower() else '.jpg'
                path = args.images_root / args.platform / rid / f'{index}{ext}'
                if download(url, path):
                    local.append(str(path))
            note['images'] = local
            if destination:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(json.dumps(note, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            else:
                records[key] = note
                write_posts(list(records.values()), args.output)  # durable per-id checkpoint
            done += 1
        except (ValueError, TypeError, KeyError) as error:
            failed.append({'url': rec.get('url', ''), 'error': str(error)})
    if failed:
        path = ROOT / 'scratch/fetch-failures.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(failed, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.ranked:
        selected = read_posts(args.out_dir or args.output, args.platform)
        selected.sort(key=lambda n: (-(n.get('metrics', {}).get('wants') or 0), n['id']))
        args.ranked.parent.mkdir(parents=True, exist_ok=True)
        args.ranked.write_text('# 闲鱼帖子按想要数排序\n\n' + '\n'.join(
            f"{i}. **{n.get('title', '')}** — {n.get('metrics', {}).get('wants') or 0} 人想要\n   {n.get('url', '')}"
            for i, n in enumerate(selected[:20], 1)) + '\n', encoding='utf-8')
    print(json.dumps({'done': done, 'failed': len(failed)}, ensure_ascii=False))
    return 1 if failed else 0


def images_main(argv=None):
    parser = argparse.ArgumentParser(description='从帖子源重下图片，已有图片跳过')
    parser.add_argument('--data-root', type=Path, default=ROOT / 'data')
    parser.add_argument('--input', type=Path, help='JSONL 源，默认 --data-root/posts.jsonl')
    parser.add_argument('--images-root', type=Path, default=Path('data/images'))
    parser.add_argument('--platform', choices=['all', 'xhs', 'xianyu'], default='all')
    args = parser.parse_args(argv)
    total = ok = 0
    for post in read_posts(args.input or args.data_root / 'posts.jsonl', None if args.platform == 'all' else args.platform):
        for index, url in enumerate(post.get('image_urls', []), 1):
            total += 1
            ext = '.png' if '.png' in url.lower() else '.jpg'
            ok += download(url, args.images_root / post['platform'] / post['id'] / f'{index}{ext}')
    print(json.dumps({'images': total, 'downloaded_or_existing': ok}))
    return 0 if total == ok else 1
