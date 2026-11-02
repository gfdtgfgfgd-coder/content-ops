import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';

const PERSONA='skills/simin-persona/SKILL.md';
const WORDS='rules/banned-words-quick.yaml';
const FEEDBACK='data/wecom/simin-feedback.jsonl';
const BUNDLE='data/distilled-preferences.json';
const SOURCE_FILES=[PERSONA,WORDS,FEEDBACK,BUNDLE];
const MAX_BYTES=256_000;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const hash=value=>createHash('sha256').update(value).digest('hex');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const line=(value,name,max=2000,optional=false)=>{
  if(optional&&(value===undefined||value===''))return '';
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\r\n\x00-\x1f\x7f]/u.test(value))throw fail(`${name}须为1–${max}字的单行文本。`);
  return value.trim();
};
const date=value=>{
  const result=value||today();
  if(typeof result!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(result)||Number.isNaN(Date.parse(result))||new Date(result+'T00:00:00Z').toISOString().slice(0,10)!==result)throw fail('日期格式须为有效的 YYYY-MM-DD。');
  return result;
};
function fields(body,allowed){
  if(!isObject(body)||Object.keys(body).some(key=>!allowed.includes(key)))throw fail('编辑参数无效。');
  if(body.revision!==undefined&&!/^[0-9a-f]{64}$/u.test(body.revision))throw fail('编辑版本无效，请刷新。');
}

export async function editorCommand(command,args,{cwd,input='',env=process.env,timeout=30000,maxBytes=2_000_000}={}){
  return await new Promise((resolveCommand,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe'],shell:false});
    let stdout='',stderr='',settled=false;
    const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolveCommand(result);};
    const timer=setTimeout(()=>{child.kill('SIGTERM');done(fail('本机文件检查超时，请稍后重试。',503));},timeout);timer.unref?.();
    child.stdout.on('data',chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>maxBytes){child.kill('SIGTERM');done(fail('本机检查输出过大。',503));}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
    child.once('error',()=>done(fail('本机 Git 或 Python 不可用。',503)));
    child.once('close',code=>done(null,{code:code??1,stdout,stderr}));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
const yamlProgram=`import json,sys,yaml\nvalue=json.load(sys.stdin)\nif value['action']=='parse':\n result=yaml.safe_load(value['text'])\n print(json.dumps(result,ensure_ascii=False,default=str))\nelse:\n print(yaml.safe_dump(value['entry'],allow_unicode=True,sort_keys=False,width=200).rstrip())\n`;

function markdownSection(raw,headings){
  const matches=[...raw.matchAll(/^##\s+(.+?)\s*$/gmu)];
  const current=matches.find(item=>headings.includes(item[1]));
  if(!current)throw fail(`无法解析偏好章节：${headings[0]}。`,409);
  const position=matches.indexOf(current),start=current.index+current[0].length,end=matches[position+1]?.index??raw.length;
  return {start,end,text:raw.slice(start,end)};
}
function numbered(section){
  const values=[...section.text.matchAll(/^\s*(\d+)\.\s+(.+?)\s*$/gmu)].map(item=>({id:Number(item[1]),text:item[2],evidence:[...new Set(item[2].match(/Q\d+/gu)||[])]}));
  if(!values.length||values.some((item,index)=>item.id!==index+1))throw fail('偏好编号无法解析，请先修复原文。',409);
  return values;
}
export function parsePersona(raw){
  const standardsSection=markdownSection(raw,['判断一条小红书帖子好不好的标准','判断标准']);
  const antiSection=markdownSection(raw,['反例']);
  const quotesSection=markdownSection(raw,['去敏原话摘录']);
  const quotes=[...quotesSection.text.matchAll(/^\|\s*(Q\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.*?)\s*\|\s*$/gmu)].map(item=>({id:item[1],date:item[2],text:item[3]}));
  const version=raw.match(/证据版本[：:]\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
  if(!version||!quotes.length||new Set(quotes.map(item=>item.id)).size!==quotes.length)throw fail('偏好版本或引文表无法解析，请先修复原文。',409);
  return {version,standards:numbered(standardsSection),anti_patterns:numbered(antiSection),quotes};
}
function normalizedRules(value){
  if(!Array.isArray(value)||value.length>2000)throw fail('词库必须是 YAML 条目列表。',409);
  for(const item of value){
    if(!isObject(item)||typeof item.word!=='string'||!item.word||item.word.length>500||!['ban','warn'].includes(item.level)||!Array.isArray(item.platform)||!item.platform.length||item.platform.some(platform=>!['xhs','xianyu','gzh','all'].includes(platform))||item.models!==undefined&&(!Array.isArray(item.models)||item.models.some(model=>typeof model!=='string'||!model)))throw fail('词库条目结构无效，请先修复原文。',409);
    if(item.regex){try{new RegExp(item.word,'iu');}catch{throw fail('词库含无效正则，请先修复原文。',409);}}
  }
  return value;
}

/** Local file editor. Requests choose operations, never paths or Git arguments. */
export class ContentOpsEditor {
  constructor({root,runtimeRoot,candidates=[],run=editorCommand,clock=today}={}){
    Object.assign(this,{explicitRoot:root,runtimeRoot:runtimeRoot?resolve(runtimeRoot):null,candidates,run,clock});
    this.queue=Promise.resolve();this.rootPromise=null;
  }
  async git(root,args,options={}){return this.run('git',args,{cwd:root,...options});}
  async root(){
    if(this.rootPromise)return this.rootPromise;
    this.rootPromise=(async()=>{
      const candidates=this.explicitRoot?[resolve(this.explicitRoot)]:[...new Set(this.candidates.map(path=>resolve(path)))];
      for(const candidate of candidates){
        const result=await this.git(candidate,['rev-parse','--show-toplevel']).catch(()=>null);
        if(result?.code!==0)continue;
        const root=await realpath(result.stdout.trim()).catch(()=>null);
        if(!root||this.explicitRoot&&root!==await realpath(candidate).catch(()=>null))continue;
        if(SOURCE_FILES.every(path=>existsSync(join(root,path)))&&existsSync(join(root,'scripts/distill-preferences.py'))&&existsSync(join(root,'config/preference-build.json')))return root;
      }
      throw fail('未找到可编辑的 content-ops Git 仓库；请设置 CONTENT_OPS_EDITOR_ROOT。',503);
    })();
    try{return await this.rootPromise;}catch(error){this.rootPromise=null;throw error;}
  }
  python(root){return [join(root,'work/.venv/bin/python3'),join(root,'.venv/bin/python')].find(path=>existsSync(path))||'python3';}
  async file(root,path){
    const target=join(root,path),canonical=await realpath(target).catch(()=>null);
    if(!canonical||canonical!==target||!inside(root,canonical)||(await lstat(target)).isSymbolicLink()||!(await stat(target)).isFile())throw fail('编辑文件不存在或路径不是仓库内的普通文件。',503);
    const bytes=await readFile(target);if(bytes.length>MAX_BYTES)throw fail('编辑文件太大，请先在本机拆分。',413);
    return bytes.toString('utf8');
  }
  async yaml(root,text){
    const result=await this.run(this.python(root),['-c',yamlProgram],{cwd:root,input:JSON.stringify({action:'parse',text})});
    if(result.code!==0)throw fail('YAML 解析失败，请先修复原文或安装 PyYAML。',409);
    try{return normalizedRules(JSON.parse(result.stdout));}catch(error){if(error.statusCode)throw error;throw fail('YAML 结构无法解析，请先修复原文。',409);}
  }
  async persona(){
    const root=await this.root(),raw_md=await this.file(root,PERSONA),base={raw_md,revision:hash(raw_md)};
    try{return {...base,...parsePersona(raw_md)};}catch(error){return {...base,parse_error:error.message};}
  }
  async bannedWords(){
    const root=await this.root(),raw_yaml=await this.file(root,WORDS),base={raw_yaml,revision:hash(raw_yaml)};
    try{return {...base,words:await this.yaml(root,raw_yaml)};}catch(error){return {...base,parse_error:error.message};}
  }
  serialize(action){const pending=this.queue.then(action,action);this.queue=pending.catch(()=>{});return pending;}
  async lock(root){
    const gitDir=await this.git(root,['rev-parse','--absolute-git-dir']);
    if(gitDir.code!==0)throw fail('Git 元数据不可用。',503);
    const path=join(gitDir.stdout.trim(),'content-ops-editor.lock'),token=randomUUID();
    for(let attempt=0;attempt<2;attempt++){
      try{const fd=await open(path,'wx',0o600);await fd.writeFile(JSON.stringify({pid:process.pid,token}));await fd.close();return async()=>{try{if(JSON.parse(await readFile(path,'utf8')).token===token)await rm(path);}catch{}};}
      catch(error){
        if(error.code!=='EEXIST')throw fail('无法锁定编辑文件。',503);
        try{const record=JSON.parse(await readFile(path,'utf8'));if(!Number.isInteger(record.pid)||record.pid<=0)throw fail('编辑锁无效，请检查本机状态。',409);try{process.kill(record.pid,0);throw fail('另一项规则编辑正在保存，请稍后刷新。',409);}catch(check){if(check.code!=='ESRCH')throw check;}await rm(path);}
        catch(check){if(check.statusCode)throw check;throw fail('另一项规则编辑正在保存，请稍后刷新。',409);}
      }
    }
    throw fail('另一项规则编辑正在保存，请稍后刷新。',409);
  }
  async atomic(root,path,content){
    const target=join(root,path);await mkdir(dirname(target),{recursive:true});
    const canonicalParent=await realpath(dirname(target));
    if(canonicalParent!==dirname(target)||!inside(root,canonicalParent))throw fail('写入路径无效。',503);
    if(existsSync(target)&&((await lstat(target)).isSymbolicLink()||!((await stat(target)).isFile())))throw fail('写入路径不是普通文件。',503);
    const temporary=join(dirname(target),`.content-ops-${randomUUID()}.tmp`),mode=existsSync(target)?(await stat(target)).mode&0o777:0o644;
    try{await writeFile(temporary,content,{flag:'wx',mode});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
  }
  async cleanSources(root){
    const config=JSON.parse(await this.file(root,'config/preference-build.json'));
    const paths=[...new Set([...SOURCE_FILES,'config/preference-build.json','scripts/distill-preferences.py',...Object.values(config.paths||{})])];
    if(paths.some(path=>typeof path!=='string'||path.startsWith('/')||path.split(/[\\/]/u).includes('..')))throw fail('偏好构建配置路径无效。',503);
    const dirty=await this.git(root,['status','--porcelain','--untracked-files=all','--',...paths]);
    if(dirty.code!==0)throw fail('无法检查源文件的 Git 状态。',503);
    if(dirty.stdout.trim())throw fail('偏好来源有未提交的本机改动；请先提交，再通过面板保存。',409);
    const tracked=await this.git(root,['ls-files','--error-unmatch','--',...SOURCE_FILES]);
    if(tracked.code!==0)throw fail('偏好源文件尚未纳入 Git，不能自动提交。',409);
  }
  async mutate(kind,body){
    fields(body,kind==='persona'?['action','text','evidence','date','redacted','revision']:['action','word','level','platform','replace','reason','model_scope','models','revision']);
    return this.serialize(async()=>{
      const root=await this.root(),unlock=await this.lock(root);let committed=false;
      const originals=new Map(),written=new Map(),runtimeOriginals=new Map();
      const write=async(path,value)=>{if(!originals.has(path))originals.set(path,await this.file(root,path));await this.atomic(root,path,value);written.set(path,value);};
      try{
        await this.cleanSources(root);
        const source=kind==='persona'?PERSONA:WORDS,raw=await this.file(root,source);
        if(body.revision!==undefined&&body.revision!==hash(raw))throw fail('文件已被更新，请刷新面板后重新添加。',409);
        const change=kind==='persona'?await this.personaChange(root,raw,body):await this.wordsChange(root,raw,body);
        const bundleBefore=await this.file(root,BUNDLE);originals.set(BUNDLE,bundleBefore);
        await write(source,change.raw);
        if(change.feedback)await write(FEEDBACK,change.feedback);
        await mkdir(join(root,'tmp'),{recursive:true});
        const output=join(root,'tmp',`hanabi-preferences-${randomUUID()}.json`);
        try{
          const built=await this.run(this.python(root),[join(root,'scripts/distill-preferences.py'),'--root',root,'--output',output,'--date',this.clock()],{cwd:root,timeout:60000});
          if(built.code!==0)throw fail('偏好包重建失败，编辑已撤回；请检查原始规则与证据一致性。',409);
          const bundle=await readFile(output,'utf8');
          try{const value=JSON.parse(bundle);if(!value.persona||!value.platform_rules||!value.sources)throw new Error();}catch{throw fail('新偏好包结构无效，编辑已撤回。',409);}
          if(await this.file(root,BUNDLE)!==bundleBefore)throw fail('偏好包被其他程序修改，请刷新后重试。',409);
          await write(BUNDLE,bundle);
        }finally{await rm(output,{force:true});}
        // Keep the generation scripts on the same source version before reporting success.
        if(this.runtimeRoot&&this.runtimeRoot!==root){
          const runtime=await realpath(this.runtimeRoot).catch(()=>null);
          if(!runtime||runtime!==this.runtimeRoot)throw fail('生成运行目录不可用，编辑已撤回。',503);
          for(const path of [PERSONA,WORDS,BUNDLE]){
            const target=join(runtime,path);runtimeOriginals.set(path,existsSync(target)?await this.file(runtime,path):null);
            await this.atomic(runtime,path,await this.file(root,path));
          }
        }
        for(const [path,value]of written)if(await this.file(root,path)!==value)throw fail('源文件被其他程序修改，请刷新后重试。',409);
        const paths=[...written.keys()];
        const commit=await this.git(root,['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--only','-m',change.message,'--',...paths]);
        if(commit.code!==0)throw fail('Git 提交失败，编辑已撤回；请检查本机 Git 身份或锁。',503);
        committed=true;
        const head=await this.git(root,['rev-parse','--short','HEAD']);
        return {ok:true,id:change.id,commit:head.stdout.trim(),message:change.message,revision:hash(change.raw),runtime_synced:Boolean(this.runtimeRoot),...(kind==='persona'?{persona:await this.persona()}:{words:await this.bannedWords()})};
      }catch(error){
        if(!committed){
          for(const [path,value]of runtimeOriginals){try{if(value===null)await rm(join(this.runtimeRoot,path),{force:true});else await this.atomic(this.runtimeRoot,path,value);}catch{}}
          for(const [path,value]of originals){try{if(written.has(path)&&await this.file(root,path)===written.get(path))await this.atomic(root,path,value);}catch{}}
        }
        throw error;
      }finally{await unlock();}
    });
  }
  async personaChange(root,raw,body){
    if(!['add_standard','add_anti_pattern','add_quote'].includes(body.action))throw fail('偏好编辑操作无效。');
    const parsed=parsePersona(raw),text=line(body.text,'偏好内容').replace(/\|/gu,'｜');
    const section=body.action==='add_standard'?markdownSection(raw,['判断一条小红书帖子好不好的标准','判断标准']):body.action==='add_anti_pattern'?markdownSection(raw,['反例']):markdownSection(raw,['去敏原话摘录']);
    let id,addition,feedback;
    if(body.action==='add_quote'){
      if(body.redacted!==true)throw fail('新增摘录必须确认内容已去敏。');
      const entries=(await this.file(root,FEEDBACK)).split(/\r?\n/u).filter(Boolean).map(value=>{try{return JSON.parse(value);}catch{throw fail('反馈证据 JSONL 无法解析，请先修复。',409);}});
      const ids=entries.filter(item=>item?.evidence_id&&!item.post_id).map(item=>item.evidence_id);
      if(ids.length!==new Set(ids).size||ids.length!==parsed.quotes.length||parsed.quotes.some(item=>!ids.includes(item.id)))throw fail('偏好与反馈引文编号不一致，请先重建证据。',409);
      id=`Q${Math.max(...parsed.quotes.map(item=>Number(item.id.slice(1))))+1}`;
      if(!text.startsWith('「')||!text.endsWith('」'))throw fail('新增摘录须使用已去敏原话格式「…」。');
      const quoteDate=date(body.date),quote=text;
      addition=`| ${id} | ${quoteDate} | ${quote} |`;
      const entry={post_id:null,feedback:'constraint',quote,date:quoteDate,evidence_id:id,category:'Hanabi 手工补充（已去敏）'};
      feedback=(await this.file(root,FEEDBACK)).trimEnd()+'\n'+JSON.stringify(entry)+'\n';
    }else{
      if(body.date!==undefined)throw fail('判断标准和反例不接受日期字段。');
      const evidence=body.evidence??[];
      if(!Array.isArray(evidence)||evidence.length>20||evidence.some(item=>typeof item!=='string'||!/^Q\d+$/u.test(item)||!parsed.quotes.some(quote=>quote.id===item)))throw fail('请选择已存在的引文编号。');
      const values=body.action==='add_standard'?parsed.standards:parsed.anti_patterns;
      if(values.some(item=>item.text===text))throw fail('这条偏好已存在。',409);
      id=values.at(-1).id+1;
      addition=`${id}. ${text}${evidence.length?`（${[...new Set(evidence)].join('、')}）`:''}`;
    }
    const updated=raw.slice(0,section.start)+section.text.trimEnd()+'\n'+addition+'\n\n'+raw.slice(section.end);
    const content=updated.replace(/证据版本[：:]\s*\d{4}-\d{2}-\d{2}/u,`证据版本：${this.clock()}`);
    parsePersona(content);
    return {id,raw:content,feedback,message:`思敏偏好：新增 ${body.action} ${id}`};
  }
  async wordsChange(root,raw,body){
    if(!['add','remove'].includes(body.action))throw fail('风险词编辑操作无效。');
    const rules=await this.yaml(root,raw),word=line(body.word,'风险词',500),matches=rules.flatMap((rule,index)=>rule.word===word?[index]:[]);
    const blocks=[...raw.matchAll(/^-\s+word\s*:/gmu)];
    if(blocks.length!==rules.length)throw fail('词库条目格式不能安全追加或删除，请先修复原文。',409);
    if(body.action==='remove'){
      if(matches.length!==1)throw fail(matches.length?'同名词有多个范围，请先在原文件核对后编辑。':'风险词不存在，请刷新。',409);
      const index=matches[0],content=raw.slice(0,blocks[index].index)+raw.slice(blocks[index+1]?.index??raw.length);
      await this.yaml(root,content);
      return {id:word,raw:content,message:`风险词：删除 ${word}`};
    }
    if(matches.length)throw fail('风险词已存在，请先核对已有范围。',409);
    const level=body.level;
    if(!['ban','warn'].includes(level)||!Array.isArray(body.platform)||!body.platform.length||body.platform.length>3||body.platform.some(platform=>!['xhs','xianyu','gzh'].includes(platform)))throw fail('请选择风险级别和适用平台。');
    const replacement=line(body.replace,'替换词',500,true),reason=line(body.reason,'原因',2000),scope=body.models??body.model_scope??[];
    const models=typeof scope==='string'?scope.split(/[,，、]/u).map(value=>value.trim()).filter(Boolean):scope;
    if(!Array.isArray(models)||models.length>10||models.some(model=>typeof model!=='string'||!model.trim()||model.length>80||/[\r\n\x00-\x1f\x7f]/u.test(model)))throw fail('模型范围须为不超过10个模型名。');
    const entry={word,level,platform:[...new Set(body.platform)],replace:replacement,reason,added_at:this.clock(),...(models.length?{models:[...new Set(models)]}:{})};
    const dump=await this.run(this.python(root),['-c',yamlProgram],{cwd:root,input:JSON.stringify({action:'dump',entry:[entry]})});
    if(dump.code!==0)throw fail('无法生成风险词 YAML，编辑未保存。',503);
    const content=raw.trimEnd()+'\n\n'+dump.stdout.trimEnd()+'\n';await this.yaml(root,content);
    return {id:word,raw:content,message:`风险词：新增 ${word}`};
  }
}
