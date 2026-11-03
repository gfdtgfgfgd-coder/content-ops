#!/usr/bin/env python3
"""仓库体量闸门：查文件数、字节、重复副本、层入口白名单、scratch 保留。

用法:
  python3 scripts/doctor.py                  # 检查并打印报告，超预算退 1
  python3 scripts/doctor.py --json           # 机器可读
  python3 scripts/doctor.py --prune-scratch  # 只保留最近 N 个 scratch 目录
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUDGET = ROOT / "config/repo-budget.json"


def load_budget(path=None):
    with Path(path or BUDGET).open(encoding="utf-8") as f:
        return json.load(f)


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def size_of(rel):
    try:
        return (ROOT / rel).stat().st_size
    except OSError:
        return 0


def duplicate_groups(files, min_bytes):
    by_hash = defaultdict(list)
    for rel in files:
        if size_of(rel) < min_bytes:
            continue
        try:
            digest = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
        except OSError:
            continue
        by_hash[digest].append(rel)
    return [sorted(v) for v in by_hash.values() if len(v) > 1]


def dir_bytes(path):
    total = 0
    for p in Path(path).rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            continue
    return total


def prune_scratch(keep):
    base = ROOT / "scratch"
    if not base.is_dir():
        return []
    dirs = [d for d in base.iterdir() if d.is_dir()]
    dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    removed = []
    for d in dirs[keep:]:
        size = dir_bytes(d)
        shutil.rmtree(d, ignore_errors=True)
        removed.append({"dir": d.name, "kb": round(size / 1024)})
    return removed


def check(budget):
    files = tracked_files()
    total = sum(size_of(f) for f in files)
    errors, warnings = [], []

    limit = budget["tracked_files_max"]
    if len(files) > limit:
        errors.append(f"跟踪文件 {len(files)} 个，预算 {limit}；超出 {len(files) - limit}")
    kb_limit = budget["tracked_kb_max"]
    total_kb = total / 1024
    if total_kb > kb_limit:
        errors.append(f"跟踪体量 {total_kb:.0f} KB，预算 {kb_limit} KB；超出 {total_kb - kb_limit:.0f} KB")

    big = sorted(((size_of(f), f) for f in files), reverse=True)
    cap = budget["single_file_kb_max"] * 1024
    for size, rel in big:
        if size > cap:
            errors.append(f"单文件超限 {size / 1024:.0f} KB > {cap // 1024} KB：{rel}")

    dups = duplicate_groups(files, budget["duplicate_min_kb"] * 1024)
    for group in dups:
        errors.append("完全重复：" + " = ".join(group))

    scratch_kb = dir_bytes(ROOT / "scratch") / 1024 if (ROOT / "scratch").is_dir() else 0
    if scratch_kb > budget["scratch_kb_max"]:
        errors.append(f"scratch {scratch_kb / 1024:.0f} MB，预算 {budget['scratch_kb_max'] / 1024:.0f} MB")

    allow = set(budget.get("scripts_entry_allow") or [])
    scripts = ROOT / "scripts"
    if scripts.is_dir():
        for entry in sorted(scripts.glob("*.py")) + sorted(scripts.glob("*.swift")):
            if entry.name not in allow:
                warnings.append(f"服务层多出的入口：scripts/{entry.name}（白名单只有 {', '.join(sorted(allow))}）")

    per_dir = Counter()
    for rel in files:
        per_dir[rel.split("/")[0]] += 1
    for name, count in sorted(per_dir.items()):
        if count > 20:
            warnings.append(f"{name}/ 有 {count} 个跟踪文件，考虑合并成一个入口或一个文件")

    return {
        "ok": not errors,
        "files": len(files),
        "kb": round(total_kb, 1),
        "largest": [{"file": f, "kb": round(s / 1024, 1)} for s, f in big[:5]],
        "duplicates": dups,
        "errors": errors,
        "warnings": warnings,
        "scratch_kb": round(scratch_kb, 1),
    }


def main():
    parser = argparse.ArgumentParser(description="仓库体量闸门")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--prune-scratch", action="store_true", help="只保留最近 N 个 scratch 目录")
    parser.add_argument("--budget", help="预算文件路径")
    args = parser.parse_args()

    budget = load_budget(args.budget)
    removed = prune_scratch(budget["scratch_keep_dirs"]) if args.prune_scratch else None
    report = check(budget)
    if removed is not None:
        report["scratch_removed"] = removed
        report = check(budget)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"跟踪文件 {report['files']} / {budget['tracked_files_max']}")
        print(f"跟踪体量 {report['kb']} KB / {budget['tracked_kb_max']} KB")
        print(f"scratch {report['scratch_kb'] / 1024:.1f} MB / {budget['scratch_kb_max'] / 1024:.0f} MB")
        print("最大文件：" + "，".join(f"{x['file']} {x['kb']}KB" for x in report["largest"]))
        for item in report["warnings"]:
            print(f"  提醒 {item}")
        for item in report["errors"]:
            print(f"  超限 {item}")
        print("通过" if report["ok"] else "未通过")

    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
