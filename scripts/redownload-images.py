#!/usr/bin/env python3
"""Re-download images referenced by post JSON files."""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path
from urllib.request import Request,urlopen

def fetch(url,p):
 p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists() and p.stat().st_size>100:return True
 try:
  with urlopen(Request(url,headers={"User-Agent":"Mozilla/5.0"}),timeout=30) as r:data=r.read()
  if len(data)<100:return False
  p.write_bytes(data);return True
 except Exception as e: print(f"WARN {url}: {e}",file=sys.stderr);return False
ap=argparse.ArgumentParser();ap.add_argument("--data-root",default="data");ap.add_argument("--images-root",default="data/images");a=ap.parse_args(); total=ok=0
for platform in ("xhs","xianyu"):
 for f in (Path(a.data_root)/platform).glob("*.json"):
  try: n=json.loads(f.read_text())
  except Exception: continue
  if not isinstance(n,dict): continue
  rid=n.get("id",f.stem)
  for i,u in enumerate(n.get("image_urls",[]),1):
   total+=1; ext=".png" if ".png" in u.lower() else ".jpg"; ok+=fetch(u,Path(a.images_root)/platform/rid/f"{i}{ext}")
print(json.dumps({"images":total,"downloaded_or_existing":ok}))
