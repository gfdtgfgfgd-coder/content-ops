import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGatewaySettings } from './content-ops-connections.mjs';

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const parse=value=>{try{return JSON.parse(value);}catch{return {};}};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const VERSION=1;

export class ContentOpsPrompts {
  constructor({db,root,references,production,spawnProcess=spawn,timeout=210000}) {
    Object.assign(this,{db,root,references,production,spawnProcess,timeout});this.children=new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS content_ops_prompt_runs (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
      image_sha256 TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    ); CREATE UNIQUE INDEX IF NOT EXISTS prompt_active_fingerprint ON content_ops_prompt_runs(fingerprint) WHERE status IN ('running','ready');`);
  }
  public(row){return row?{id:row.id,status:row.status,model:row.model,imageSha256:row.image_sha256,result:parse(row.result),error:row.error,createdAt:row.created_at}:null;}
  get(id){const row=this.db.prepare('SELECT * FROM content_ops_prompt_runs WHERE id=?').get(id);if(!row)throw fail('反推记录不存在。',404);return row;}
  async image(target){
    const {platform,id,filename}=target;
    const post=(await this.references.records()).find(p=>p.platform===platform&&String(p.id)===id);
    if(!post||!Array.isArray(post.images)||!post.images.includes(`data/images/${platform}/${id}/${filename}`))throw fail('这张图片已移除或不属于当前素材。',404);
    const image=await this.references.image(target),bytes=await readFile(image.path);
    if(bytes.length>15*1024*1024)throw fail('图片最多15MB。',413);
    const settings=await loadGatewaySettings(this.root),digest=sha(bytes),model=settings.CONTENT_OPS_VISION_MODEL;
    return {bytes,digest,model,fingerprint:sha(JSON.stringify([VERSION,digest,model,settings.CONTENT_OPS_BASE_URL||'']))};
  }
  async inspect(target){const image=await this.image(target);const row=this.db.prepare('SELECT * FROM content_ops_prompt_runs WHERE fingerprint=? ORDER BY rowid DESC LIMIT 1').get(image.fingerprint);return {imageSha256:image.digest,model:image.model,run:this.public(row)};}
  async create(target,body){
    if(!body||typeof body.requestId!=='string'||! /^[\w-]{8,100}$/u.test(body.requestId))throw fail('反推请求标识无效。');
    const image=await this.image(target);
    if(body.imageSha256!==image.digest)throw fail('图片已更新，请关闭面板后重新打开。',409);
    const prior=this.db.prepare('SELECT * FROM content_ops_prompt_runs WHERE request_id=?').get(body.requestId);
    if(prior){if(prior.fingerprint!==image.fingerprint)throw fail('同一请求对应的图片或模型已改变。',409);return this.public(prior);}
    const cached=this.db.prepare("SELECT * FROM content_ops_prompt_runs WHERE fingerprint=? AND status IN ('running','ready')").get(image.fingerprint);
    if(cached)return this.public(cached);
    if(this.children.size>=2)throw fail('已有两张图片正在反推，请稍后再试。',409);
    const id=randomUUID();
    this.db.prepare("INSERT INTO content_ops_prompt_runs(id,request_id,fingerprint,image_sha256,model,status,created_at) VALUES(?,?,?,?,?,'running',?)").run(id,body.requestId,image.fingerprint,image.digest,image.model,new Date().toISOString());
    void this.run(id,image);return this.public(this.get(id));
  }
  async run(id,image){
    const dir=join(this.root,'scratch/hanabi-runtime/prompts',id),output=join(dir,'result.json');this.children.set(id,null);
    try{
      await mkdir(dir,{recursive:true,mode:0o700});const source=join(dir,'source');await writeFile(source,image.bytes,{flag:'wx',mode:0o600});
      const input=join(dir,'request.json');await writeFile(input,JSON.stringify({image_path:source,image_sha256:image.digest,vision_model:image.model}),{mode:0o600,flag:'wx'});
      const python=[join(this.root,'scratch/.venv/bin/python'),join(this.root,'.venv/bin/python')].find(p=>existsSync(p))||'python3';
      const args=[join(this.root,'scripts/generate.py'),'reverse','--input',input,'--output',output,'--config',join(this.root,'scratch/gateway.env')];
      await new Promise((resolve,reject)=>{
        const child=this.spawnProcess(python,args,{cwd:this.root,env:process.env,stdio:['ignore','ignore','ignore'],shell:false});this.children.set(id,child);
        const timer=setTimeout(()=>{child.kill('SIGTERM');reject(fail('反推超时，可手动重试，不会自动重复调用。'));},this.timeout);
        child.once('error',()=>{clearTimeout(timer);reject(fail('反推程序启动失败，请检查Python环境。'));});
        child.once('close',code=>{clearTimeout(timer);resolve(code);});
      });
      if(this.get(id).status!=='running')return;
      const result=JSON.parse(await readFile(output,'utf8'));
      if(result.error)throw fail(String(result.error).slice(0,1500));
      if(typeof result.prompt!=='string'||!result.prompt.trim()||result.prompt.length>16000||result.imageSha256!==image.digest)throw fail('反推结果不完整，请重试。');
      this.db.prepare("UPDATE content_ops_prompt_runs SET status='ready',result=? WHERE id=? AND status='running'").run(JSON.stringify(result),id);
    }catch(error){this.db.prepare("UPDATE content_ops_prompt_runs SET status='failed',error=? WHERE id=? AND status='running'").run(error.code==='ENOENT'?'反推程序未返回结果，请检查Python环境。':String(error.message||'反推失败').slice(0,1500),id);}
    finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});this.children.delete(id);}
  }
  async generation(batchId,jobId){
    const row=this.production.get(batchId),post=this.production.public(row).posts.find(p=>p.jobId===jobId);
    if(!post)throw fail('该批次没有这张封面。',404);
    const manifest=parse(await readFile(join(row.output_dir,'manifest.json'),'utf8').catch(()=>'{}'));
    const saved=manifest.posts?.find(p=>Number(p.index)===post.index)||manifest.posts?.[post.index-1]||{};
    const generation=saved.image_generation||{};
    const raw=await readFile(join(row.output_dir,`vision-prompt-${post.index}.txt`),'utf8').catch(()=>'');
    const requests=Array.isArray(saved.image_requests)?saved.image_requests:typeof generation.prompt==='string'?[{prompt:generation.prompt,model:generation.model||manifest.image_model,mode:generation.mode,size:generation.requested_size,status:'completed'}]:[];
    return {visionPrompt:saved.visual_plan?.visual_prompt||saved.visual_prompt||parse(raw).visual_prompt||'',visionRaw:raw,visionModel:saved.visual_prompt_model||manifest.vision_model||'',
      requests:requests.map(r=>({prompt:typeof r.prompt==='string'?r.prompt:'',model:r.model||'',mode:r.mode||'',size:r.size||'',status:r.status||'',createdAt:r.created_at||''})),
      coverTexts:saved.visual_plan?.cover_texts||saved.cover_texts||[],modified:Boolean(post.imageRevisionId&&post.imageRevisionId!=='original'),
      mode:generation.mode||requests.at(-1)?.mode||'',index:post.index};
  }
  recover(){this.db.prepare("UPDATE content_ops_prompt_runs SET status='failed',error='服务已重启，反推未完成；可手动重试。' WHERE status='running'").run();}
  shutdown(){for(const child of this.children.values())child?.kill('SIGTERM');}
}
