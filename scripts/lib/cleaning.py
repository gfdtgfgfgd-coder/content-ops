"""Shared file IO and risk-rule adapter for the data-cleaning CLIs."""
from __future__ import annotations

from collections import Counter
import copy
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "config/data-cleaning.json"


from . import words
from .store import read_posts, write_posts

def checker_module():
    return words

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
    source = args.input_dir or ROOT / config["posts_file"]
    target = args.output_dir or source
    return config, profile, source, target


def posts(source, platform):
    return [(Path(str(item['id']) + '.json'), item, json.dumps(item, ensure_ascii=False))
            for item in read_posts(source, platform)]

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


def record_change(source, target, raw, before, after, dry_run, updates):
    changed = before != after
    updates.append(after)
    return changed


def finish_updates(source, target, updates, dry_run):
    if dry_run:
        return
    if source.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        for item in updates:
            path = target / (str(item['id']) + '.json')
            encoded = json.dumps(item, ensure_ascii=False, indent=2) + '\n'
            if not path.exists() or json.loads(path.read_text()) != item:
                atomic_text(path, encoded)
    else:
        replacements = {(p['platform'], p['id']): p for p in updates}
        result = [replacements.get((p['platform'], p['id']), p) for p in read_posts(source)]
        destination = target / source.name if target.is_dir() else target
        if destination != source or result != read_posts(source):
            write_posts(result, destination)


def report_result(report, path):
    if path:
        atomic_text(path, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "details"}, ensure_ascii=False, indent=2))


def clean_xhs(argv=None):
    args = arguments(__doc__, "xhs").parse_args(argv)
    config, profile, source, target = configuration(args)
    checker = checker_module()
    rules = checker.load_rules(args.rules or ROOT / config["rules"])
    platform = args.platform or profile["platform"]
    updates = []
    report = {"total": 0, "changed": 0, "tiers": Counter(), "good": 0,
              "dirty_good": 0, "with_banned_words": 0, "dry_run": args.dry_run, "details": []}
    for path, item, raw in posts(source, profile["platform"]):
        updated = copy.deepcopy(item)
        metrics = item.get("metrics") or {}
        good = (item.get("label") or {}).get("good") is True
        values = {key: nonnegative_number(metrics.get(key), f"{path.name}:metrics.{key}")
                  for key in profile["interaction_metrics"]}
        if good:
            tier = "good"
        elif any(values[key] >= limit for key, limit in profile["high_metrics"].items()):
            tier = "high"
        elif any(values.values()):
            tier = "mid"
        else:
            tier = "low"
        signal = {**(item.get("signal") or {}), **risk_signal(item, config, profile, platform, checker, rules)}
        signal.update(engagement_tier=tier, clean_for_style_reference=good and not signal["banned_word_hits"])
        updated["signal"] = signal
        report["total"] += 1
        report["changed"] += record_change(path, target, raw, item, updated, args.dry_run, updates)
        report["tiers"][tier] += 1
        report["good"] += good
        report["dirty_good"] += good and bool(signal["banned_word_hits"])
        report["with_banned_words"] += bool(signal["banned_word_hits"])
        if signal["banned_word_hits"]:
            report["details"].append({"id": item["id"], "good": good, "hits": signal["banned_word_hits"]})
    finish_updates(source, target, updates, args.dry_run)
    report_result(report, args.report)



def clean_xianyu(argv=None):
    parser = arguments(__doc__, "xianyu")
    parser.add_argument("--ranked-file", type=Path, help="仅为缺失 wants 提供有来源的回填")
    args = parser.parse_args(argv)
    config, profile, source, target = configuration(args)
    checker = checker_module()
    rules = checker.load_rules(args.rules or ROOT / config["rules"])
    platform = args.platform or profile["platform"]
    ranked_path = args.ranked_file or ROOT / profile["ranked_file"]
    ranked = {}
    if ranked_path.exists():
        for wants, identifier in re.findall(profile["ranked_entry_pattern"], ranked_path.read_text(encoding="utf-8")):
            value = int(wants.replace(",", ""))
            if identifier in ranked and ranked[identifier] != value:
                raise ValueError(f"排名文件同一 id 有冲突：{identifier}")
            ranked[identifier] = value
    records = posts(source, profile["platform"])
    prepared = []
    field = profile["wants_field"]
    updates = []
    report = {"total": len(records), "changed": 0, "backfilled_wants": 0, "tiers": Counter(),
              "with_banned_words": 0, "ranked_missing": not ranked_path.exists(),
              "dry_run": args.dry_run, "details": []}
    for path, item, raw in records:
        updated = copy.deepcopy(item)
        metrics = updated.setdefault("metrics", {})
        if metrics is None:
            metrics = updated["metrics"] = {}
        identifier = str(item["id"])
        if metrics.get(field) is None and identifier in ranked:
            metrics[field] = ranked[identifier]
            report["backfilled_wants"] += 1
        wants = nonnegative_number(metrics.get(field), f"{path.name}:metrics.{field}")
        prepared.append((path, item, updated, raw, wants))
    ordered = sorted(prepared, key=lambda record: (-record[4], str(record[1]["id"])))
    ranks = {str(item["id"]): rank for rank, (_, item, _, _, wants) in enumerate(ordered, 1) if wants > 0}
    for path, item, updated, raw, wants in prepared:
        rank = ranks.get(str(item["id"]))
        tier = "none" if rank is None else "top" if rank <= profile["top_count"] else "mid" if rank <= profile["reference_count"] else "low"
        signal = {**(item.get("signal") or {}), **risk_signal(item, config, profile, platform, checker, rules)}
        signal.update(wants_tier=tier, style_reference_rank=rank, no_wants_signal=wants == 0,
                      clean_for_style_reference=rank is not None and rank <= profile["reference_count"] and not signal["banned_word_hits"])
        updated["signal"] = signal
        report["changed"] += record_change(path, target, raw, item, updated, args.dry_run, updates)
        report["tiers"][tier] += 1
        report["with_banned_words"] += bool(signal["banned_word_hits"])
        report["details"].append({"id": item["id"], "wants": updated.get("metrics", {}).get(field),
                                   "rank": rank, "tier": tier, "hits": signal["banned_word_hits"]})
    finish_updates(source, target, updates, args.dry_run)
    report_result(report, args.report)



def audience(argv=None):
    args = arguments(__doc__, "xhs", with_rules=False).parse_args(argv)
    config, profile, source, target = configuration(args)
    settings = config["audience"]
    raw_field, output_field = settings["raw_field"], settings["output_field"]
    updates = []
    report = {"total": 0, "changed": 0, "raw_nonempty": 0, "parsed_lists": 0,
              "missing_lists": 0, "preserved_existing": 0, "dry_run": args.dry_run, "details": []}
    for path, item, raw in posts(source, profile["platform"]):
        updated = copy.deepcopy(item)
        text = item.get(raw_field) or ""
        report["total"] += 1
        if text.strip():
            report["raw_nonempty"] += 1
            match = re.search(settings["list_pattern"], text, re.DOTALL)
            values = list(dict.fromkeys(part.strip() for part in re.split(settings["separator_pattern"], match.group(1)) if part.strip())) if match else []
            if values:
                report["parsed_lists"] += 1
                if item.get(output_field) and item[output_field] != values:
                    report["preserved_existing"] += 1
                    report["details"].append({"id": item["id"], "status": "existing_audience_preserved", "parsed": values})
                else:
                    updated[output_field] = values
            else:
                report["missing_lists"] += 1
                report["details"].append({"id": item["id"], "status": "missing_explicit_list"})
        report["changed"] += record_change(path, target, raw, item, updated, args.dry_run, updates)
    finish_updates(source, target, updates, args.dry_run)
    report_result(report, args.report)



def clean(argv=None):
    parser = argparse.ArgumentParser(description='合并清洗入口；--platform all 依次清洗全部平台；--input-dir/--output-dir 也可指定 JSONL 文件')
    parser.add_argument('--platform', choices=['xhs', 'xianyu', 'all'], default='all')
    parser.add_argument('--profile', help='单平台的配置 profile（保留旧参数）')
    parser.add_argument('--ranked-file', type=Path)
    selection, rest = parser.parse_known_args(argv)
    platforms = ('xhs', 'xianyu') if selection.platform == 'all' else (selection.platform,)
    if selection.profile and len(platforms) > 1:
        parser.error('--profile 仅适用于单平台')
    for index, platform in enumerate(platforms):
        arguments = [*rest, '--profile', selection.profile or platform, '--platform', platform]
        if platform == 'xianyu' and selection.ranked_file:
            arguments += ['--ranked-file', str(selection.ranked_file)]
        if index and '--dry-run' not in rest:
            for flag in ('--output-dir',):
                if flag in rest:
                    destination = Path(rest[rest.index(flag) + 1])
                    if destination.is_file():
                        if '--input-dir' in arguments:
                            arguments[arguments.index('--input-dir') + 1] = str(destination)
                        else:
                            arguments += ['--input-dir', str(destination)]
        (clean_xhs if platform == 'xhs' else clean_xianyu)(arguments)
