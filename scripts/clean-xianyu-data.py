#!/usr/bin/env python3
"""Add deterministic wants ranks and risk signals; backfill only missing wants."""
from __future__ import annotations

from collections import Counter
import copy
from pathlib import Path
import re

from data_cleaning import (
    ROOT, arguments, checker_module, configuration, nonnegative_number,
    posts, report_result, risk_signal, save_post,
)


def main():
    parser = arguments(__doc__, "xianyu")
    parser.add_argument("--ranked-file", type=Path, help="仅为缺失 wants 提供有来源的回填")
    args = parser.parse_args()
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
    records = posts(source)
    prepared = []
    field = profile["wants_field"]
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
        report["changed"] += save_post(path, target, raw, item, updated, args.dry_run)
        report["tiers"][tier] += 1
        report["with_banned_words"] += bool(signal["banned_word_hits"])
        report["details"].append({"id": item["id"], "wants": updated.get("metrics", {}).get(field),
                                   "rank": rank, "tier": tier, "hits": signal["banned_word_hits"]})
    report_result(report, args.report)


if __name__ == "__main__":
    main()
