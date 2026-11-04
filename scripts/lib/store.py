"""The sole post dataset reader and lossless, fail-closed legacy migration."""
from __future__ import annotations
import argparse
from collections import Counter
import json
from pathlib import Path
import shutil
import tempfile
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
POSTS = ROOT / 'data/posts.jsonl'


def read_posts(path=POSTS, platform=None):
    path = Path(path)
    if path.is_dir():  # Only explicit legacy inputs, never an implicit fallback.
        rows = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(path.glob('*.json'))
                if not p.name.startswith('_')]
    else:
        rows = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row.get('platform'):
            raise ValueError(f'帖子必须含字符串 id 和 platform：{path}')
        key = row['id']
        if key in seen:
            raise ValueError(f'重复帖子 id：{key}')
        seen.add(key)
    return [row for row in rows if platform is None or row['platform'] == platform]


def load_posts(platform=None):
    return read_posts(POSTS, platform)


def post_count():
    return len(load_posts())


def write_posts(rows, path=POSTS):
    path = Path(path)
    encoded = ''.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n'
                      for row in sorted(rows, key=lambda p: (p['platform'], p['id'])))
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(encoded)
    try:
        if sorted(read_posts(temporary), key=lambda p: (p['platform'], p['id'])) != sorted(rows, key=lambda p: (p['platform'], p['id'])):
            raise ValueError('写入后逐字段校验失败')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def migration_markdown(report):
    """Rebuildable audit: digests reference large URLs without duplicating source data."""
    import hashlib

    def cell(value, field):
        encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        if field in ('cover', 'url', 'xsec'):
            return 'SHA256 `' + hashlib.sha256(encoded.encode('utf-8')).hexdigest() + '`'
        return '`' + encoded.replace('`', '&#96;').replace('|', '&#124;').replace('\n', ' ') + '`'

    lines = ['| # | 帖子 id | 字段 | 旧索引值 | 帖子值 |', '|---|---|---|---|---|']
    for index, diff in enumerate(report['differences'], 1):
        lines.append(f"| {index} | `{diff['id']}` | {diff['field']} | {cell(diff['index'], diff['field'])} | {cell(diff['post'], diff['field'])} |")
    return '\n'.join(lines) + '\n'


def migrate(argv=None):
    parser = argparse.ArgumentParser(description='无损迁移；索引/清单任一不一致则不删除任何旧数据，退出码 1')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--config', type=Path, default=Path('config/data-cleaning.json'))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--report', type=Path, required=True, help='逐项差异 JSON，建议放 scratch/')
    parser.add_argument('--markdown-report', type=Path, help='可选逐项审计表；长 URL 记录完整 JSON 值的 SHA256，原值仍在 JSON 报告与源数据')
    parser.add_argument('--delete-legacy', action='store_true', help='仅全部验证通过才删除旧目录')
    args = parser.parse_args(argv)
    root = args.root.resolve()
    config = json.loads((root / args.config).read_text(encoding='utf-8'))
    rows, directories = [], []
    for platform in config['profiles']:
        directory = root / 'data' / platform
        directories.append(directory)
        for path in sorted(directory.glob('*.json')):
            if path.name.startswith('_'):
                continue
            post = json.loads(path.read_text(encoding='utf-8'))
            if str(post.get('id')) + '.json' != path.name or post.get('platform') != platform:
                raise ValueError(f'文件名/id/platform 不变量失败：{path}')
            rows.append(post)
    counts = dict(Counter(row['platform'] for row in rows))
    if counts != config['migration_expected_counts'] or len({row['id'] for row in rows}) != len(rows):
        raise ValueError(f'迁移数量或 id 唯一性校验失败：{counts}')
    output = args.output or root / config['posts_file']
    for target in filter(None, (output, args.report, args.markdown_report)):
        if any(target.resolve() == directory.resolve() or directory.resolve() in target.resolve().parents for directory in directories):
            raise ValueError('输出或核验报告不能放在待删除旧目录内')
    if output.exists() and read_posts(output) != sorted(rows, key=lambda p: (p['platform'], p['id'])):
        raise ValueError('目标已存在且不同于旧源；不覆盖后续编辑，请指定另一 --output')
    write_posts(rows, output)
    by_id = {row['id']: row for row in read_posts(output)}
    diffs = []
    for profile in config.get('migration_indexes', []):
        index = json.loads((root / profile['index']).read_text(encoding='utf-8'))
        urls = (root / profile['urls']).read_text(encoding='utf-8').splitlines()
        expected = config['migration_expected_counts'][profile['platform']]
        if len(index) != expected or len(urls) != expected or len({r['id'] for r in index}) != expected:
            raise ValueError('索引/清单数量或唯一性校验失败')
        for row in index:
            post = by_id.get(row['id'])
            if post is None or post['platform'] != profile['platform']:
                raise ValueError('索引存在未知 id：' + row['id'])
            # Compare the old fields without inventing a missing source value.
            values = {'title': post.get('title'), 'likes': (post.get('metrics') or {}).get('likes'),
                      'sticky': post.get('is_pinned'), 'cover': (post.get('image_urls') or [None])[0],
                      'xsec': parse_qs(urlparse(post.get('url', '')).query).get('xsec_token', [None])[0],
                      'type': post.get('type')}
            for field, actual in values.items():
                expected_value = row.get(field)
                # Index likes are UI strings: empty is the captured zero state.
                if field == 'likes':
                    expected_value = int(expected_value or 0)
                if expected_value != actual:
                    diffs.append({'id': row['id'], 'field': field, 'index': row.get(field), 'post': actual})
        if len(set(urls)) != expected:
            raise ValueError('URL 清单存在重复或缺失，保留旧数据')
        url_ids = [Path(urlparse(url).path).name for url in urls]
        if len(set(url_ids)) != expected or set(url_ids) != {row['id'] for row in index}:
            raise ValueError('URL 清单 id 与索引不一致，保留旧数据')
        for url in urls:
            identifier = Path(urlparse(url).path).name
            actual = by_id.get(identifier, {}).get('url')
            if actual != url:
                diffs.append({'id': identifier, 'field': 'url', 'index': url, 'post': actual})
    report = {'counts': counts, 'total': len(rows), 'lossless': True, 'differences': diffs,
              'deleted': bool(args.delete_legacy and not diffs), 'output': str(output)}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.markdown_report:
        args.markdown_report.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_report.write_text(migration_markdown(report), encoding='utf-8')
    if args.delete_legacy and not diffs:
        for directory in directories:
            shutil.rmtree(directory)
    print(json.dumps({k: v for k, v in report.items() if k != 'differences'} | {'differences': len(diffs)}, ensure_ascii=False))
    return 1 if diffs else 0
