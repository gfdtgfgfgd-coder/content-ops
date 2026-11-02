import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {open,readFile,readdir,realpath,stat} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';

const platforms=new Set(['xhs','xianyu']);
const sorts=new Set(['best','engaged','newest','wanted']);
const identifier=/^[0-9a-f]{1,64}$/iu;
const imageName=/^[a-z0-9][a-z0-9._-]{0,120}\.(?:jpe?g|png|webp|gif|avif)$/iu;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const within=(root,path)=>path.startsWith(root+sep);
const text=value=>Array.isArray(value)?value.map(String).join('\n'):value==null?'':String(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
const metric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;

export function parseReferenceQuery(params=new URLSearchParams()){
  for(const key of params.keys())if(!['platform','sort','offset','limit','ids'].includes(key)||params.getAll(key).length!==1)throw fail('素材库查询参数无效。');
  const platform=params.get('platform')??'xhs',sort=params.get('sort')??'best';
  if(!platforms.has(platform)||!sorts.has(sort)||(sort==='wanted'&&platform!=='xianyu'))throw fail('素材库平台或排序无效。');
  const integer=(key,fallback,min,max)=>{const raw=params.get(key);if(raw===null)return fallback;if(!/^\d+$/u.test(raw))throw fail('素材库分页参数无效。');const value=Number(raw);if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('素材库分页参数无效。');return value;};
  const offset=integer('offset',0,0,Number.MAX_SAFE_INTEGER),limit=integer('limit',30,1,100);
  let ids=null;
  if(params.has('ids')){
    const values=params.get('ids').split(',');
    if(!values.length||values.length>100||values.some(id=>!identifier.test(id)))throw fail('素材引用 ID 无效，单次最多 100 条。');
    ids=[...new Set(values)];
  }
  return {platform,sort,offset,limit,ids};
}

// Match the raw origin-form request target before URL normalizes dot segments.
export function referenceImageRequestPath(requestUrl){
  const raw=String(requestUrl||'').split('?')[0];
  let decoded;try{decoded=decodeURIComponent(raw);}catch{if(raw.startsWith('/api/content-ops/image/'))throw fail('图片路径无效。');return null;}
  if(!raw.startsWith('/api/content-ops/image/')&&!decoded.startsWith('/api/content-ops/image/'))return null;
  const pieces=decoded.slice('/api/content-ops/image/'.length).split('/');
  if(pieces.length!==3||!platforms.has(pieces[0])||!identifier.test(pieces[1])||!imageName.test(pieces[2])||decoded.includes('\\'))throw fail('图片路径无效。');
  return {platform:pieces[0],id:pieces[1],filename:pieces[2]};
}

export function sniffReferenceImage(bytes){
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=6&&/^GIF8[79]a$/u.test(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
  if(bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
  if(bytes.length>=16&&bytes.subarray(4,8).toString('ascii')==='ftyp'&&/avif|avis/u.test(bytes.subarray(8,32).toString('ascii')))return 'image/avif';
  throw fail('文件不是支持的素材图片。',415);
}

function imageUrls(post,platform){
  const prefix=`data/images/${platform}/${post.id}/`;
  return [...new Set((Array.isArray(post.images)?post.images:[]).flatMap(path=>{
    if(typeof path!=='string'||!path.startsWith(prefix))return [];
    const filename=path.slice(prefix.length);
    return imageName.test(filename)?[`/api/content-ops/image/${platform}/${post.id}/${encodeURIComponent(filename)}`]:[];
  }))];
}

function bundledRisk(posts,platform,config,rules){
  const expressions=rules.map(rule=>{
    const scope=rule.platform||[],models=rule.models||[],word=String(rule.word||'');
    if(!word||(!scope.includes(platform)&&!scope.includes('all')))return null;
    try{return {word,models,pattern:new RegExp(rule.regex?word:word.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'iu')};}
    catch{throw fail('偏好包中的风险词正则无效，请重新蒸馏。',500);}
  }).filter(Boolean);
  return posts.map(post=>{
    const context=config.model_context_fields.map(field=>text(post[field])).join('\n').toLocaleLowerCase();
    const hits=[];
    for(const field of config.scan_fields)for(const rule of expressions){
      if(rule.models.length&&!rule.models.some(model=>context.includes(String(model).toLocaleLowerCase())))continue;
      if(rule.pattern.test(text(post[field]))&&!hits.includes(rule.word))hits.push(rule.word);
    }
    return hits;
  });
}

const pythonRiskProgram=`import importlib.util,json,sys
from pathlib import Path
root=Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('reference_checker',root/'scripts/check-banned-words.py')
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
data=json.load(sys.stdin);config=data['config'];rules=checker.load_rules(root/config['rules'])
def text(value):
 return '\\n'.join(str(part) for part in value) if isinstance(value,list) else '' if value is None else str(value)
result=[]
for post in data['posts']:
 context='\\n'.join(text(post.get(field)) for field in config['model_context_fields']);hits=[]
 for field in config['scan_fields']:
  for hit in checker.check(text(post.get(field)),data['platform'],context,rules=rules):
   if hit['rule'] not in hits:hits.append(hit['rule'])
 result.append(hits)
print(json.dumps(result,ensure_ascii=False))
`;

async function checkerRisk(root,posts,platform,config){
  const python=[join(root,'scratch/.venv/bin/python3'),join(root,'.venv/bin/python')].find(path=>existsSync(path))||'python3';
  return await new Promise((resolvePromise,reject)=>{
    const child=spawn(python,['-c',pythonRiskProgram,root],{cwd:root,stdio:['pipe','pipe','pipe'],shell:false});
    let stdout='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolvePromise(value);};
    const timer=setTimeout(()=>{child.kill('SIGTERM');finish(fail('素材风险检查超时。',503));},15000);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>8_000_000){child.kill('SIGTERM');finish(fail('素材风险检查结果过大。',500));}});
    child.stderr.resume();
    child.once('error',()=>finish(fail('素材风险检查不可用，请安装现有 Python 检查器依赖。',503)));
    child.once('close',code=>{
      if(code!==0)return finish(fail('素材风险检查不可用，请检查现有词库与 Python 依赖。',503));
      try{const value=JSON.parse(stdout);if(!Array.isArray(value)||value.length!==posts.length||value.some(row=>!Array.isArray(row)||row.some(word=>typeof word!=='string')))throw new Error();finish(null,value);}
      catch{finish(fail('素材风险检查结果无效。',500));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({posts,platform,config}));
  });
}

export class ContentOpsReferenceStore {
  constructor({root}){this.root=resolve(root);}
  async configuration(){
    let value;try{value=JSON.parse(await readFile(join(this.root,'config/data-cleaning.json'),'utf8'));}catch{throw fail('素材库缺少有效的清洗配置。',503);}
    if(!Array.isArray(value.scan_fields)||!Array.isArray(value.model_context_fields)||!value.profiles?.xhs||!value.profiles?.xianyu)throw fail('素材库清洗配置结构无效。',503);
    return value;
  }
  async records(platform){
    let files;try{files=await readdir(join(this.root,'data',platform));}catch(error){if(error.code==='ENOENT')return [];throw fail('读取素材库目录失败。',500);}
    return await Promise.all(files.filter(name=>name.endsWith('.json')&&!name.startsWith('_')).sort().map(async name=>{
      let post;try{post=JSON.parse(await readFile(join(this.root,'data',platform,name),'utf8'));}catch{throw fail(`素材 JSON 无效：${name}`,500);}
      if(!post||typeof post!=='object'||!identifier.test(String(post.id||''))||`${post.id}.json`!==name)throw fail(`素材 ID 与文件不一致：${name}`,500);
      return post;
    }));
  }
  async risks(posts,platform,config){
    let bundle;try{bundle=JSON.parse(await readFile(join(this.root,'data/distilled-preferences.json'),'utf8'));}catch{}
    const rules=bundle?.platform_rules?.[platform]?.banned_word_rules;
    return Array.isArray(rules)&&rules.length?bundledRisk(posts,platform,config,rules):checkerRisk(this.root,posts,platform,config);
  }
  async list(params){
    const query=parseReferenceQuery(params),source=await this.records(query.platform),config=await this.configuration();
    const profile=config.profiles[query.platform],pending=source.filter(post=>!Array.isArray(post.signal?.banned_word_hits));
    const riskValues=pending.length?await this.risks(pending,query.platform,config):[];
    const risks=new Map(pending.map((post,index)=>[String(post.id),riskValues[index]]));
    const wantsOrder=[...source].sort((a,b)=>number(b.metrics?.[profile.wants_field||'wants'])-number(a.metrics?.[profile.wants_field||'wants'])||byId(a,b));
    const ranks=new Map(wantsOrder.filter(post=>number(post.metrics?.[profile.wants_field||'wants'])>0).map((post,index)=>[String(post.id),index+1]));
    const posts=source.map(post=>{
      const signal=post.signal||{},metrics=post.metrics||{},good=post.label?.good===true;
      const hits=Array.isArray(signal.banned_word_hits)?signal.banned_word_hits.filter(word=>typeof word==='string'):risks.get(String(post.id));
      let tier,clean;
      if(query.platform==='xhs'){
        tier=['good','high','mid','low'].includes(signal.engagement_tier)?signal.engagement_tier:good?'good':Object.entries(profile.high_metrics).some(([key,limit])=>number(metrics[key])>=limit)?'high':profile.interaction_metrics.some(key=>number(metrics[key])>0)?'mid':'low';
        clean=typeof signal.clean_for_style_reference==='boolean'?signal.clean_for_style_reference:good&&!hits.length;
      }else{
        const rank=ranks.get(String(post.id));
        tier=signal.wants_tier==='top'?'high':signal.wants_tier==='mid'?'mid':['low','none'].includes(signal.wants_tier)?'low':rank&&rank<=profile.top_count?'high':rank&&rank<=profile.reference_count?'mid':'low';
        clean=typeof signal.clean_for_style_reference==='boolean'?signal.clean_for_style_reference:Boolean(rank&&rank<=profile.reference_count&&!hits.length);
      }
      const images=imageUrls(post,query.platform),body=text(post.body);
      return {id:String(post.id),platform:query.platform,title:text(post.title),body_preview:[...body].slice(0,300).join(''),body_full:body,cover_ocr:text(post.cover_ocr),image:images[0]||null,images,
        metrics:{likes:metric(metrics.likes),collects:metric(metrics.collects),comments:metric(metrics.comments),wants:metric(metrics.wants)},label_good:good,
        clean_for_style_reference:clean,banned_word_hits:hits,engagement_tier:tier,model:typeof post.model==='string'?post.model:'',tags:Array.isArray(post.tags)?post.tags.filter(tag=>typeof tag==='string'):[],url:typeof post.url==='string'?post.url:'',fetched_at:typeof post.fetched_at==='string'?post.fetched_at:''};
    });
    const tierRank={good:3,high:2,mid:1,low:0};
    const engaged=post=>number(post.metrics.likes)+number(post.metrics.collects)*2+number(post.metrics.comments);
    posts.sort((a,b)=>{
      if(query.sort==='best')return Number(b.label_good&&b.clean_for_style_reference)-Number(a.label_good&&a.clean_for_style_reference)||tierRank[b.engagement_tier]-tierRank[a.engagement_tier]||number(b.metrics.likes)-number(a.metrics.likes)||byId(a,b);
      if(query.sort==='engaged')return engaged(b)-engaged(a)||byId(a,b);
      if(query.sort==='wanted')return Number(b.metrics.wants!==null)-Number(a.metrics.wants!==null)||number(b.metrics.wants)-number(a.metrics.wants)||byId(a,b);
      return (Date.parse(b.fetched_at)||0)-(Date.parse(a.fetched_at)||0)||byId(a,b);
    });
    const selected=query.ids?posts.filter(post=>query.ids.includes(post.id)):posts;
    // ids limits the result set; pagination and total describe that filtered set.
    return {total:selected.length,dataset_total:posts.length,offset:query.offset,limit:query.limit,posts:selected.slice(query.offset,query.offset+query.limit),
      ...(query.ids?{missing_ids:query.ids.filter(id=>!selected.some(post=>post.id===id))}:{})};
  }
  async image(path){
    if(!path||!platforms.has(path.platform)||!identifier.test(path.id)||!imageName.test(path.filename))throw fail('图片路径无效。');
    const base=join(this.root,'data/images'),target=resolve(base,path.platform,path.id,path.filename);
    if(!within(base,target))throw fail('图片路径无效。');
    let canonicalBase,canonical;
    try{canonicalBase=await realpath(base);canonical=await realpath(target);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')throw fail('素材图片不存在。',404);throw fail('图片路径无效。');}
    if(!within(canonicalBase,canonical))throw fail('图片路径无效。');
    const info=await stat(canonical);if(!info.isFile())throw fail('素材图片不存在。',404);
    const file=await open(canonical,'r');
    try{const bytes=Buffer.alloc(32),{bytesRead}=await file.read(bytes,0,32,0);return {path:canonical,mimeType:sniffReferenceImage(bytes.subarray(0,bytesRead))};}
    finally{await file.close();}
  }
}
