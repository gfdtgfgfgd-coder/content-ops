#!/usr/bin/env python3
"""Check text against the quick risk-word rules.

Examples:
  python3 scripts/check-banned-words.py --text "最便宜 5 折"
  python3 scripts/check-banned-words.py --file outputs/2026-11-01/post-1.md
"""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "rules/banned-words-quick.yaml"

def load_rules(path=None):
    try:
        import yaml
    except ModuleNotFoundError:
        runtime = ROOT / "work/.venv/bin/python3"
        if runtime.exists() and Path(sys.executable).resolve() != runtime.resolve():
            os.execv(str(runtime), [str(runtime), *sys.argv])
        raise SystemExit("缺少 PyYAML，请先安装 requirements.txt（推荐 work/.venv）")
    with Path(path or RULES).open(encoding="utf-8") as f:
        return yaml.safe_load(f) or []

def check(text: str, platform: str = "xhs", model: str = "", rules=None):
    hits=[]
    for rule in load_rules() if rules is None else rules:
        if platform not in (rule.get("platform") or []) and 'all' not in (rule.get("platform") or []):
            continue
        scopes=rule.get('models') or []
        if scopes and not any(scope.casefold() in model.casefold() for scope in scopes):
            continue
        word=str(rule.get("word", ""))
        if not word: continue
        pattern=word if rule.get("regex") else re.escape(word)
        for m in re.finditer(pattern, text, flags=re.IGNORECASE):
            hits.append({"word":m.group(0),"rule":word,"replace":rule.get("replace",""),"reason":rule.get("reason","")})
    return hits

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--text"); ap.add_argument("--file"); ap.add_argument("--platform",default="xhs",choices=["xhs","xianyu","gzh"]); ap.add_argument("--model",default="",help="产品名，用于 Seedance 等专属规则"); ap.add_argument("--json",action="store_true")
    ap.add_argument("--rules",type=Path,default=RULES,help="风险词 YAML 文件")
    a=ap.parse_args()
    if not a.text and not a.file: ap.error("需要 --text 或 --file")
    text=a.text if a.text is not None else Path(a.file).read_text(encoding="utf-8")
    hits=check(text,a.platform,a.model,rules=load_rules(a.rules))
    if a.json: print(json.dumps(hits,ensure_ascii=False,indent=2))
    elif hits:
        print(f"命中 {len(hits)} 个风险词：")
        for h in hits: print(f"- {h['word']} → 建议替换为：{h['replace']}（{h['reason']}）")
    else: print("未命中风险词")
    return 1 if hits else 0
if __name__=="__main__": raise SystemExit(main())
