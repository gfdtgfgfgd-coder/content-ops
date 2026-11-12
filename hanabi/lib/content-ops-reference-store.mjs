import {spawn} from 'node:child_process';
import {editorCommand} from './content-ops-editor.mjs';
import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {cp,lstat,mkdir,open,readFile,realpath,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';

const platforms=new Set(['xhs','xianyu']);
const queryPlatforms=new Set(['all',...platforms]);
const identifier=/^[0-9a-f]{1,64}$/iu;
const collectionReference=/^(xhs|xianyu):([0-9a-f]{1,64})$/iu;
const imageName=/^[a-z0-9][a-z0-9._-]{0,120}\.(?:jpe?g|png|webp|gif|avif)$/iu;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const within=(root,path)=>path.startsWith(root+sep);
const text=value=>Array.isArray(value)?value.map(String).join('\n'):value==null?'':String(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
const metric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export const modelCategories=new Set(['GLM','Kimi','DeepSeek','Seedance/视频','其他']);
const layoutStyles=new Set(['code_ide','bold_typo','card_3d','comparison','other']);
const writes=new Map();
const maxImageBytes=15*1024*1024;
const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const referenceKey=post=>`${post.platform}:${post.id}`;
const sortModes=new Set(['manual','date_desc','date_asc']);
const publishedTime=value=>{
  if(typeof value!=='string'||!value.trim())return null;
  if(/^\d{4}-\d{2}-\d{2}$/u.test(value)){
    const stamp=Date.parse(`${value}T00:00:00+08:00`);
    return Number.isFinite(stamp)?stamp:null;
  }
  const stamp=Date.parse(value);
  return Number.isFinite(stamp)?stamp:null;
};
export function comparePublishedAt(a,b,direction='date_desc'){
  const left=publishedTime(a?.published_at),right=publishedTime(b?.published_at);
  if(left==null&&right==null)return byId(a,b);
  if(left==null)return 1;
  if(right==null)return -1;
  if(left!==right)return direction==='date_asc'?left-right:right-left;
  return byId(a,b);
}

export function parseReferenceQuery(params=new URLSearchParams()){
  for(const key of params.keys())if(!['platform','offset','limit','ids','collection_id','model_category','sort'].includes(key)||params.getAll(key).length!==1)throw fail('素材库查询参数无效。');
  const platform=params.get('platform')??'xhs',collectionId=params.get('collection_id')??'all',modelCategory=params.get('model_category')??'all',sort=params.get('sort')??'manual';
  if(!queryPlatforms.has(platform)||!['all','uncategorized'].includes(collectionId)&&!identifier.test(collectionId))throw fail('素材库平台或合集无效。');
  if(modelCategory!=='all'&&!modelCategories.has(modelCategory))throw fail('素材库模型筛选无效。');
  if(!sortModes.has(sort))throw fail('素材库排序无效。');
  const integer=(key,fallback,min,max)=>{const raw=params.get(key);if(raw===null)return fallback;if(!/^\d+$/u.test(raw))throw fail('素材库分页参数无效。');const value=Number(raw);if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('素材库分页参数无效。');return value;};
  const offset=integer('offset',0,0,Number.MAX_SAFE_INTEGER),limitRaw=params.get('limit'),limit=limitRaw==='all'?5000:integer('limit',30,1,5000);
  let ids=null;
  if(params.has('ids')){
    const values=params.get('ids').split(',');
    if(!values.length||values.length>100||values.some(id=>!identifier.test(id)))throw fail('素材引用 ID 无效，单次最多 100 条。');
    ids=[...new Set(values)];
  }
  return {platform,collectionId,modelCategory,sort,offset,limit,ids};
}

export function classifyReference(post){
  const source=[post.model,post.title,post.body,post.cover_ocr,...(Array.isArray(post.tags)?post.tags:[])].filter(Boolean).join(' ').toLocaleLowerCase();
  const model=/(seedance|即梦|视频生成|视频模型)/iu.test(source)?'Seedance/视频':/(glm|智谱|智谱清言)/iu.test(source)?'GLM':/(kimi|月之暗面)/iu.test(source)?'Kimi':/(deepseek|深度求索)/iu.test(source)?'DeepSeek':'其他';
  // Business topics such as “编程/代码” do not describe the cover's layout.
  // Prefer explicit layout terms; short OCR title lines are only a heuristic,
  // never a claim that we inspected pixels. Missing evidence stays “other”.
  const ocr=text(post.cover_ocr), lines=ocr.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
  const visual=[post.title,ocr].filter(Boolean).join(' ');
  let layout='other',basis='无明确版式线索';
  if(/代码屏|终端(?:窗口|界面)|(?:IDE|VS\s?Code)\s*(?:界面|截图|窗口)|编程界面|\$\s*(?:npm|pip|git|python)|(?:const|import|def|function)\s+\w+[=(\s]/iu.test(visual)){
    layout='code_ide';basis='封面文字含代码界面或命令语法';
  }else if(/对比(?:图|表)|表格|看板|前后对比|\bvs\b|[✓✔].*[✕✗×]/iu.test(visual)){
    layout='comparison';basis='封面文字含对比或表格线索';
  }else if(/3D|悬浮卡片|流程图|立体卡片|步骤[一二三123]|[→➜]/iu.test(visual)){
    layout='card_3d';basis='封面文字含卡片或流程线索';
  }else if(/大字报|粗体|撞色|醒目大字|超大字/iu.test(visual)||(lines.length>=3&&lines.length<=12&&lines.filter(line=>[...line].length<=24).length/lines.length>=.8)){
    layout='bold_typo';basis='短行标题 OCR 或明确大字报描述';
  }
  return {model_category:modelCategories.has(post.model_category)?post.model_category:model,layout_style:layoutStyles.has(post.layout_style)?post.layout_style:layout,layout_basis:layoutStyles.has(post.layout_style)?'人工标注':basis,classification_method:layoutStyles.has(post.layout_style)?'manual':'text_heuristic'};
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

function imageUrls(post){
  const prefix=`data/images/${post.platform}/${post.id}/`;
  return [...new Set((Array.isArray(post.images)?post.images:[]).flatMap(path=>{
    if(typeof path!=='string'||!path.startsWith(prefix))return [];
    const filename=path.slice(prefix.length);
    return imageName.test(filename)?[`/api/content-ops/image/${post.platform}/${post.id}/${encodeURIComponent(filename)}`]:[];
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
spec=importlib.util.spec_from_file_location('reference_checker',root/'scripts/lib/words.py')
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

// MIME is determined from the bytes, never the supplied filename.
function uploadedImage(value){
  let bytes,declared;
  if(Buffer.isBuffer(value)||value instanceof Uint8Array)bytes=Buffer.from(value);
  else {
    if(value&&typeof value==='object'){declared=value.mimeType;value=value.data;}
    if(typeof value!=='string')throw fail('图片必须是 Base64 或二进制数据。');
    const match=value.match(/^data:([^;,]+);base64,(.*)$/su);
    if(match){declared=match[1];value=match[2];}
    if(value.length>4*Math.ceil(maxImageBytes/3))throw fail('图片不能超过 15MB。',413);
    if(!value||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/u.test(value))throw fail('图片 Base64 无效。');
    bytes=Buffer.from(value,'base64');
    if(bytes.toString('base64')!==value)throw fail('图片 Base64 无效。');
  }
  if(bytes.length>maxImageBytes)throw fail('图片不能超过 15MB。',413);
  const mime=sniffReferenceImage(bytes),ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[mime];
  if(!ext||declared&&declared!==mime)throw fail('仅支持真实的 PNG / JPEG / WebP 图片。',415);
  // Reject truncated headers that cannot describe an image.
  const valid=ext==='png'?bytes.length>=33&&bytes.subarray(12,16).toString()==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.subarray(-8,-4).toString()==='IEND':
    ext==='jpg'?bytes.length>=4&&bytes.subarray(-2).equals(Buffer.from([255,217])):
    bytes.length>=20&&bytes.readUInt32LE(4)+8===bytes.length&&/^VP8[ LX]$/u.test(bytes.subarray(12,16).toString());
  if(!valid)throw fail('图片内容损坏或不完整。',415);
  return {bytes,ext};
}

function referenceFields(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw fail('素材字段无效。');
  const allowed=new Set(['platform','title','body','cover_ocr','model','model_category','layout_style','label','image','retained_images','new_images','published_at']);
  if(Object.keys(payload).some(key=>!allowed.has(key)))throw fail('包含不支持的素材字段。');
  const fields={};
  for(const key of ['title','body','cover_ocr','model'])if(Object.hasOwn(payload,key)){
    if(typeof payload[key]!=='string'||payload[key].length>200000||payload[key].includes('\0'))throw fail('素材文字字段无效或过长。');
    fields[key]=payload[key];
  }
  if(Object.hasOwn(payload,'published_at')){
    const date=payload.published_at;
    if(typeof date!=='string'||date&&!/^\d{4}-\d{2}-\d{2}$/u.test(date)||date&&(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw fail('发布日期须为有效的年月日。');
    fields.published_at=date;fields.published_at_source=date?'manual_date':'';
  }
  for(const [key,values] of [['platform',platforms],['model_category',modelCategories],['layout_style',layoutStyles]])if(Object.hasOwn(payload,key)){
    if(!values.has(payload[key]))throw fail('素材平台或分类无效。');fields[key]=payload[key];
  }
  if(Object.hasOwn(payload,'label')){
    if(!payload.label||Array.isArray(payload.label)||typeof payload.label.good!=='boolean'||Object.keys(payload.label).some(key=>key!=='good'))throw fail('精选标记无效。');
    fields.label={good:payload.label.good};
  }
  return fields;
}

export class ContentOpsReferenceStore {
  constructor({root}){this.root=resolve(root);}
  // Serialize the read/modify/rename cycle across store instances for this root.
  async mutate(operation){
    const previous=writes.get(this.root)||Promise.resolve();
    const current=previous.catch(()=>{}).then(async()=>{
      await this.safeDirectory('data');
      const unlock=await this.lock();
      try{
        const repository=await editorCommand('git',['rev-parse','--show-toplevel'],{cwd:this.root});
        if(repository.code!==0||resolve(repository.stdout.trim())!==this.root)throw fail('素材库必须位于独立 Git 仓库根目录，操作尚未保存。',503);
        return await operation();
      }finally{await unlock();}
    });
    writes.set(this.root,current);
    try{return await current;}finally{if(writes.get(this.root)===current)writes.delete(this.root);}
  }
  async commitData(message,paths){
    const allowed=new Set(['data/posts.jsonl','data/collections.json']);
    if(!paths.length||paths.some(path=>!allowed.has(path)))throw fail('素材库提交路径无效。',500);
    const git=args=>editorCommand('git',args,{cwd:this.root});
    const tracked=await git(['ls-files','--error-unmatch','--',...paths]);
    if(tracked.code!==0)throw fail('素材数据文件尚未纳入 Git，操作已撤回。',503);
    const diff=await git(['diff','--quiet','HEAD','--',...paths]);
    if(diff.code===0)return;
    if(diff.code!==1)throw fail('无法检查素材数据版本，操作已撤回。',503);
    const identity=[];
    for(const [key,fallback] of [['user.name','Hanabi'],['user.email','hanabi@localhost']]){
      const value=await git(['config','--get',key]);
      if(!value.stdout.trim())identity.push('-c',`${key}=${fallback}`);
    }
    const result=await git([...identity,'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--only','-m',message,'--',...paths]);
    if(result.code!==0)throw fail('素材库 Git 提交失败，操作已撤回；请检查 Git 写入锁与权限。',503);
  }
  async saveCollections(collections,previous,id){
    await this.writeCollections(collections);
    try{await this.commitData(`素材库：更新素材合集 ${id}`,['data/collections.json']);}
    catch(error){await this.writeCollections(previous);throw error;}
  }
  async lock(){
    const path=join(this.root,'data/.posts.lock'),token=randomBytes(12).toString('hex');
    for(let attempt=0;attempt<2;attempt++){
      let file;
      try{file=await open(path,'wx',0o600);}catch(error){
        if(error.code!=='EEXIST')throw error;
        try{
          const record=JSON.parse(await readFile(path,'utf8'));
          if(!Number.isInteger(record.pid)||record.pid<=0)throw fail('素材库写入锁无效。',409);
          try{process.kill(record.pid,0);}catch(check){if(check.code==='ESRCH'){await rm(path);continue;}throw check;}
        }catch(check){if(check.statusCode)throw check;}
        throw fail('素材库正在写入，请稍后重试。',409);
      }
      try{await file.writeFile(JSON.stringify({pid:process.pid,token}));}catch(error){await rm(path,{force:true});throw error;}finally{await file.close();}
      return async()=>{if(JSON.parse(await readFile(path,'utf8')).token===token)await rm(path);};
    }
    throw fail('素材库正在写入，请稍后重试。',409);
  }
  async safeDirectory(relative){
    let path=this.root;
    for(const piece of relative.split('/')){
      path=join(path,piece);await mkdir(path).catch(error=>{if(error.code!=='EEXIST')throw error;});
      const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory())throw fail('素材存储目录无效。');
    }
    return path;
  }
  async writeRecords(posts){
    const path=join(this.root,'data/posts.jsonl'),temporary=path+'.'+randomBytes(12).toString('hex')+'.tmp';
    const info=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(info&&(!info.isFile()||info.isSymbolicLink()))throw fail('素材存储文件无效。');
    try{
      const file=await open(temporary,'wx',0o600);
      try{await file.writeFile(posts.map(post=>JSON.stringify(post)).join('\n')+(posts.length?'\n':''));await file.sync();}finally{await file.close();}
      await rename(temporary,path);
    }finally{await rm(temporary,{force:true});}
  }
  normalizeCollection(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||!identifier.test(String(value.id||'')))throw fail('合集数据无效。',500);
    const name=typeof value.name==='string'?value.name.trim():'';
    const createdAt=typeof value.created_at==='string'?value.created_at:'';
    const referenceIds=Array.isArray(value.reference_ids)?[...new Set(value.reference_ids.map(String))]:null;
    if(!name||name.length>80||name.includes('\0')||!createdAt||!referenceIds||referenceIds.length>10000||referenceIds.some(referenceId=>!collectionReference.test(referenceId)))throw fail('合集数据无效。',500);
    return {id:String(value.id),name,created_at:createdAt,reference_ids:referenceIds};
  }
  async readCollections(){
    const path=join(this.root,'data/collections.json');
    let raw;try{raw=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return [];throw fail('读取素材合集失败。',500);}
    let value;try{value=JSON.parse(raw);}catch{throw fail('素材合集文件无效。',500);}
    const records=Array.isArray(value)?value:value?.collections;
    if(!Array.isArray(records))throw fail('素材合集文件结构无效。',500);
    const seen=new Set();
    return records.map(record=>{
      const collection=this.normalizeCollection(record);
      if(seen.has(collection.id))throw fail('素材合集 ID 重复。',500);
      seen.add(collection.id);return collection;
    });
  }
  async writeCollections(collections){
    const path=join(this.root,'data/collections.json'),temporary=path+'.'+randomBytes(12).toString('hex')+'.tmp';
    const info=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(info&&(!info.isFile()||info.isSymbolicLink()))throw fail('素材合集文件无效。');
    try{
      const file=await open(temporary,'wx',0o600);
      try{await file.writeFile(JSON.stringify({collections},null,2)+'\n');await file.sync();}finally{await file.close();}
      await rename(temporary,path);
    }finally{await rm(temporary,{force:true});}
  }
  collectionName(value){
    if(typeof value!=='string')throw fail('合集名称无效。');
    const name=value.trim();
    if(!name||name.length>80||name.includes('\0'))throw fail('合集名称需为 1-80 个字符。');
    return name;
  }
  collectionReferences(value){
    if(!Array.isArray(value)||value.length>10000||value.some(referenceId=>typeof referenceId!=='string'||!collectionReference.test(referenceId)))throw fail('合集关联素材无效。');
    return [...new Set(value)];
  }
  async createCollection(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['name'].includes(key)))throw fail('合集字段无效。');
    const name=this.collectionName(payload.name);
    return this.mutate(async()=>{
      const collections=await this.readCollections();
      let id;do{id=randomBytes(12).toString('hex');}while(collections.some(collection=>collection.id===id));
      const collection={id,name,created_at:new Date().toISOString(),reference_ids:[]};
      await this.saveCollections([...collections,collection],collections,id);return collection;
    });
  }
  async updateCollection(id,payload){
    if(!identifier.test(String(id))||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['name','reference_ids','referenceIds'].includes(key)))throw fail('合集参数无效。');
    const hasName=Object.hasOwn(payload,'name'),hasReferences=Object.hasOwn(payload,'reference_ids')||Object.hasOwn(payload,'referenceIds');
    if(!hasName&&!hasReferences)throw fail('合集没有可更新字段。');
    const name=hasName?this.collectionName(payload.name):null;
    const referenceIds=hasReferences?this.collectionReferences(payload.reference_ids??payload.referenceIds):null;
    return this.mutate(async()=>{
      const collections=await this.readCollections(),index=collections.findIndex(collection=>collection.id===String(id));
      if(index<0)throw fail('素材合集不存在。',404);
      const collection={...collections[index],...(hasName?{name}:{}),...(hasReferences?{reference_ids:referenceIds}:{})};
      const next=[...collections];next[index]=collection;await this.saveCollections(next,collections,id);return collection;
    });
  }
  async deleteCollection(id){
    if(!identifier.test(String(id)))throw fail('合集 ID 无效。');
    return this.mutate(async()=>{
      const collections=await this.readCollections(),index=collections.findIndex(collection=>collection.id===String(id));
      if(index<0)throw fail('素材合集不存在。',404);
      const collection=collections[index];await this.saveCollections(collections.filter((_,position)=>position!==index),collections,id);return {id:collection.id,name:collection.name};
    });
  }
  async reorderReferences(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['platform','ids'].includes(key)))throw fail('素材排序参数无效。');
    const platform=payload.platform;
    if(!queryPlatforms.has(platform))throw fail('素材排序平台无效。');
    if(!Array.isArray(payload.ids)||payload.ids.length>5000||payload.ids.some(id=>typeof id!=='string'||!identifier.test(id)))throw fail('素材排序 ID 无效。');
    const ids=payload.ids.map(String);
    if(new Set(ids).size!==ids.length)throw fail('素材排序 ID 不得重复。');
    return this.mutate(async()=>{
      const posts=await this.records();
      const byReference=new Map(posts.map(post=>[post.id,post]));
      for(const id of ids){
        const post=byReference.get(id);
        if(!post)throw fail('素材排序包含不存在的 ID。',404);
        if(platform!=='all'&&post.platform!==platform)throw fail('素材排序包含不属于当前平台的 ID。');
      }
      if(!ids.length)return {ok:true,count:0};
      const visible=[...posts].reverse(),selectedIds=new Set(ids);
      const slots=visible.map((post,index)=>selectedIds.has(post.id)?index:-1).filter(index=>index>=0);
      if(slots.length!==ids.length)throw fail('素材排序包含重复或不可见的 ID。');
      ids.forEach((id,index)=>{visible[slots[index]]=byReference.get(id);});
      await this.writeRecords(visible.reverse());
      try{await this.commitData('素材库：重排全量素材顺序',['data/posts.jsonl']);}
      catch(error){await this.writeRecords(posts);throw error;}
      return {ok:true,count:ids.length};
    });
  }
  imageEdits(payload,old){
    const explicit=Object.hasOwn(payload,'retained_images')||Object.hasOwn(payload,'new_images');
    if(!explicit)return null;
    if(Object.hasOwn(payload,'image'))throw fail('不能同时提交旧版封面和多图编辑字段。');
    const retained=Object.hasOwn(payload,'retained_images')?payload.retained_images:(old?.images||[]);
    const additions=Object.hasOwn(payload,'new_images')?payload.new_images:[];
    if(!Array.isArray(retained)||!Array.isArray(additions)||retained.length+additions.length>200||additions.length>50||new Set(retained).size!==retained.length)throw fail('图片列表无效，最多保留 200 张，单次最多新增 50 张。');
    const originals=new Set(old?.images||[]),prefix=`data/images/${old?.platform||payload.platform||'xhs'}/${old?.id||''}/`;
    if(retained.some(path=>typeof path!=='string'||!originals.has(path)||!path.startsWith(prefix)||!imageName.test(path.slice(prefix.length))))throw fail('保留图片必须属于当前素材，不能引用其他文件。');
    const images=additions.map(uploadedImage);
    if(images.reduce((size,image)=>size+image.bytes.length,0)>45*1024*1024)throw fail('单次新增图片总大小不能超过 45MB。',413);
    return {retained,images};
  }
  async addReference(payload){
    const fields=referenceFields(payload),image=payload.image==null?null:uploadedImage(payload.image);
    return this.mutate(async()=>{
      const edits=this.imageEdits(payload,null),posts=await this.records();
      let id;do{id=randomBytes(12).toString('hex');}while(posts.some(post=>post.id===id));
      const post={id,platform:'xhs',title:'',body:'',cover_ocr:'',model:'',label:{good:false},...fields,images:[],source:'user_added',fetched_at:new Date().toISOString()};
      return this.saveReference(posts,null,post,image,payload.image!==undefined,edits);
    });
  }
  async updateReference(id,updates){
    if(!identifier.test(String(id)))throw fail('素材 ID 无效。');
    const fields=referenceFields(updates),image=updates.image==null?null:uploadedImage(updates.image);
    return this.mutate(async()=>{
      const posts=await this.records(),old=posts.find(post=>post.id===id);if(!old)throw fail('素材不存在。',404);
      const edits=this.imageEdits(updates,old),post={...old,...fields,label:{...old.label,...fields.label}};
      // Content changes invalidate derived risk signals, not the original metrics.
      delete post.signal;
      return this.saveReference(posts,old,post,image,Object.hasOwn(updates,'image'),edits);
    });
  }
  async saveReference(posts,old,post,image,changeImage,edits=null){
    const oldImages=Array.isArray(post.images)?post.images:[];
    const hasImage=edits?edits.retained.length+edits.images.length>0:changeImage?Boolean(image):oldImages.length>0;
    if(!hasImage&&!post.title?.trim()&&!post.body?.trim())throw fail('请至少保留一张图片或填写标题/正文。');
    const relocate=old&&old.platform!==post.platform;
    const changedImages=Boolean(edits&&(edits.images.length||JSON.stringify(edits.retained)!==JSON.stringify(oldImages)));
    const changeDirectory=changeImage||relocate||changedImages;
    const collections=relocate?await this.readCollections():[];
    const nextCollections=collections.map(collection=>({...collection,reference_ids:collection.reference_ids.map(id=>id===referenceKey(old)?referenceKey(post):id)}));
    const collectionsChanged=collections.some(collection=>collection.reference_ids.includes(referenceKey(old)));
    let staging,backup,oldDir,target,installed=false,backedUp=false,recordsWritten=false,collectionsWritten=false;
    try{
      if(changeDirectory){
        const parent=await this.safeDirectory(`data/images/${post.platform}`);
        target=join(parent,post.id);oldDir=old?join(await this.safeDirectory(`data/images/${old.platform}`),post.id):target;
        const info=await lstat(oldDir).catch(error=>{if(error.code!=='ENOENT')throw error;});
        if(info&&(info.isSymbolicLink()||!info.isDirectory()))throw fail('素材图片目录无效。');
        if(relocate&&await lstat(target).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw fail('目标素材目录已存在。',409);
        const token=randomBytes(12).toString('hex');staging=join(parent,`.${post.id}-${token}.tmp`);backup=oldDir+`.${token}.bak`;
        await mkdir(staging);
        if(edits){
          post.images=[];
          for(const previous of edits.retained){
            const filename=previous.split('/').at(-1),source=join(oldDir,filename);
            const original=await lstat(source).catch(error=>{if(error.code!=='ENOENT')throw error;});
            if(!original||!original.isFile()||original.isSymbolicLink()||!within(oldDir,await realpath(source)))throw fail('保留图片缺失或不是安全的本地文件，请移除后重试。');
            await cp(source,join(staging,filename),{dereference:false,errorOnExist:true,force:false});
            post.images.push(`data/images/${post.platform}/${post.id}/${filename}`);
          }
          for(const addition of edits.images){
            const filename=`upload-${randomBytes(12).toString('hex')}.${addition.ext}`;
            const file=await open(join(staging,filename),'wx',0o600);
            try{await file.writeFile(addition.bytes);await file.sync();}finally{await file.close();}
            post.images.push(`data/images/${post.platform}/${post.id}/${filename}`);
          }
          // Removed crawler URLs must not later rehydrate deleted carousel images.
          post.image_urls=[];
        }else{
        if(info)await cp(oldDir,staging,{recursive:true,dereference:false});
        if(changeImage){
          // A replacement updates the cover; remaining carousel images are retained.
          if(image){
            const previous=oldImages[0];
            if(typeof previous==='string'&&previous.startsWith(`data/images/${old?.platform||post.platform}/${post.id}/`)&&imageName.test(previous.split('/').at(-1)))await rm(join(staging,previous.split('/').at(-1)),{force:true});
            const filename=`1.${image.ext}`;
            await rm(join(staging,filename),{force:true}); // never follow an existing symlink
            await writeFile(join(staging,filename),image.bytes,{flag:'wx',mode:0o600});
            post.images=[`data/images/${post.platform}/${post.id}/${filename}`,...oldImages.slice(1).map(path=>path.replace(`data/images/${old?.platform||post.platform}/`,`data/images/${post.platform}/`))].filter((path,index,all)=>all.indexOf(path)===index);
          }else{await rm(staging,{recursive:true,force:true});await mkdir(staging);post.images=[];}
        }else if(relocate)post.images=oldImages.map(path=>path.replace(`data/images/${old.platform}/`,`data/images/${post.platform}/`));
        }
        if(info){await rename(oldDir,backup);backedUp=true;}
        await rename(staging,target);installed=true;
      }
      const next=old?posts.map(item=>item.id===post.id?post:item):[...posts,post];
      await this.writeRecords(next);
      recordsWritten=true;
      if(collectionsChanged){await this.writeCollections(nextCollections);collectionsWritten=true;}
      await this.commitData(`素材库：${old?'更新':'录入'}素材 ${post.id}`,['data/posts.jsonl',...(collectionsChanged?['data/collections.json']:[])]);
    }catch(error){
      if(collectionsWritten)await this.writeCollections(collections);
      if(recordsWritten)await this.writeRecords(posts).catch(()=>{});
      if(installed)await rm(target,{recursive:true,force:true});
      if(backedUp)await rename(backup,oldDir);
      throw error;
    }finally{if(staging)await rm(staging,{recursive:true,force:true});}
    if(backedUp)await rm(backup,{recursive:true,force:true});
    if(installed&&!post.images.length)await rm(target,{recursive:true,force:true});
    return post;
  }
  async deleteReference(id){
    if(!identifier.test(String(id)))throw fail('素材 ID 无效。');
    return this.mutate(async()=>{
      const posts=await this.records(),post=posts.find(item=>item.id===id);if(!post)throw fail('素材不存在。',404);
      const collections=await this.readCollections(),referenceId=referenceKey(post);
      const nextCollections=collections.map(collection=>({...collection,reference_ids:collection.reference_ids.filter(value=>value!==referenceId)}));
      const collectionsChanged=nextCollections.some((collection,index)=>collection.reference_ids.length!==collections[index].reference_ids.length);
      const parent=await this.safeDirectory(`data/images/${post.platform}`),path=join(parent,id),backup=path+'.'+randomBytes(12).toString('hex')+'.bak';
      let moved=false,recordsWritten=false,collectionsWritten=false;
      try{
        try{await rename(path,backup);moved=true;}catch(error){if(error.code!=='ENOENT')throw error;}
        await this.writeRecords(posts.filter(item=>item.id!==id));
        recordsWritten=true;
        if(collectionsChanged){await this.writeCollections(nextCollections);collectionsWritten=true;}
        await this.commitData(`素材库：删除素材 ${id}`,['data/posts.jsonl',...(collectionsChanged?['data/collections.json']:[])]);
      }catch(error){
        if(collectionsWritten)await this.writeCollections(collections);
        if(recordsWritten)await this.writeRecords(posts).catch(()=>{});
        if(moved)await rename(backup,path);
        throw error;
      }
      if(moved)await rm(backup,{recursive:true,force:true});
      return {id,platform:post.platform};
    });
  }
  async configuration(){
    let value;try{value=JSON.parse(await readFile(join(this.root,'config/data-cleaning.json'),'utf8'));}catch{throw fail('素材库缺少有效的清洗配置。',503);}
    if(!Array.isArray(value.scan_fields)||!Array.isArray(value.model_context_fields)||!value.profiles?.xhs||!value.profiles?.xianyu)throw fail('素材库清洗配置结构无效。',503);
    return value;
  }
  async records(platform){
    let raw;try{raw=await readFile(join(this.root,'data/posts.jsonl'),'utf8');}catch(error){if(error.code==='ENOENT')return [];throw fail('读取素材库失败。',500);}
    const seen=new Set(),posts=[];
    for(const [index,line] of raw.split('\n').entries()){
      if(!line.trim())continue;
      let post;try{post=JSON.parse(line);}catch{throw fail(`素材 JSONL 无效：第 ${index+1} 行`,500);}
      if(!post||typeof post!=='object'||!identifier.test(String(post.id||''))||!platforms.has(post.platform)||seen.has(post.id))throw fail(`素材 ID 或平台无效/重复：第 ${index+1} 行`,500);
      seen.add(post.id);if(platform===undefined||platform==='all'||post.platform===platform)posts.push(post);
    }
    return posts;
  }
  async risks(posts,platform,config){
    let bundle;try{bundle=JSON.parse(await readFile(join(this.root,'data/distilled-preferences.json'),'utf8'));}catch{}
    const rules=bundle?.platform_rules?.[platform]?.banned_word_rules;
    return Array.isArray(rules)&&rules.length?bundledRisk(posts,platform,config,rules):checkerRisk(this.root,posts,platform,config);
  }
  async heatScores(posts){
    if(!posts.some(post=>post.platform==='xhs'&&post.author_id&&post.published_at&&post.metrics_observed_at))return {};
    const python=[join(this.root,'scratch/.venv/bin/python'),join(this.root,'scratch/.venv/bin/python3')].find(path=>existsSync(path))||'python3';
    const program="import json,sys;sys.path.insert(0,sys.argv[1]);from scripts.lib.monitoring import heat_scores,policy;print(json.dumps(heat_scores(json.load(sys.stdin),policy(sys.argv[1]))))";
    const result=await editorCommand(python,['-c',program,this.root],{cwd:this.root,input:JSON.stringify(posts)});
    if(result.code!==0)throw fail('互动热度计算失败，请检查本机采集配置。',503);
    return JSON.parse(result.stdout);
  }
  async list(params){
    const query=parseReferenceQuery(params),source=await this.records(query.platform),config=await this.configuration(),collections=await this.readCollections();
    const risks=new Map();
    for(const platform of platforms){
      const pending=source.filter(post=>post.platform===platform&&!Array.isArray(post.signal?.banned_word_hits));
      if(!pending.length)continue;
      const riskValues=await this.risks(pending,platform,config);
      pending.forEach((post,index)=>risks.set(referenceKey(post),riskValues[index]));
    }
    const heat=await this.heatScores(source);
    const ranks=new Map();
    for(const platform of platforms){
      const profile=config.profiles[platform];
      const wantsOrder=source.filter(post=>post.platform===platform).sort((a,b)=>number(b.metrics?.[profile.wants_field||'wants'])-number(a.metrics?.[profile.wants_field||'wants'])||byId(a,b));
      wantsOrder.filter(post=>number(post.metrics?.[profile.wants_field||'wants'])>0).forEach((post,index)=>ranks.set(referenceKey(post),index+1));
    }
    const collectionByReference=new Map();
    for(const collection of collections)for(const referenceId of collection.reference_ids){
      const names=collectionByReference.get(referenceId)||[];names.push({id:collection.id,name:collection.name});collectionByReference.set(referenceId,names);
    }
    const posts=source.map(post=>{
      const profile=config.profiles[post.platform],referenceId=referenceKey(post);
      const signal=post.signal||{},metrics=post.metrics||{},good=post.label?.good===true;
      const hits=Array.isArray(signal.banned_word_hits)?signal.banned_word_hits.filter(word=>typeof word==='string'):risks.get(referenceId)||[];
      let tier,clean;
      if(post.platform==='xhs'){
        tier=['good','high','mid','low'].includes(signal.engagement_tier)?signal.engagement_tier:good?'good':Object.entries(profile.high_metrics).some(([key,limit])=>number(metrics[key])>=limit)?'high':profile.interaction_metrics.some(key=>number(metrics[key])>0)?'mid':'low';
        clean=typeof signal.clean_for_style_reference==='boolean'?signal.clean_for_style_reference:good&&!hits.length;
      }else{
        const rank=ranks.get(referenceId);
        tier=signal.wants_tier==='top'?'high':signal.wants_tier==='mid'?'mid':['low','none'].includes(signal.wants_tier)?'low':rank&&rank<=profile.top_count?'high':rank&&rank<=profile.reference_count?'mid':'low';
        clean=typeof signal.clean_for_style_reference==='boolean'?signal.clean_for_style_reference:Boolean(rank&&rank<=profile.reference_count&&!hits.length);
      }
      const images=imageUrls(post),body=text(post.body),postCollections=collectionByReference.get(referenceId)||[];
      return {id:String(post.id),platform:post.platform,heat:heat[post.id]||null,title:text(post.title),body_preview:[...body].slice(0,300).join(''),body_full:body,cover_ocr:text(post.cover_ocr),image:images[0]||null,images,...classifyReference(post),
        metrics:{likes:metric(metrics.likes),collects:metric(metrics.collects),comments:metric(metrics.comments),wants:metric(metrics.wants)},label_good:good,
        clean_for_style_reference:clean,banned_word_hits:hits,engagement_tier:tier,model:typeof post.model==='string'?post.model:'',tags:Array.isArray(post.tags)?post.tags.filter(tag=>typeof tag==='string'):[],url:typeof post.url==='string'?post.url:'',fetched_at:typeof post.fetched_at==='string'?post.fetched_at:'',published_at:typeof post.published_at==='string'?post.published_at:'',published_at_source:post.published_at_source||'',metrics_observed_at:post.metrics_observed_at||'',metrics_history:Array.isArray(post.metrics_history)?post.metrics_history:[],author_id:post.author_id||'',collection_ids:postCollections.map(collection=>collection.id),collection_names:postCollections.map(collection=>collection.name)};
    });
    posts.reverse();
    const collection=collections.find(item=>item.id===query.collectionId);
    if(query.collectionId!=='all'&&query.collectionId!=='uncategorized'&&!collection)throw fail('素材合集不存在。',404);
    const postsByKey=new Map(posts.map(post=>[referenceKey(post),post]));
    const matchesModel=post=>query.modelCategory==='all'||post.model_category===query.modelCategory;
    let selected=query.collectionId!=='all'&&query.collectionId!=='uncategorized'
      ? collection.reference_ids.map(referenceId=>postsByKey.get(referenceId)).filter(Boolean)
          .filter(post=>matchesModel(post)&&(!query.ids||query.ids.includes(post.id)))
      : posts.filter(post=>{
        const matchesCollection=query.collectionId==='all'||!post.collection_ids.length;
        return matchesCollection&&matchesModel(post)&&(!query.ids||query.ids.includes(post.id));
      });
    if(query.sort==='date_desc'||query.sort==='date_asc')selected=[...selected].sort((a,b)=>comparePublishedAt(a,b,query.sort));
    // ids limits the result set; pagination and total describe that filtered set.
    return {total:selected.length,dataset_total:posts.length,offset:query.offset,limit:query.limit,sort:query.sort,posts:selected.slice(query.offset,query.offset+query.limit),
      model_categories:[...modelCategories],
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
