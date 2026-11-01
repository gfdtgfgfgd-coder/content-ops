#!/usr/bin/env python3
"""Write post JSON from browser-extracted records.

The browser half is intentionally separate: ego-browser owns logged-in page access;
this script validates/normalizes records, downloads images, and supports checkpoints.
"""
from __future__ import annotations
import argparse, json, re, sys, time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

CN_TZ = timezone(timedelta(hours=8))
FIELDS = ("id","platform","url","author","title","body","images","image_urls","cover_ocr","tags","metrics","is_pinned","label","audience","audience_raw","fetched_at","source")

def now(): return datetime.now(CN_TZ).isoformat(timespec="seconds")
def load_urls(path): return [x.strip() for x in Path(path).read_text().splitlines() if x.strip() and not x.lstrip().startswith("#")]
def id_from_url(url, platform):
    if platform == "xhs":
        m=re.search(r"/explore/([0-9a-zA-Z]+)", url)
    else:
        m=re.search(r"[?&]id=([0-9]+)", url)
    if not m: raise ValueError(f"cannot infer id: {url}")
    return m.group(1)
def parse_num(value):
    if value is None: return None
    if isinstance(value,(int,float)): return int(value)
    s=str(value).strip().replace(",","")
    if not s: return None
    if s.endswith("万+"): return int(float(s[:-2])*10000)
    if s.endswith("万"): return int(float(s[:-1])*10000)
    m=re.search(r"[0-9]+(?:\.[0-9]+)?",s)
    return int(float(m.group(0))) if m else None
def norm(rec, platform, url, source=None):
    rid=str(rec.get("id") or id_from_url(url,platform))
    note={"id":rid,"platform":platform,"url":url,"author":rec.get("author",""),"title":rec.get("title",""),"body":rec.get("body",rec.get("desc","")),"images":rec.get("images",[]),"image_urls":rec.get("image_urls",[]),"cover_ocr":rec.get("cover_ocr","") or rec.get("title","") or "（待补 OCR）","tags":rec.get("tags",[]),"metrics":rec.get("metrics",{}),"is_pinned":bool(rec.get("is_pinned",False)),"label":rec.get("label"),"audience":rec.get("audience",[]),"audience_raw":rec.get("audience_raw","") ,"fetched_at":rec.get("fetched_at") or now(),"source":source or rec.get("source","bookmark")}
    note["metrics"]={"likes":parse_num(note["metrics"].get("likes")),"collects":parse_num(note["metrics"].get("collects")),"comments":parse_num(note["metrics"].get("comments")),"wants":parse_num(note["metrics"].get("wants"))}
    return note
def download(url, dest):
    dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() and dest.stat().st_size>100: return True
    req=Request(url,headers={"User-Agent":"Mozilla/5.0"})
    try:
        with urlopen(req,timeout=30) as r: data=r.read()
        if len(data)<100: return False
        dest.write_bytes(data); return True
    except Exception as e:
        print(f"WARN image {url}: {e}", file=sys.stderr); return False
def write_records(records, platform, out_dir, images_root, skip_existing=True):
    out_dir=Path(out_dir); images_root=Path(images_root); out_dir.mkdir(parents=True,exist_ok=True)
    done=0; failed=[]
    for rec in records:
        url=rec.get("url","")
        try: rid=id_from_url(url,platform)
        except Exception as e: failed.append({"url":url,"error":str(e)}); continue
        dest=out_dir/f"{rid}.json"
        if skip_existing and dest.exists(): done+=1; continue
        note=norm(rec,platform,url)
        local=[]
        for i,img in enumerate(note["image_urls"],1):
            ext=".jpg"
            if ".png" in img.lower(): ext=".png"
            p=images_root/platform/rid/f"{i}{ext}"
            if download(img,p): local.append(str(p))
        note["images"]=local
        dest.write_text(json.dumps(note,ensure_ascii=False,indent=2)+"\n")
        done+=1
    return done,failed
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--platform",required=True,choices=["xhs","xianyu"]); ap.add_argument("--urls",default=None); ap.add_argument("--records",required=True,help="JSON array extracted by ego-browser"); ap.add_argument("--out-dir",default=None); ap.add_argument("--images-root",default="data/images"); ap.add_argument("--skip-existing",action="store_true"); ap.add_argument("--ranked",default=None)
    a=ap.parse_args(); out=a.out_dir or f"data/{a.platform}"; records=json.loads(Path(a.records).read_text()); done,failed=write_records(records,a.platform,out,a.images_root,a.skip_existing)
    if failed: Path("work/fetch-failures.json").write_text(json.dumps(failed,ensure_ascii=False,indent=2)+"\n")
    if a.platform=="xianyu" and a.ranked:
        rows=[]
        for p in Path(out).glob("*.json"):
            try: n=json.loads(p.read_text()); rows.append(n)
            except Exception: pass
        rows.sort(key=lambda n:(n.get("metrics",{}).get("wants") or 0),reverse=True)
        text="# 闲鱼帖子按想要数排序\n\n"+"\n".join(f"{i}. **{n.get('title','')}** — {n.get('metrics',{}).get('wants') or 0} 人想要\n   {n.get('url','')}" for i,n in enumerate(rows[:20],1))+"\n"
        Path(a.ranked).write_text(text)
    print(json.dumps({"platform":a.platform,"written":done,"failed":len(failed)},ensure_ascii=False))
if __name__=="__main__": main()
