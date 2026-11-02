import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {readFile,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const parse=(value,fallback={})=>{try{return JSON.parse(value);}catch{return fallback;}};
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const databaseFailure=error=>error?.errcode===5||error?.errcode===6?fail('数据库正忙，请稍后重试。',503):error;
const timestamp=()=>new Date().toISOString();
const sameReferences=(left=[],right=[])=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((ref,index)=>ref?.platform===right[index]?.platform&&typeof ref?.id==='string'&&typeof right[index]?.id==='string'&&ref.id.toLowerCase()===right[index].id.toLowerCase());
export function validateContentOpsInput(body){
  if(typeof body.model!=='string'||!body.model.trim()||body.model.trim().length>80||/[\x00-\x1f\x7f]/u.test(body.model))throw fail('模型名须为 1–80 个字符，不能含换行。');
  if(body.platform!=='xhs'||!Number.isInteger(body.count)||body.count<1||body.count>10)throw fail('请选择小红书，数量为 1–10。');
  if(!['cached','fresh'].includes(body.backgroundMode))throw fail('请选择复用背景或生成新背景。');
  if(typeof body.requestId!=='string'||! /^[\w-]{8,100}$/u.test(body.requestId))throw fail('请求标识无效。');
  const rawReferences=body.references??[];
  if(!Array.isArray(rawReferences)||rawReferences.length>8||rawReferences.some(ref=>!ref||!['xhs','xianyu'].includes(ref.platform)||typeof ref.id!=='string'||!/^[0-9a-f]{1,64}$/iu.test(ref.id)))throw fail('参考帖无效；最多选择 8 条不同的本地帖子。');
  const references=rawReferences.map(({platform,id})=>({platform,id:id.toLowerCase()}));
  if(new Set(references.map(ref=>`${ref.platform}:${ref.id}`)).size!==references.length)throw fail('参考帖无效；最多选择 8 条不同的本地帖子。');
  return {model:body.model.trim(),platform:'xhs',count:body.count,backgroundMode:body.backgroundMode,requestId:body.requestId,references};
}

// Script tasks use the application's existing jobs and attachments. They never
// enter the generic model worker or create a second library/preview inventory.
export class ContentOpsProduction {
  constructor({db,root,uploadDir,chats,spawnProcess=spawn}){
    Object.assign(this,{db,root:resolve(root),uploadDir,chats,spawnProcess});this.active=null;
    db.exec(`CREATE TABLE IF NOT EXISTS content_ops_batches(
      id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,chat_id TEXT NOT NULL,
      model TEXT NOT NULL,platform TEXT NOT NULL,count INTEGER NOT NULL,background_mode TEXT NOT NULL,
      reference_ids TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL,job_ids TEXT NOT NULL,output_dir TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    if(!db.prepare('PRAGMA table_info(content_ops_batches)').all().some(column=>column.name==='reference_ids'))db.exec("ALTER TABLE content_ops_batches ADD COLUMN reference_ids TEXT NOT NULL DEFAULT '[]'");
  }
  async config(){
    const env=await readFile(join(this.root,'work/gateway.env'),'utf8').catch(()=>'');
    const setting=name=>process.env[name]||env.split(/\r?\n/u).find(line=>line.trim().startsWith(name+'='))?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/gu,'')||'';
    const preferences=parse(await readFile(join(this.root,'data/distilled-preferences.json'),'utf8').catch(()=>''),null);
    const textList=value=>Array.isArray(value)&&value.length>0&&value.every(item=>typeof item==='string'&&item.trim());
    const distilledAt=preferences?.distilled_at;
    const validDate=typeof distilledAt==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(distilledAt)&&!Number.isNaN(Date.parse(`${distilledAt}T00:00:00Z`))
      &&new Date(`${distilledAt}T00:00:00Z`).toISOString().slice(0,10)===distilledAt;
    const preferencesReady=Boolean(preferences&&Number.isInteger(preferences.version)&&preferences.version>0
      &&validDate&&textList(preferences.persona?.standards)&&textList(preferences.persona?.anti_patterns)
      &&textList(preferences.platform_rules?.xhs?.banned)&&textList(preferences.platform_rules?.xhs?.allowed_price_words)
      &&textList(preferences.title_patterns?.openers)&&Array.isArray(preferences.title_patterns?.structures)&&preferences.title_patterns.structures.length>0
      &&preferences.title_patterns.structures.every(item=>typeof item==='string'?item.trim():typeof item?.template==='string'&&item.template.trim())
      &&textList(preferences.design?.hierarchy_rules)&&Array.isArray(preferences.design?.cover_palettes)&&preferences.design.cover_palettes.length>0
      &&preferences.design.cover_palettes.every(palette=>palette&&['id','background','card','text','accent'].every(key=>typeof palette[key]==='string'&&palette[key].trim())));
    return {available:existsSync(join(this.root,'scripts/gen-xhs-post.py')),configured:Boolean(setting('CONTENT_OPS_API_KEY')&&setting('CONTENT_OPS_BASE_URL')),
      cachedAvailable:existsSync(this.backgroundPath()),textModel:setting('CONTENT_OPS_TEXT_MODEL')||'claude-sonnet-4-6',imageModel:setting('CONTENT_OPS_IMAGE_MODEL')||'qwen-image-3.0',
      preferencesReady,preferencesVersion:preferencesReady?{version:preferences.version,distilledAt:preferences.distilled_at}:null};
  }
  backgroundPath(){return join(this.root,'data/images/backgrounds/company-qwen-2026-11-01.png');}
  get(id){const row=this.db.prepare('SELECT * FROM content_ops_batches WHERE id=?').get(id);if(!row)throw fail('生成批次不存在。',404);return row;}
  public(row){
    const jobs=parse(row.job_ids,[]).map(id=>this.db.prepare('SELECT * FROM analysis_jobs WHERE id=?').get(id)).filter(Boolean);
    const manifest=parse((()=>{try{return readFileSync(join(row.output_dir,'manifest.json'),'utf8');}catch{return '';}})());
    const references=Array.isArray(manifest.references)?manifest.references.filter(ref=>['xhs','xianyu'].includes(ref?.platform)&&typeof ref.id==='string'&&/^[0-9a-f]{1,64}$/iu.test(ref.id)&&typeof ref.title==='string').map(({platform,id,title})=>({platform,id,title})):[];
    return {id:row.id,chatId:row.chat_id,model:row.model,platform:row.platform,count:row.count,backgroundMode:row.background_mode,status:row.status,error:row.error,createdAt:row.created_at,
      references,
      posts:jobs.map((job,index)=>({index:index+1,jobId:job.id,status:job.status,text:job.result||'',error:job.error||'',progressMessage:job.progress_message,
        image:(parse(job.source_read).outputAttachments||[]).find(file=>file.mimeType==='image/png')?.url||null}))};
  }
  list(){return this.db.prepare('SELECT * FROM content_ops_batches ORDER BY created_at DESC LIMIT 30').all().map(row=>this.public(row));}
  async create(body){
    const input=validateContentOpsInput(body),prior=this.db.prepare('SELECT * FROM content_ops_batches WHERE request_id=?').get(input.requestId);
    if(prior){if(prior.model!==input.model||prior.count!==input.count||prior.background_mode!==input.backgroundMode||!sameReferences(parse(prior.reference_ids,[]),input.references))throw fail('同一请求标识的内容已改变，请另起一批。',409);return {batch:this.public(prior),reused:true};}
    const running=this.db.prepare("SELECT * FROM content_ops_batches WHERE status='running'").get();
    if(running){if(running.model===input.model&&running.count===input.count&&running.background_mode===input.backgroundMode&&sameReferences(parse(running.reference_ids,[]),input.references))return {batch:this.public(running),reused:true};throw fail('已有一批图文正在生成，请完成或停止后再开始。',409);}
    const config=await this.config();
    if(!config.available||!config.configured)throw fail('本机 content-ops 脚本或公司网关尚未配置。',503);
    if(!/claude/iu.test(config.textModel))throw fail('文案执行模型必须为公司 Claude。');
    if(input.backgroundMode==='cached'&&!config.cachedAvailable)throw fail('本机缓存背景不存在，请恢复背景文件或选择生成新背景。',409);
    // Check again after asynchronous configuration reads to close double clicks.
    const racing=this.db.prepare("SELECT * FROM content_ops_batches WHERE status='running'").get();
    if(racing){if(racing.model!==input.model||racing.count!==input.count||racing.background_mode!==input.backgroundMode||!sameReferences(parse(racing.reference_ids,[]),input.references))throw fail('另一批图文已开始，请完成或停止后继续。',409);return {batch:this.public(racing),reused:true};}
    let chat;try{chat=this.chats.create();}catch(error){throw databaseFailure(error);}
    const id=randomUUID(),time=timestamp(),jobIds=[],userId=randomUUID(),assistantId=randomUUID();
    const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
    const outputDir=join(this.root,'outputs',date,'hanabi',id);
    const brief=`生成 ${input.count} 篇 ${input.model} 小红书图文；${input.backgroundMode==='cached'?'复用已有公司背景并重新配色排版':'公司 Qwen 生成新背景'}。`;
    this.db.exec('BEGIN IMMEDIATE');try{
      this.db.prepare('UPDATE hanabi_chats SET title=? WHERE id=?').run(`${input.model} · 小红书 ${input.count} 篇`,chat.id);
      this.db.prepare("INSERT INTO hanabi_messages(id,chat_id,client_id,role,content,status,created_at) VALUES(?,?,?,'user',?,'done',?)").run(userId,chat.id,input.requestId,brief,time);
      for(let index=1;index<=input.count;index++){
        const jobId=randomUUID(),itemId=randomUUID();jobIds.push(jobId);
        const metadata={conversation:{chatId:chat.id,userMessageId:userId,messageId:assistantId,requestKey:input.requestId},previewPlatform:'xiaohongshu',productionOperation:'create',contentOps:{batchId:id,index,productModel:input.model,backgroundMode:input.backgroundMode,textModel:config.textModel,imageModel:config.imageModel},outputAttachments:[]};
        this.db.prepare("INSERT INTO items(id,title,type,content,source_name,archive_space,created_by_job_id,created_at,updated_at) VALUES(?,?,'text',?,'小红书生成上下文','conversation',?,?,?)").run(itemId,`${input.model} · 第 ${index} 篇`,brief,jobId,time,time);
        this.db.prepare("INSERT INTO analysis_jobs(id,item_id,mode,job_title,reference_item_ids,production_prompt,status,brief,destinations,result,progress,progress_message,source_read,analysis_model,created_at,updated_at) VALUES(?,?,'produce',?,? ,?,'analyzing',?,'[\"archive\"]','',1,'Claude 正在写稿和终审',?,?,?,?)").run(jobId,itemId,`${input.model} · 第 ${index} 篇`,JSON.stringify([itemId]),brief,brief,JSON.stringify(metadata),`content-ops::${config.textModel}`,time,time);
      }
      const artifact={id,kind:'produce',destination:'preview',title:`${input.model} 小红书图文`,jobIds};
      this.db.prepare("INSERT INTO hanabi_messages(id,chat_id,role,content,model,status,artifacts,created_at) VALUES(?,?,'assistant',?,?,'done',?,?)").run(assistantId,chat.id,'图文已开始生成；完成后会逐篇保存到燃放预览。',`content-ops::${config.textModel}`,JSON.stringify([artifact]),time);
      this.db.prepare('INSERT INTO content_ops_batches(id,request_id,chat_id,model,platform,count,background_mode,reference_ids,status,job_ids,output_dir,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,\'running\',?,?,?,?)').run(id,input.requestId,chat.id,input.model,input.platform,input.count,input.backgroundMode,JSON.stringify(input.references),JSON.stringify(jobIds),outputDir,time,time);
      this.db.exec('COMMIT');
    }catch(error){try{this.db.exec('ROLLBACK');}catch{}throw databaseFailure(error);}
    this.run(id);return {batch:this.public(this.get(id)),reused:false};
  }
  referencePath(id){return join(this.root,'tmp',`hanabi-references-${id}.json`);}
  async run(id){
    const row=this.get(id),python=existsSync(join(this.root,'.venv/bin/python'))?join(this.root,'.venv/bin/python'):'python3';
    const args=[join(this.root,'scripts/gen-xhs-post.py'),'--model',row.model,'--platform',row.platform,'--count',String(row.count),'--output',row.output_dir];
    const references=parse(row.reference_ids,[]),referenceFile=this.referencePath(id);
    let prepared;
    const current={id,child:null,stopped:false,stopMessage:'',stderr:'',stdout:'',settled:false,timer:null,completion:null,ready:new Promise(resolve=>{prepared=resolve;})};this.active=current;
    const done=(code,message='')=>{
      if(current.settled)return current.completion;
      current.settled=true;clearTimeout(current.timer);if(this.active===current)this.active=null;
      current.completion=this.finish(id,code,message||current.stderr).catch(error=>{this.db.prepare("UPDATE content_ops_batches SET status='failed',error=?,updated_at=? WHERE id=?").run('导入结果失败：'+error.message,timestamp(),id);this.db.prepare("UPDATE analysis_jobs SET status='failed',error=?,updated_at=? WHERE id IN (SELECT value FROM json_each(?)) AND status='analyzing'").run('导入结果失败，已保存的文件仍在本机。',timestamp(),row.job_ids);}).finally(()=>rm(referenceFile,{force:true}));
      return current.completion;
    };
    current.finish=done;
    try{
      if(references.length){await mkdir(join(this.root,'tmp'),{recursive:true});await writeFile(referenceFile,JSON.stringify(references),'utf8');args.push('--references',referenceFile);}
      if(current.stopped){prepared();await done(1,current.stopMessage);return;}
      if(row.background_mode==='cached')args.push('--background',this.backgroundPath());
      const child=this.spawnProcess(python,args,{cwd:this.root,env:process.env,stdio:['ignore','pipe','pipe'],shell:false});current.child=child;
      current.timer=setTimeout(()=>{current.stopped=true;current.stopMessage='生成超时，已停止；已有结果保留，不自动重试。';child.kill('SIGTERM');},45*60*1000);current.timer.unref?.();
      child.stderr.on('data',buffer=>{current.stderr=(current.stderr+buffer.toString()).slice(-4000);});
      child.stdout.on('data',buffer=>{current.stdout=(current.stdout+buffer.toString()).slice(-10000);this.db.prepare("UPDATE analysis_jobs SET progress=30,progress_message='文案已保存，正在完成图片',updated_at=? WHERE id IN (SELECT value FROM json_each(?)) AND status='analyzing'").run(timestamp(),row.job_ids);});
      child.once('error',error=>{void done(1,error.message);});child.once('close',code=>{void done(code??1,current.stopped?current.stopMessage:'');});
      prepared();
    }catch(error){prepared();await done(1,error.message);}
  }
  async finish(id,code,error=''){
    let row;try{row=this.get(id);}catch{return;}
    const manifest=parse(await readFile(join(row.output_dir,'manifest.json'),'utf8').catch(()=>''));
    const jobIds=parse(row.job_ids,[]);let completed=0;
    await mkdir(this.uploadDir,{recursive:true});
    for(let index=1;index<=jobIds.length;index++){
      const job=this.db.prepare('SELECT * FROM analysis_jobs WHERE id=?').get(jobIds[index-1]);if(!job)continue;
      if(job.status==='completed'){completed++;continue;}
      const post=(manifest.posts||[]).find(post=>post.index===index),metadata=parse(job.source_read),text=await readFile(join(row.output_dir,`post-${index}.md`),'utf8').catch(()=>'');
      let attachment=null;
      if(post?.status==='completed'&&post.image===`post-${index}.png`){
        const path=join(row.output_dir,post.image),bytes=await readFile(path);
        if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||createHash('sha256').update(bytes).digest('hex')!==post.image_metadata?.sha256)throw fail('生成图片校验失败。');
        const attachmentId=randomUUID();await copyFile(path,join(this.uploadDir,attachmentId+'.png'));
        attachment={id:attachmentId,name:`${row.model}-post-${index}.png`,mimeType:'image/png',size:bytes.length,url:`/api/uploads/${attachmentId}`};
      }
      metadata.outputAttachments=attachment?[attachment]:[];metadata.contentOps={...metadata.contentOps,actualTextModel:manifest.text_model||'',backgroundGeneration:post?.background_generation?.mode||row.background_mode,ruleHashes:manifest.rules||{}};
      const ok=Boolean(text&&attachment),message=ok?'图文已保存到燃放预览':error||manifest.error||'缺少完整文案或图片；请检查公司网关额度。';if(ok)completed++;
      this.db.prepare('UPDATE analysis_jobs SET status=?,result=?,progress=?,progress_message=?,source_read=?,error=?,updated_at=? WHERE id=?').run(ok?'completed':'failed',text,ok?100:0,ok?message:'生成未完成，已保留部分结果',JSON.stringify(metadata),ok?'':message.slice(0,1800),timestamp(),job.id);
      this.db.prepare('UPDATE items SET attachments=?,updated_at=? WHERE id=?').run(JSON.stringify(metadata.outputAttachments),timestamp(),job.item_id);
    }
    const status=completed===row.count?'completed':completed?'partial':'failed',message=status==='completed'?`已完成 ${completed} 篇图文，已保存到燃放预览。${row.background_mode==='cached'?' 本次复用已有背景，文案重新生成。':''}`:`已完成 ${completed}/${row.count} 篇；${error||manifest.error||'生成未完成'} 已有结果已保留，不自动重试。`;
    this.db.prepare('UPDATE content_ops_batches SET status=?,error=?,updated_at=? WHERE id=?').run(status,status==='completed'?'':message.slice(0,1800),timestamp(),id);
    this.db.prepare("UPDATE hanabi_messages SET content=? WHERE chat_id=? AND role='assistant' AND json_extract(artifacts,'$[0].id')=?").run(message,row.chat_id,id);
    this.chats.publish?.(row.chat_id,{type:'snapshot'});
  }
  async recover(){for(const row of this.db.prepare('SELECT * FROM content_ops_batches').all()){try{if(row.status==='running')await this.finish(row.id,1,'服务已重启，收费任务不会自动重跑。');}finally{await rm(this.referencePath(row.id),{force:true});}}}
  cleanup(){this.db.exec("DELETE FROM content_ops_batches WHERE NOT EXISTS(SELECT 1 FROM analysis_jobs WHERE id IN (SELECT value FROM json_each(content_ops_batches.job_ids)))");}
  async shutdown(){if(!this.active)return;const current=this.active;current.stopped=true;current.stopMessage='服务已停止；已有文件保留，不自动重跑。';current.child?.kill('SIGTERM');await current.ready;await current.finish(1,current.stopMessage);}
  stop(id){const row=this.get(id);if(row.status!=='running')return this.public(row);if(this.active?.id===id){this.active.stopped=true;this.active.stopMessage='用户已停止；已完成文件保留。';this.active.child?.kill('SIGTERM');}return this.public(row);}
  stopJobs(predicate){if(!this.active)return false;const row=this.get(this.active.id);const found=parse(row.job_ids,[]).some(jobId=>{const job=this.db.prepare('SELECT item_id FROM analysis_jobs WHERE id=?').get(jobId);return predicate({jobId,itemId:job?.item_id});});if(found){this.stop(row.id);return true;}return false;}
}
