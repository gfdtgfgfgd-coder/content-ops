#!/usr/bin/env python3
"""Add interaction tiers and scoped risk-word signals without changing source text."""
from __future__ import annotations

from collections import Counter
import copy

from data_cleaning import (
    ROOT, arguments, checker_module, configuration, nonnegative_number,
    posts, report_result, risk_signal, save_post,
)


def main():
    args = arguments(__doc__, "xhs").parse_args()
    config, profile, source, target = configuration(args)
    checker = checker_module()
    rules = checker.load_rules(args.rules or ROOT / config["rules"])
    platform = args.platform or profile["platform"]
    report = {"total": 0, "changed": 0, "tiers": Counter(), "good": 0,
              "dirty_good": 0, "with_banned_words": 0, "dry_run": args.dry_run, "details": []}
    for path, item, raw in posts(source):
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
        report["changed"] += save_post(path, target, raw, item, updated, args.dry_run)
        report["tiers"][tier] += 1
        report["good"] += good
        report["dirty_good"] += good and bool(signal["banned_word_hits"])
        report["with_banned_words"] += bool(signal["banned_word_hits"])
        if signal["banned_word_hits"]:
            report["details"].append({"id": item["id"], "good": good, "hits": signal["banned_word_hits"]})
    report_result(report, args.report)


if __name__ == "__main__":
    main()
