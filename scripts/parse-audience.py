#!/usr/bin/env python3
"""Parse explicit audience lists, retaining missing values and existing annotations."""
from __future__ import annotations

import copy
import re

from data_cleaning import arguments, configuration, posts, report_result, save_post


def main():
    args = arguments(__doc__, "xhs", with_rules=False).parse_args()
    config, _, source, target = configuration(args)
    settings = config["audience"]
    raw_field, output_field = settings["raw_field"], settings["output_field"]
    report = {"total": 0, "changed": 0, "raw_nonempty": 0, "parsed_lists": 0,
              "missing_lists": 0, "preserved_existing": 0, "dry_run": args.dry_run, "details": []}
    for path, item, raw in posts(source):
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
        report["changed"] += save_post(path, target, raw, item, updated, args.dry_run)
    report_result(report, args.report)


if __name__ == "__main__":
    main()
