"""Shared file IO and risk-rule adapter for the data-cleaning CLIs."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config/data-cleaning.json"


def checker_module():
    """Use the existing checker, including its platform/model/regex semantics."""
    if importlib.util.find_spec("yaml") is None:
        runtime = ROOT / "scratch/.venv/bin/python3"
        if runtime.exists() and Path(sys.executable).resolve() != runtime.resolve():
            os.execv(str(runtime), [str(runtime), *sys.argv])
        raise SystemExit("缺少 PyYAML，请先安装 requirements.txt（推荐 scratch/.venv）")
    spec = importlib.util.spec_from_file_location("content_ops_banned", ROOT / "scripts/check-banned-words.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arguments(description, profile, with_rules=True):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--profile", default=profile, help="配置中的平台 profile")
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, help="省略时原地增加字段")
    parser.add_argument("--report", type=Path, help="另存完整 JSON 报告；终端始终打印摘要")
    parser.add_argument("--dry-run", action="store_true", help="只计算差异，不写帖子")
    if with_rules:
        parser.add_argument("--rules", type=Path)
        parser.add_argument("--platform", help="覆盖 profile 的风险词平台范围")
    return parser


def configuration(args):
    config = json.loads(args.config.read_text(encoding="utf-8"))
    profile = config["profiles"][args.profile]
    # Config-relative inputs are repository-relative, so commands work from any cwd.
    source = args.input_dir or ROOT / profile["input_dir"]
    target = args.output_dir or source
    return config, profile, source, target


def posts(directory):
    if not directory.is_dir():
        raise ValueError(f"输入目录不存在：{directory}")
    records = []
    for path in sorted(directory.glob("*.json")):
        if path.name.startswith("_"):
            continue
        raw = path.read_text(encoding="utf-8")
        item = json.loads(raw)
        if not isinstance(item, dict) or not item.get("id"):
            raise ValueError(f"不是带 id 的帖子 JSON：{path}")
        records.append((path, item, raw))
    if len({str(item["id"]) for _, item, _ in records}) != len(records):
        raise ValueError("帖子 id 重复，请先处理输入数据")
    return records


def field_text(value):
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(str(part) for part in value)
    return str(value)


def risk_signal(item, config, profile, platform, checker, rules):
    model_context = "\n".join(field_text(item.get(field)) for field in config["model_context_fields"])
    matches = []
    for field in config["scan_fields"]:
        for hit in checker.check(field_text(item.get(field)), platform, model_context, rules=rules):
            match = {"field": field, **hit}
            if match not in matches:
                matches.append(match)
    return {
        "banned_word_hits": list(dict.fromkeys(hit["rule"] for hit in matches)),
        "banned_word_scope": "|".join(dict.fromkeys(hit["field"] for hit in matches)),
        **profile.get("policy_flags", {}),
    }


def nonnegative_number(value, context):
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        raise ValueError(f"{context} 应为非负数字或 null，实际为 {value!r}")
    return value


def preserve_json(raw, before, after):
    """Replace only changed top-level values; preserve captured text byte-for-byte."""
    decoder = json.JSONDecoder()
    position = raw.index("{") + 1
    spans = {}
    while True:
        position = re.compile(r"\s*").match(raw, position).end()
        if raw[position] == "}":
            closing = position
            break
        key, position = decoder.raw_decode(raw, position)
        position = re.compile(r"\s*:\s*").match(raw, position).end()
        start = position
        _, position = decoder.raw_decode(raw, position)
        spans[key] = (start, position)
        position = re.compile(r"\s*").match(raw, position).end()
        if raw[position] == ",":
            position += 1
    edits = []
    for key in before:
        if before[key] != after[key]:
            value = json.dumps(after[key], ensure_ascii=False, indent=2).replace("\n", "\n  ")
            edits.append((*spans[key], value))
    added = [key for key in after if key not in before]
    if added:
        # Insert after the last original value, before its trailing whitespace.
        insertion = max(end for _, end in spans.values()) if spans else closing
        values = []
        for key in added:
            encoded = json.dumps(after[key], ensure_ascii=False, indent=2).replace("\n", "\n  ")
            values.append(f'  {json.dumps(key, ensure_ascii=False)}: {encoded}')
        edits.append((insertion, insertion, ("," if spans else "") + "\n" + ",\n".join(values)))
    for start, end, value in sorted(edits, reverse=True):
        raw = raw[:start] + value + raw[end:]
    if json.loads(raw) != after:
        raise ValueError("JSON 写入校验失败")
    return raw


def atomic_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(text)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save_post(source, target, raw, before, after, dry_run):
    destination = target / source.name
    changed = before != after or not destination.exists()
    if changed and not dry_run:
        atomic_text(destination, preserve_json(raw, before, after))
    return changed


def report_result(report, path):
    if path:
        atomic_text(path, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "details"}, ensure_ascii=False, indent=2))
