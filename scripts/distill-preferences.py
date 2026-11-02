#!/usr/bin/env python3
"""Build a compact, reproducible preference bundle from reviewed repo sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def load_yaml_module() -> Any:
    try:
        import yaml  # type: ignore

        return yaml
    except ImportError:
        env_python = ROOT / "work" / ".venv" / "bin" / "python3"
        if env_python.exists() and Path(sys.executable).resolve() != env_python.resolve():
            import os

            os.execv(str(env_python), [str(env_python), str(Path(__file__).resolve()), *sys.argv[1:]])
        raise SystemExit("缺少 PyYAML，请先按 requirements.txt 安装到 scratch/.venv")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(read_text(path))


def stable_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def hash_file(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def hash_json_directory(root: Path, directory: Path) -> dict[str, Any]:
    hashes = {}
    for path in sorted(directory.glob("*.json")):
        if path.name.startswith("_"):
            continue
        hashes[path.name] = hash_file(path)
    aggregate = hashlib.sha256(stable_json(hashes)).hexdigest()
    return {"files": len(hashes), "sha256": aggregate}


def parse_frontmatter(text: str) -> str:
    return re.sub(r"\A---\s*\n.*?\n---\s*\n", "", text, count=1, flags=re.S)


def section(text: str, heading: str) -> str:
    match = re.search(
        rf"^##\s+{re.escape(heading)}\s*$([\s\S]*?)(?=^##\s+|\Z)",
        text,
        flags=re.M,
    )
    if not match:
        raise ValueError(f"找不到 Markdown 章节：{heading}")
    return match.group(1).strip()


def numbered_items(text: str) -> list[str]:
    return [re.sub(r"\s+", " ", m.group(1)).strip() for m in re.finditer(r"^\s*\d+\.\s+(.+?)\s*$", text, re.M)]


def quote_rows(text: str) -> list[dict[str, str]]:
    quotes = []
    for line in text.splitlines():
        match = re.match(r"^\|\s*(Q\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.*?)\s*\|\s*$", line)
        if match:
            quote = match.group(3).strip().strip("「」")
            quotes.append({"id": match.group(1), "date": match.group(2), "quote": quote})
    return quotes


def parse_rule_entry(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or not isinstance(raw.get("word"), str):
        raise ValueError("禁词 YAML 中每条规则必须是含 word 的对象")
    rule = dict(raw)
    platforms = rule.get("platform", [])
    models = rule.get("models", [])
    if isinstance(platforms, str):
        platforms = [platforms]
    if isinstance(models, str):
        models = [models]
    rule["platform"] = platforms
    if "models" in rule:
        rule["models"] = models
    return rule


def rule_matches_text(rule: dict[str, Any], text: str, platform: str, model: str = "") -> bool:
    if rule.get("level") != "ban" or platform not in rule.get("platform", []):
        return False
    models = rule.get("models", [])
    if models and not any(str(candidate).casefold() in model.casefold() for candidate in models):
        return False
    flags = re.IGNORECASE if rule.get("case_insensitive", True) else 0
    pattern = str(rule["word"]) if rule.get("regex") else re.escape(str(rule["word"]))
    return re.search(pattern, text, flags) is not None


def hits_in_text(rule_entries: list[dict[str, Any]], text: str, platform: str, model: str = "") -> list[str]:
    hits = []
    for rule in rule_entries:
        if rule_matches_text(rule, text, platform, model) and rule["word"] not in hits:
            hits.append(rule["word"])
    return hits


def model_hint(text: str, rule_entries: list[dict[str, Any]]) -> str:
    aliases = {str(alias).casefold(): str(alias) for rule in rule_entries for alias in rule.get("models", [])}
    for alias in sorted(aliases, key=len, reverse=True):
        if re.search(re.escape(alias), text, re.I):
            return aliases[alias]
    return ""


def source_ids_from_title_patterns(text: str) -> list[str]:
    sample_section = section(text, "样本清单")
    return list(dict.fromkeys(re.findall(r"\x60([0-9a-f]{24})\x60", sample_section)))


def unbold(value: str) -> str:
    return value.strip().strip("*").strip()


def extract_title_patterns(text: str, rules: list[dict[str, Any]], platform: str) -> dict[str, Any]:
    opener_lines = section(text, "Top5 首行动词 / 短促开场")
    openers = []
    for line in opener_lines.splitlines():
        match = re.match(r"^\s*\d+\.\s+\*\*(.+?)\*\*", line)
        if match:
            openers.append(match.group(1))

    structure_lines = numbered_items(section(text, "可直接套用的句式"))
    structures = []
    historical = []
    for template in structure_lines:
        template = unbold(template)
        model = model_hint(template, rules)
        hits = hits_in_text(rules, template, platform, model)
        item = {"template": template, "banned_word_hits": hits}
        (historical if hits else structures).append(item)

    sell_lines = numbered_items(section(text, "Top5 卖点短语"))
    sell_points = []
    historical_sell_points = []
    for item in sell_lines:
        phrase = unbold(item.split("——", 1)[0])
        model = model_hint(phrase, rules)
        hits = hits_in_text(rules, phrase, platform, model)
        record = {"phrase_group": phrase, "banned_word_hits": hits}
        (historical_sell_points if hits else sell_points).append(record)
    for line in section(text, "Top5 卖点短语").splitlines():
        match = re.match(r"^\s*-\s+\*\*(.+?)\*\*", line)
        if not match:
            continue
        phrase = match.group(1)
        hits = hits_in_text(rules, phrase, platform, model_hint(phrase, rules))
        if hits:
            historical_sell_points.append({"phrase_group": phrase, "banned_word_hits": hits})

    return {
        "openers": openers,
        "structures": structures,
        "historical_structures_with_banned_terms": historical,
        "sell_points": sell_points,
        "historical_sell_points_with_banned_terms": historical_sell_points,
        "sampled_from": source_ids_from_title_patterns(text),
    }


def clean_reference_hits(post: dict[str, Any], rules: list[dict[str, Any]], platform: str) -> list[str]:
    signal = post.get("signal") if isinstance(post.get("signal"), dict) else {}
    if isinstance(signal.get("banned_word_hits"), list):
        return list(signal["banned_word_hits"])
    combined = " ".join(str(post.get(key, "")) for key in ("title", "body", "cover_ocr"))
    tags = post.get("tags", [])
    if isinstance(tags, list):
        combined += " " + " ".join(str(tag) for tag in tags)
    model = model_hint(combined, rules)
    return hits_in_text(rules, combined, platform, model)


def xhs_references(directory: Path, refs: dict[str, Any], rules: list[dict[str, Any]], platform: str, limit: int) -> list[dict[str, Any]]:
    posts = {}
    for path in sorted(directory.glob("*.json")):
        if path.name.startswith("_"):
            continue
        post = read_json(path)
        if isinstance(post, dict) and isinstance(post.get("id"), str):
            posts[post["id"]] = post
    good_ids = {post_id for post_id, post in posts.items() if isinstance(post.get("label"), dict) and post["label"].get("good") is True}
    index_ids = {item.get("id") for item in refs.get("xhs_good_posts", []) if isinstance(item, dict)}
    if good_ids != index_ids:
        raise ValueError(f"XHS good 标注与 reference-posts 索引不一致：帖子={len(good_ids)}，索引={len(index_ids)}")
    result = []
    for post_id in sorted(good_ids):
        post = posts[post_id]
        signal = post.get("signal") if isinstance(post.get("signal"), dict) else {}
        clean = signal.get("clean_for_style_reference")
        if not isinstance(clean, bool):
            raise ValueError(f"XHS {post_id} 尚无 signal.clean_for_style_reference")
        result.append({"id": post_id, "clean_for_style_reference": clean, "banned_word_hits": clean_reference_hits(post, rules, platform)})
    return result


def xianyu_references(directory: Path, rules: list[dict[str, Any]], platform: str, limit: int) -> list[dict[str, Any]]:
    posts = []
    for path in sorted(directory.glob("*.json")):
        if path.name.startswith("_"):
            continue
        post = read_json(path)
        if not isinstance(post, dict) or not isinstance(post.get("id"), str):
            continue
        metrics = post.get("metrics") if isinstance(post.get("metrics"), dict) else {}
        wants = metrics.get("wants")
        if isinstance(wants, (int, float)) and not isinstance(wants, bool) and wants > 0:
            posts.append((post, int(wants)))
    posts.sort(key=lambda pair: (-pair[1], pair[0]["id"]))
    result = []
    for rank, (post, wants) in enumerate(posts[:limit], start=1):
        signal = post.get("signal") if isinstance(post.get("signal"), dict) else {}
        clean = signal.get("clean_for_style_reference")
        if not isinstance(clean, bool):
            raise ValueError(f"闲鱼 {post['id']} 尚无 signal.clean_for_style_reference")
        result.append({
            "id": post["id"],
            "wants": wants,
            "rank": rank,
            "clean_for_style_reference": clean,
            "banned_word_hits": clean_reference_hits(post, rules, platform),
        })
    return result


def platform_rule_bundle(platform: str, entries: list[dict[str, Any]], api_term: str) -> dict[str, Any]:
    relevant = [entry for entry in entries if platform in entry.get("platform", []) and entry.get("level") == "ban"]
    general = [entry for entry in relevant if not entry.get("models")]
    model_specific: dict[str, list[dict[str, Any]]] = {}
    for entry in relevant:
        for model in entry.get("models", []):
            model_specific.setdefault(str(model), []).append(entry)
    return {
        "banned": list(dict.fromkeys(entry["word"] for entry in general)),
        "model_specific_bans": {key: [entry["word"] for entry in value] for key, value in model_specific.items()},
        "banned_word_rules": relevant,
        "platform_allows_api": not any(entry["word"] == api_term for entry in relevant),
    }


def source_bundle(root: Path, config: dict[str, Any], config_path: Path) -> tuple[list[str], dict[str, Any]]:
    paths = config["paths"]
    excluded = {"xhs_data_dir", "xianyu_data_dir", "output"}
    hashes = {paths[key]: hash_file(root / value) for key, value in paths.items() if key not in excluded}
    hashes[paths["xhs_data_dir"]] = hash_json_directory(root, root / paths["xhs_data_dir"])
    hashes[paths["xianyu_data_dir"]] = hash_json_directory(root, root / paths["xianyu_data_dir"])
    names = [
        "simin-persona", "risk-words", "banned-words-quick", "platform-rules",
        "design-rules", "cover-palettes", "xhs-title-patterns", "xhs-post-generation",
        "reference-posts", "xhs-data", "xianyu-data",
    ]
    try:
        config_name = config_path.relative_to(root).as_posix()
    except ValueError:
        config_name = str(config_path)
    hashes[config_name] = hash_file(config_path)
    hashes["scripts/distill-preferences.py"] = hash_file(Path(__file__).resolve())
    return names, hashes


def build_bundle(root: Path, config_path: Path, output_date: str | None) -> dict[str, Any]:
    yaml = load_yaml_module()
    config = read_json(config_path)
    paths = config["paths"]
    platform_ids = {entry["role"]: entry["id"] for entry in config["platforms"]}
    source_paths = {key: root / value for key, value in paths.items()}
    persona_text = parse_frontmatter(read_text(source_paths["persona"]))
    quotes = quote_rows(section(persona_text, "去敏原话摘录"))
    standards = numbered_items(section(persona_text, "判断一条小红书帖子好不好的标准"))
    anti_patterns = numbered_items(section(persona_text, "反例"))
    if not quotes or not standards or not anti_patterns:
        raise ValueError("persona 缺少引文、标准或反例")
    feedback_entries = [json.loads(line) for line in read_text(source_paths["feedback"]).splitlines() if line.strip()]
    quote_feedback = {item["evidence_id"]: item for item in feedback_entries if item.get("evidence_id") and not item.get("post_id")}
    if set(quote_feedback) != {item["id"] for item in quotes}:
        raise ValueError(f"反馈 JSONL 引文集合与 persona 不一致：JSONL {len(quote_feedback)}，persona {len(quotes)}")
    for item in quotes:
        original = quote_feedback[item["id"]]
        if item["quote"] != original.get("quote", "").strip().strip("「」") or item["date"] != original.get("date"):
            raise ValueError(f"反馈 JSONL 与 persona 引文内容不一致：{item['id']}")

    rules_yaml = yaml.safe_load(read_text(source_paths["banned_rules"]))
    if not isinstance(rules_yaml, list):
        raise ValueError("禁词 YAML 顶层必须为列表")
    rules = [parse_rule_entry(item) for item in rules_yaml]
    quote_by_id = {item["id"]: item for item in quotes}
    api_evidence = [quote_by_id[evidence_id] for evidence_id in config["conflict_evidence_ids"] if evidence_id in quote_by_id]
    api_tokens = {match.group(0) for item in api_evidence for match in re.finditer(r"[A-Z][A-Z0-9]+", item["quote"])}
    reference_platforms = {platform_ids[role] for role in ("xhs_reference", "xianyu_reference")}
    api_terms = [entry["word"] for entry in rules if entry["word"].upper() in api_tokens and set(entry.get("platform", [])) >= reference_platforms]
    if len(api_terms) != 1:
        raise ValueError("无法从已确认的反馈引文与规则库唯一解析出两平台共同禁用词")
    api_term = api_terms[0]

    palettes = read_json(source_paths["cover_palettes"])
    if not isinstance(palettes, list):
        raise ValueError("cover-palettes.json 顶层应为数组")
    title_text = read_text(source_paths["title_patterns"])
    title_patterns = extract_title_patterns(title_text, rules, platform_ids["xhs_reference"])
    generation_skill = parse_frontmatter(read_text(source_paths["generation_skill"]))
    generation_steps = numbered_items(generation_skill.split("\n## ", 1)[0])

    xhs_posts = xhs_references(source_paths["xhs_data_dir"], read_json(source_paths["reference_posts"]), rules, platform_ids["xhs_reference"], int(config["reference_limits"]["xhs_good_posts"]))
    xianyu_posts = xianyu_references(source_paths["xianyu_data_dir"], rules, platform_ids["xianyu_reference"], int(config["reference_limits"]["xianyu_top_posts"]))
    if len(xhs_posts) != int(config["reference_limits"]["xhs_good_posts"]):
        raise ValueError(f"期望 {config['reference_limits']['xhs_good_posts']} 条 XHS good，实际 {len(xhs_posts)}")
    if len(xianyu_posts) != int(config["reference_limits"]["xianyu_top_posts"]):
        raise ValueError(f"期望 {config['reference_limits']['xianyu_top_posts']} 条闲鱼参考，实际 {len(xianyu_posts)}")

    identity_section = section(persona_text, "她是谁、负责什么")
    identity = re.sub(r"\s+", " ", identity_section.splitlines()[0]).strip()
    identity = re.sub(r"^她是", "思敏是", identity)
    source_date_match = re.search(r"证据版本：([^。]+)", persona_text)
    distilled_date = output_date or (source_date_match.group(1) if source_date_match else None)
    if not distilled_date:
        raise ValueError("无法从 persona 获取来源日期，请使用 --date YYYY-MM-DD 指定")
    date.fromisoformat(distilled_date)

    risk_text = read_text(source_paths["risk_words"])
    q7_match = re.search(r"^2\.\s*(.+?)\s*$", section(risk_text, "已保留的时间与范围冲突"), re.M)
    if not q7_match:
        raise ValueError("risk-words.md 中缺少第二条价格冲突说明")
    decisions_text = read_text(source_paths["decisions"])
    decision_match = re.search(
        rf"^\|\s*{re.escape(config['policy_decision_id'])}\s*\|\s*(.*?)\s*\|",
        decisions_text,
        re.M,
    )
    if not decision_match:
        raise ValueError(f"决策记录中找不到 {config['policy_decision_id']}")
    api_evidence_id = next((item["id"] for item in api_evidence if api_term in item["quote"]), None)
    if api_evidence_id is None:
        raise ValueError("两平台禁词规则没有对应的反馈引文")
    platform_source = read_text(source_paths["platform_rules"])
    platform_bundles = {}
    for entry in config["platforms"]:
        platform = entry["id"]
        guidance = section(platform_source, entry["name"])
        platform_bundles[platform] = {
            **platform_rule_bundle(platform, rules, api_term),
            "guidance": "\n".join(line for line in guidance.splitlines() if not hits_in_text(rules, line, platform)).strip(),
        }
    price_paragraph = section(persona_text, "常用词和句式").split("\n\n", 1)[0]
    platform_bundles[platform_ids["xhs_reference"]]["allowed_price_words"] = list(
        dict.fromkeys(re.findall(r"「([^」]+)」", price_paragraph))
    )
    source_names, source_hashes = source_bundle(root, config, config_path)
    return {
        "version": 1,
        "distilled_at": distilled_date,
        "sources": source_names,
        "source_hashes": source_hashes,
        "preference_priority": config["preference_priority"],
        "persona": {
            "identity": identity,
            "standards": standards,
            "anti_patterns": anti_patterns,
            "evidence_quotes": quotes,
            "evidence_limit": "截至客户端当前可加载最早端的记录，未证明更早历史不存在；不代表思敏全部偏好。",
        },
        "platform_rules": {
            **platform_bundles,
            "api_term": api_term,
            "api_policy_evidence": {"quote_id": api_evidence_id, "quote": quote_by_id[api_evidence_id]["quote"]},
        },
        "design": {
            "cover_palettes": palettes,
            "hierarchy_rules": [standards[index - 1] for index in (1, 4) if len(standards) >= index]
            + ([generation_steps[6]] if len(generation_steps) >= 7 else []),
            "aspect_ratio": standards[4] if len(standards) >= 5 else "",
            "persona_precedence": generation_steps[6] if len(generation_steps) >= 7 else "",
        },
        "title_patterns": title_patterns,
        "style_references": {"xhs_good_posts": xhs_posts, "xianyu_top_posts": xianyu_posts},
        "known_conflicts": {
            "q7_guanbao": q7_match.group(1),
            "api_policy": {"evidence": quote_by_id[api_evidence_id], "decision": decision_match.group(1)},
        },
    }


def write_if_changed(path: Path, value: Any) -> bool:
    encoded = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == encoded:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(encoded)
        temporary = Path(handle.name)
    temporary.replace(path)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="从已审来源构建机器可读的内容偏好包")
    parser.add_argument("--root", type=Path, default=ROOT, help="仓库根目录")
    parser.add_argument("--config", type=Path, default=Path("config/preference-build.json"), help="输入与结构配置")
    parser.add_argument("--output", type=Path, help="覆盖配置中的输出路径")
    parser.add_argument("--date", help="固定蒸馏日期 YYYY-MM-DD；默认使用 persona 证据版本")
    args = parser.parse_args()
    root = args.root.resolve()
    config_path = args.config if args.config.is_absolute() else root / args.config
    bundle = build_bundle(root, config_path, args.date)
    config = read_json(config_path)
    output = args.output or (root / config["paths"]["output"])
    if not output.is_absolute():
        output = root / output
    changed = write_if_changed(output, bundle)
    print(json.dumps({
        "output": str(output),
        "changed": changed,
        "standards": len(bundle["persona"]["standards"]),
        "anti_patterns": len(bundle["persona"]["anti_patterns"]),
        "evidence_quotes": len(bundle["persona"]["evidence_quotes"]),
        "xhs_good_posts": len(bundle["style_references"]["xhs_good_posts"]),
        "xianyu_top_posts": len(bundle["style_references"]["xianyu_top_posts"]),
        "title_structures": len(bundle["title_patterns"]["structures"]),
        "historical_title_structures": len(bundle["title_patterns"]["historical_structures_with_banned_terms"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
