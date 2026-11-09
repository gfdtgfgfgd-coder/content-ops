"""文件式账号监测、保守热度估计与近期成稿避重；策略唯一源见 data-cleaning.json。"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlparse
import uuid
from .store import ROOT, read_posts

TZ = timezone(timedelta(hours=8))


def policy(root=ROOT):
    return json.loads((Path(root) / 'config/data-cleaning.json').read_text())['monitoring']


def parse_date(value):
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return d.replace(tzinfo=TZ) if d.tzinfo is None else d
    except (ValueError, TypeError):
        return None


def recent_posts(posts, settings, now=None, platform='xhs'):
    now = now or datetime.now(TZ)
    start = now.astimezone(TZ).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=settings['recent_days'])
    return [p for p in posts if p.get('platform') == platform and (date := parse_date(p.get('published_at'))) and start <= date <= now]


def heat_scores(posts, settings, now=None):
    """同账号可见互动的年龄校正相对分，不推断曝光量/转化/因果。"""
    now = now or datetime.now(TZ)
    raw = {}
    for p in posts:
        observed = parse_date(p.get('metrics_observed_at'))
        published = parse_date(p.get('published_at'))
        if p.get('platform') != 'xhs' or not p.get('author_id') or not observed or not published:
            continue
        if observed > now or published > observed or (now-observed).total_seconds() > settings['metrics_max_age_days']*86400:
            continue
        metrics = p.get('metrics') or {}
        snapshots = p.get('metrics_history') or []
        current_snapshot = next((h for h in reversed(snapshots) if parse_date(h.get('observed_at')) == observed), None)
        if current_snapshot is not None:
            metrics = current_snapshot.get('metrics') or {}
        known = {k: v for k, v in metrics.items() if k in settings['metric_weights'] and isinstance(v, (int,float)) and not isinstance(v,bool) and v >= 0}
        if not known:
            continue
        total = sum(known[k]*settings['metric_weights'][k] for k in known)
        age = max(settings['minimum_age_hours'], (observed-published).total_seconds()/3600)
        score = math.log1p(total) / math.pow(age/24 + 1, settings['age_decay'])
        history = p.get('metrics_history') or []
        previous = next((h for h in reversed(history) if parse_date(h.get('observed_at')) and (observed-parse_date(h['observed_at'])).total_seconds() >= 3600), None)
        growth = None
        if previous:
            comparable = [k for k in known if isinstance((previous.get('metrics') or {}).get(k),(int,float))]
            if comparable:
                hours = (observed-parse_date(previous['observed_at'])).total_seconds()/3600
                growth = sum(max(0, known[k]-previous['metrics'][k])*settings['metric_weights'][k] for k in comparable)/hours
                score += settings['growth_weight']*math.log1p(growth)
        raw[p['id']] = {'author_id':p['author_id'], 'score':round(score,6), 'weighted_interactions':total, 'growth_per_hour':growth, 'observed_at':p['metrics_observed_at']}
    groups = {}
    for item in raw.values(): groups.setdefault(item['author_id'],[]).append(item['score'])
    for item in raw.values():
        peers=groups[item['author_id']]
        percentile=sum(v < item['score'] for v in peers)/max(1,len(peers)-1)
        eligible=len(peers)>=settings['minimum_peer_count'] and item['weighted_interactions']>=settings['minimum_interactions']
        item.update(peer_count=len(peers),relative_percentile=round(percentile,4),weight=round(1+settings['heat_weight']*percentile,4) if eligible else 1.0,
                    status='relative_hot' if eligible and percentile>=settings['hot_percentile'] else 'observing')
    return raw


def normalized(value):
    return re.sub(r'[^\w\u4e00-\u9fff]', '', str(value).casefold())


def check_novelty(generated, recent, settings):
    for candidate in generated:
        for old in recent:
            title, old_title = normalized(candidate.get('title')), normalized(old.get('title'))
            body, old_body = normalized(candidate.get('body')), normalized(old.get('body'))
            title_ratio = SequenceMatcher(None,title,old_title).ratio() if min(len(title),len(old_title))>=8 else 0
            body_ratio = SequenceMatcher(None,body,old_body,autojunk=False).ratio() if min(len(body),len(old_body))>=50 else 0
            if title and title==old_title or title_ratio>=settings['title_similarity'] or body_ratio>=settings['body_similarity']:
                raise ValueError(f"近期内容雷同：与素材 {old.get('id')} 的标题或正文过于接近，请更换主题切口、开头和场景后重写")


def sync_main(argv=None):
    parser=argparse.ArgumentParser(description='合并浏览器采集文件：旧帖仅补日期/互动，新帖限最近窗口；默认预览')
    parser.add_argument('--records',type=Path,required=True)
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--author-id',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args(argv);root=args.root.resolve();settings=policy(root)
    incoming=json.loads(args.records.read_text());now=datetime.now(TZ)
    if not isinstance(incoming,list):parser.error('采集文件须为数组')
    # Only the configured source account is authorized for this sync entrypoint.
    sources=json.loads((root/'data/sources/bookmarks-raw.json').read_text())
    if not any('/user/profile/'+args.author_id in str(i.get('url','')) for i in sources['items']):parser.error('账号不在既有来源配置中')
    source=root/'data/posts.jsonl';rows=read_posts(source);by_id={p['id']:p for p in rows};ready=[];gaps=[];seen=set()
    from .fetching import norm, parse_num
    cutoff=now.replace(hour=0,minute=0,second=0,microsecond=0)-timedelta(days=settings['recent_days'])
    for record in incoming:
        note=record.get('note') or {};identifier=note.get('noteId');user=note.get('user') or {}
        if not identifier:
            gaps.append(record.get('id','未知'));continue
        if identifier in seen:raise ValueError('采集文件存在重复帖子ID')
        seen.add(identifier)
        if not re.fullmatch('[0-9a-f]{24}',identifier) or user.get('userId')!=args.author_id:raise ValueError('帖子ID或作者不匹配')
        value=note.get('time')
        if not isinstance(value,(int,float)) or isinstance(value,bool):gaps.append(identifier);continue
        published=datetime.fromtimestamp(value/1000,TZ)
        if published>now:raise ValueError('发布日期在未来')
        observed=parse_date(record.get('observed_at'))
        if not observed or observed>now+timedelta(minutes=5):raise ValueError('互动采样时间无效')
        old=by_id.get(identifier)
        if old and old.get('platform')!='xhs':raise ValueError('ID跨平台冲突')
        if not old and not cutoff<=published<=now:continue
        url=record.get('url','');parts=urlparse(url)
        if parts.hostname!='www.xiaohongshu.com' or identifier not in parts.path:raise ValueError('帖子URL不匹配')
        metrics={};info=note.get('interactInfo') or {}
        for key,field in [('likes','likedCount'),('collects','collectedCount'),('comments','commentCount')]:
            # XHS empty count is the rendered zero state; absent field is unknown.
            metrics[key]=0 if field in info and info[field]=='' else parse_num(info.get(field))
        update={'published_at':published.isoformat(timespec='seconds'),'published_at_source':'xhs_note.time','published_date_text':record.get('date_text','').strip(),
                'author_id':args.author_id,'metrics_observed_at':observed.isoformat(timespec='seconds')}
        if old:
            row=dict(old);row.update(update)
        else:
            image_urls=[im.get('urlDefault') or im.get('url') for im in note.get('imageList',[])]
            image_urls=[u for u in image_urls if u]
            if note.get('type')!='normal' or not image_urls or not note.get('desc'):gaps.append(identifier);continue
            row=norm({'id':identifier,'author':user.get('nickname',''),'title':note.get('title',''),'body':note['desc'],
                      'tags':[t['name'] for t in note.get('tagList',[]) if t.get('name')],'cover_ocr':'','image_urls':image_urls,
                      'source':'account_monitor','metrics':metrics},'xhs',url)
            row['cover_ocr']='';row.update(update)
        old_observed = parse_date(old.get('metrics_observed_at')) if old else None
        if old_observed and old_observed >= observed:
            continue
        row['metrics']={**(row.get('metrics') or {}),**{k:v for k,v in metrics.items() if v is not None}}
        history=list(row.get('metrics_history') or [])
        snapshot={'observed_at':update['metrics_observed_at'],'metrics':{k:v for k,v in metrics.items() if v is not None}}
        if snapshot['metrics'] and (not history or history[-1]['observed_at']!=snapshot['observed_at']):history.append(snapshot)
        row['metrics_history']=history[-settings['history_limit']:]
        ready.append((row,not bool(old)))
    report={'matched':sum(not new for _,new in ready),'new':sum(new for _,new in ready),'gaps':gaps,'applied':args.apply}
    if not args.apply:print(json.dumps(report,ensure_ascii=False));return 0
    if not ready:
        print(json.dumps({**report,'changed':False},ensure_ascii=False));return 0
    clean=subprocess.run(['git','diff','--quiet','HEAD','--','data/posts.jsonl'],cwd=root)
    if clean.returncode:raise ValueError('素材库有未提交改动，先保留并处理后重试')
    # Prepare complete new images before locking; never overwrite an existing image.
    with tempfile.TemporaryDirectory(prefix='hanabi-sync-') as tmp:
        prepared={}
        from urllib.request import Request,urlopen
        from PIL import Image
        for row,new in ready:
            if not new:continue
            files=[]
            for i,url in enumerate(row['image_urls'],1):
                parts=urlparse(url)
                if parts.scheme not in ('http','https') or not (parts.hostname or '').endswith('.xhscdn.com'):raise ValueError('图片域名无效')
                with urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.xiaohongshu.com/'}),timeout=30) as response:data=response.read(15*1024*1024+1)
                if len(data)>15*1024*1024:raise ValueError('图片超限')
                local=Path(tmp)/f"{row['id']}-{i}";local.write_bytes(data)
                with Image.open(local) as image:fmt=image.format;image.verify()
                ext={'JPEG':'jpg','PNG':'png','WEBP':'webp'}.get(fmt)
                if not ext:raise ValueError('图片格式无效')
                relative=f"data/images/xhs/{row['id']}/{i}.{ext}";files.append((local,relative))
            row['images']=[relative for _,relative in files];prepared[row['id']]=files
        ocr_script=root/'scripts/ocr-covers.swift'
        ocr={}
        if prepared and shutil.which('swift') and ocr_script.exists():
            queue=Path(tmp)/'ocr-images.json';queue.write_text(json.dumps([str(files[0][0]) for files in prepared.values()]))
            result=subprocess.run(['swift',str(ocr_script),'--images-json',str(queue)],capture_output=True,text=True,timeout=180)
            if result.returncode==0:ocr=json.loads(result.stdout)
        for row,new in ready:
            if new:row['cover_ocr']=ocr.get(str(prepared[row['id']][0][0]),'')
        report['ocr_gaps']=[row['id'] for row,new in ready if new and not row['cover_ocr']]
        lock=root/'data/.posts.lock';token=uuid.uuid4().hex;created=[];raw=None;committed=False
        try:
            with lock.open('x') as stream:json.dump({'pid':__import__('os').getpid(),'token':token},stream)
        except FileExistsError:raise ValueError('素材库正在写入，请稍后重试') from None
        try:
            raw=source.read_bytes();current=read_posts(source);latest={p['id']:p for p in current}
            paths=['data/posts.jsonl']
            for row,new in ready:
                previous=by_id.get(row['id'])
                if latest.get(row['id'])!=previous:raise ValueError('采集期间素材已被编辑，请重试；不覆盖新改动')
                if new:
                    for local,relative in prepared[row['id']]:
                        dest=root/relative
                        if dest.exists():raise ValueError('图片路径已存在，不覆盖')
                        dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(local,dest);created.append(dest);paths.append(relative)
                    current.append(row)
                else:current=[row if p['id']==row['id'] else p for p in current]
            encoded=''.join(json.dumps(p,ensure_ascii=False,separators=(',',':'))+'\n' for p in current).encode()
            if encoded==raw:print(json.dumps({**report,'changed':False},ensure_ascii=False));return 0
            temporary=source.with_suffix('.sync.tmp');temporary.write_bytes(encoded);temporary.replace(source)
            def git(*a):return subprocess.run(['git',*a],cwd=root,check=True,capture_output=True,text=True)
            git('add','--',*paths)
            # Production import obeys the same repository budget gate as source changes.
            subprocess.run([__import__('sys').executable,str(root/'scripts/doctor.py')],cwd=root,check=True)
            git('-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--only','-m','同步账号发布日期、互动快照与近七天图文','--',*paths);committed=True
            print(json.dumps({**report,'commit':git('rev-parse','--short','HEAD').stdout.strip()},ensure_ascii=False))
        except Exception:
            if not committed:
                if raw is not None:
                    temporary=source.with_suffix('.sync.tmp');temporary.write_bytes(raw);temporary.replace(source)
                for path in created:path.unlink(missing_ok=True)
                # Unstage only paths this transaction added, never restore production files.
                subprocess.run(['git','add','--','data/posts.jsonl'],cwd=root,check=False,capture_output=True)
                if created:subprocess.run(['git','update-index','--force-remove','--',*[str(p.relative_to(root)) for p in created]],cwd=root,check=False,capture_output=True)
            raise
        finally:
            if lock.exists() and json.loads(lock.read_text()).get('token')==token:lock.unlink()
    return 0
