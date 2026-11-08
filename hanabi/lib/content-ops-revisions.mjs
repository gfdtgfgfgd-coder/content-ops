// Original batches and exported files remain immutable. Revisions and current pointers live in SQLite.
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readFile, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const idPattern = /^[\w-]{8,100}$/u;
const validText = (value, max) => typeof value === 'string' && value.trim() && [...value].length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coverFontCatalog = () => parse(readFileSync(join(PACKAGE_ROOT, 'config/cover-fonts.json'), 'utf8'), { default: 'source_han_sans', fonts: [] });
const defaultTypography = () => ({ scale: 1.2, align: 'center', font: coverFontCatalog().default || 'source_han_sans' });
const defaultColorGrade = () => ({ brightness: 100, contrast: 100, saturation: 100, warmth: 100 });
const normalizeTypography = value => {
  const catalog = coverFontCatalog();
  const ids = new Set((catalog.fonts || []).map(font => font.id));
  const typography = value ?? defaultTypography();
  const font = typography?.font ?? catalog.default;
  if (!typography || typeof typography !== 'object' || !Number.isFinite(typography.scale) || typography.scale < .6 || typography.scale > 1.5 || !['center', 'left'].includes(typography.align) || !ids.has(font)) {
    throw fail('字号比例须为60%～150%，对齐方式须为居中或左对齐，字体须为可用封面字体。');
  }
  return { scale: typography.scale, align: typography.align, font };
};
const normalizeColorGrade = value => {
  const grade = value ?? defaultColorGrade();
  const bounds = { brightness: [50, 150], contrast: [50, 150], saturation: [0, 200], warmth: [50, 150] };
  if (!grade || typeof grade !== 'object') throw fail('背景调色参数无效。');
  const normalized = {};
  for (const [key, [low, high]] of Object.entries(bounds)) {
    const raw = grade[key] ?? 100;
    if (!Number.isFinite(raw) || raw < low || raw > high) throw fail(`背景${key}须为${low}～${high}。`);
    normalized[key] = raw;
  }
  return normalized;
};
const normalizeCoverTexts = texts => {
  if (!Array.isArray(texts) || texts.length < 3 || texts.length > 4) throw fail('请填写3～4行封面文字及文字/高亮颜色。');
  return texts.map(text => {
    if (!text || !['hook', 'benefit', 'model', 'payoff'].includes(text.role) || !validText(text.text, 80)) throw fail('封面文字须为3～4行有效短句。');
    const scale = text.scale ?? 1;
    if (!Number.isFinite(scale) || scale < .6 || scale > 1.5) throw fail('每行字号比例须为60%～150%。');
    return { ...text, scale };
  });
};

export class ContentOpsRevisions {
  constructor({ db, production, root, uploadDir, spawnProcess = spawn, timeout = 330000 }) {
    Object.assign(this, { db, production, root: resolve(root), uploadDir: resolve(uploadDir), spawnProcess, timeout });
    this.children = new Map();this.previewChildren=new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS content_ops_revisions (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, signature TEXT NOT NULL,
      batch_id TEXT NOT NULL, job_id TEXT NOT NULL, kind TEXT NOT NULL, copy_index INTEGER NOT NULL,
      base_revision TEXT NOT NULL, action TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS revisions_target ON content_ops_revisions(job_id,kind,copy_index);
    CREATE UNIQUE INDEX IF NOT EXISTS revisions_running_target ON content_ops_revisions(job_id,kind,copy_index) WHERE status='running';
    CREATE TABLE IF NOT EXISTS content_ops_revision_heads (
      job_id TEXT NOT NULL, kind TEXT NOT NULL, copy_index INTEGER NOT NULL, revision_id TEXT NOT NULL,
      PRIMARY KEY(job_id,kind,copy_index)
    );`);
    production.revisions = this;
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM content_ops_revisions WHERE id=?').get(id);
    if (!row) throw fail('修改版本不存在。', 404);
    return row;
  }
  public(row) {
    return { id: row.id, kind: row.kind, copyIndex: row.copy_index, baseRevision: row.base_revision,
      action: row.action, instructions: row.instructions, status: row.status,
      result: parse(row.result), error: row.error, createdAt: row.created_at };
  }
  head(jobId, kind, copyIndex) {
    return this.db.prepare('SELECT revision_id FROM content_ops_revision_heads WHERE job_id=? AND kind=? AND copy_index=?').get(jobId, kind, copyIndex)?.revision_id || 'original';
  }
  target(batchId, jobId, kind, copyIndex) {
    if (!['copy', 'image'].includes(kind) || !Number.isInteger(copyIndex) || copyIndex < 0 || copyIndex > 5 || kind === 'image' && copyIndex !== 0 || kind === 'copy' && copyIndex < 1) throw fail('修改目标无效。');
    const row = this.production.get(batchId);
    const original = this.production.original(row), post = original.posts.find(item => item.jobId === jobId);
    if (!post) throw fail('该批次没有这篇图文。', 404);
    const value = kind === 'copy' ? post.copies.find(copy => copy.index === copyIndex)?.text : post.image;
    if (!value && kind==='copy') throw fail('这篇文案尚未生成。');
    const revisionId = this.head(jobId, kind, copyIndex);
    const result = revisionId === 'original' ? kind === 'copy' ? { text: value } : { image: value } : parse(this.get(revisionId).result);
    return { row, post, kind, copyIndex, revisionId, result, original: kind === 'copy' ? { text: value } : { image: value } };
  }
  history(batchId, jobId, kind, copyIndex) {
    const target = this.target(batchId, jobId, kind, copyIndex);
    const versions = this.db.prepare('SELECT * FROM content_ops_revisions WHERE job_id=? AND kind=? AND copy_index=? ORDER BY rowid DESC').all(jobId, kind, copyIndex).map(row => this.public(row));
    return { currentRevision: target.revisionId, current: kind==='image'?this.imageContext(target,target.result):target.result,
      original:kind==='image'?this.imageContext(target,target.original):target.original, versions };
  }
  imageContext(target,source){
    let manifest={};try{manifest=parse(readFileSync(join(target.row.output_dir,'manifest.json'),'utf8'));}catch{}
    const saved=manifest.posts?.find(item=>Number(item.index)===target.post.index)||manifest.posts?.[target.post.index-1]||{};
    let audit={};
    const filename=/^\/api\/uploads\/([0-9a-f-]+)\.png$/iu.exec(source.image||'')?.[1];
    let sourceHash='';try{sourceHash=createHash('sha256').update(readFileSync(join(this.uploadDir,filename+'.png'))).digest('hex');}catch{}
    if(filename&&source.image!==target.original.image&&!source.rendered_text){
      let dates=[];try{dates=readdirSync(join(this.root,'outputs')).filter(name=>/^\d{4}-\d{2}-\d{2}$/u.test(name));}catch{}
      for(const date of dates){try{const item=parse(readFileSync(join(this.root,'outputs',date,'hanabi',filename,'manifest.json'),'utf8'));if(item.source_image===source.image&&item.render?.sha256===sourceHash){audit=item;break;}}catch{}}
    }
    const plan=audit.render_input?.plan||saved.visual_plan||{};
    const request=audit.render_input?{prompt:audit.render_input.prompt,mode:'layered_poster'}:saved.image_requests?.at(-1)||saved.image_generation||{};
    const own=source.renderMode&&['layered_poster','direct_poster'].includes(source.renderMode)&&typeof source.prompt==='string';
    let recipe={};try{recipe=parse(readFileSync(join(this.root,'config/bold-typo-backgrounds.json'),'utf8'));}catch{}
    const style=plan.background_style||{},profile=recipe.profiles?.find(p=>p.id===(style.profile||recipe.default))||{};
    const backgroundStyle={profile:profile.id,base:profile.base,ink:profile.ink,accent:profile.accent,highlight_roles:profile.highlight_roles,...style};
    return {...source,prompt:own?source.prompt:request.prompt||'',renderMode:own?source.renderMode:request.mode==='layered_poster'||plan.collection_name==='大字报'?'layered_poster':'direct_poster',
      coverTexts:own?source.coverTexts||[]:plan.cover_texts||saved.cover_texts||[],
      backgroundStyle:own?source.backgroundStyle||{}:backgroundStyle,
      typography:own?{...defaultTypography(),...(source.typography||{})}:{scale:1,align:'center',font:coverFontCatalog().default||'source_han_sans'},
      colorGrade:own?{...defaultColorGrade(),...(source.colorGrade||{})}:defaultColorGrade(),
      sourceRows:source.sha256===sourceHash&&source.rendered_text?.length?source.rendered_text:audit.render?.rendered_text||
        (source.image===target.original.image&&saved.image_generation?.sha256===sourceHash?saved.image_generation.rendered_text||[]:[]),
      promptOrigin:own||audit.render_input?'revision':source.image!==target.original.image?'original_fallback':'original'};
  }
  decorate(batch) {
    for (const post of batch.posts) {
      post.copies = post.copies.map(copy => {
        const revisionId = this.head(post.jobId, 'copy', copy.index);
        return { ...copy, ...(revisionId === 'original' ? {} : parse(this.get(revisionId).result)), revisionId };
      });
      post.text = post.copies[0]?.text || post.text;
      post.imageRevisionId = this.head(post.jobId, 'image', 0);
      if (post.imageRevisionId !== 'original') post.image = parse(this.get(post.imageRevisionId).result).image;
      if(post.imageRevisionId!=='original'&&post.image&&batch.status!=='running'){post.status='completed';post.error='';}
    }
    if(batch.status!=='running'&&batch.posts.some(post=>post.imageRevisionId!=='original')&&batch.posts.every(post=>post.image&&post.text)){
      batch.status='completed';batch.error='';batch.resumable=false;
    }
    return batch;
  }
  checkBase(target, body) {
    if (body.baseRevision !== target.revisionId) throw fail('内容已在其他窗口更新，请重新打开编辑器后再修改。', 409);
    if (target.row.status === 'running') throw fail('请等待这一批生成结束后再修改。', 409);
  }
  async create(batchId, jobId, body) {
    if (!body || typeof body.requestId !== 'string' || !idPattern.test(body.requestId) || !['manual', 'ai', 'upload','regenerate','typeset'].includes(body.action)) throw fail('修改请求无效。');
    const copyIndex = body.copyIndex;
    const target = this.target(batchId, jobId, body.kind, copyIndex);
    let source = target.result;
    if (body.sourceRevision === 'original') source = target.original;
    else if (body.sourceRevision && body.sourceRevision !== target.revisionId) {
      const revision = this.get(body.sourceRevision);
      if (revision.batch_id !== batchId || revision.job_id !== jobId || revision.kind !== body.kind || revision.copy_index !== copyIndex || revision.status !== 'ready') throw fail('修改底稿无效。');
      source = parse(revision.result);
    }
    if (body.sourceText != null && (body.kind !== 'copy' || !validText(body.sourceText, 18000))) throw fail('修改底稿文案无效。');
    if (body.action === 'manual' && (body.kind !== 'copy' || !validText(body.text, 18000))) throw fail('请输入完整文案，最多18000字。');
    if (body.action === 'upload' && (body.kind !== 'image' || typeof body.imageData !== 'string' || body.imageData.length > 21 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u.test(body.imageData))) throw fail('请选择15MB以内的PNG、JPEG或WebP图片。');
    if (body.action === 'ai' && !validText(body.instructions, 2000)) throw fail('请输入修改要求，最多2000字。');
    if(['regenerate','typeset'].includes(body.action)){
      body.typography=normalizeTypography(body.typography);
      if(body.kind!=='image'||!validText(body.prompt,16000)||!['layered_poster','direct_poster'].includes(body.renderMode))throw fail('请输入完整生图提示词，最多16000字。');
      if(body.renderMode==='layered_poster'){
        if(!body.backgroundStyle||typeof body.backgroundStyle!=='object')throw fail('请填写3～4行封面文字及文字/高亮颜色。');
        body.coverTexts=normalizeCoverTexts(body.coverTexts);
        body.colorGrade=normalizeColorGrade(body.colorGrade);
      }
    }
    if(body.action==='typeset'&&(body.renderMode!=='layered_poster'||body.prompt!==this.imageContext(target,source).prompt))throw fail('背景词已修改或当前图不是分层海报，请先重新生图或恢复背景词。');
    if(body.kind==='image'&&['ai','upload','typeset'].includes(body.action)&&!source.image)throw fail('这张图片尚未生成，请先编辑提示词重新生成。');
    if (body.region != null) {
      const r = body.region;
      if (body.kind !== 'image' || body.action !== 'ai' || !r || !['x','y','width','height'].every(key => typeof r[key] === 'number' && Number.isFinite(r[key])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001) throw fail('修改区域无效。');
    }
    const signature = createHash('sha256').update(JSON.stringify({ batchId, jobId, ...body, requestId: undefined })).digest('hex');
    const prior = this.db.prepare('SELECT * FROM content_ops_revisions WHERE request_id=?').get(body.requestId);
    if (prior) {
      if (prior.signature !== signature) throw fail('同一请求标识的修改内容已改变，请重新发起。', 409);
      return this.public(prior);
    }
    this.checkBase(target, body);
    if (this.db.prepare("SELECT 1 FROM content_ops_revisions WHERE job_id=? AND kind=? AND copy_index=? AND status='running'").get(jobId, body.kind, copyIndex)) throw fail('这项内容正在修改，请等待结果。', 409);
    if (this.children.size >= 3) throw fail('已有三项修改在进行，请稍后再试。', 409);
    const id = randomUUID();
    const pending=['regenerate','typeset'].includes(body.action)?{prompt:body.prompt,renderMode:body.renderMode,coverTexts:body.coverTexts||[],backgroundStyle:body.backgroundStyle||{},typography:body.typography||defaultTypography(),colorGrade:body.colorGrade||defaultColorGrade(),sourceRevision:body.sourceRevision||target.revisionId}:{};
    this.db.prepare("INSERT INTO content_ops_revisions(id,request_id,signature,batch_id,job_id,kind,copy_index,base_revision,action,instructions,status,created_at,result) VALUES(?,?,?,?,?,?,?,?,?,?,'running',?,?)").run(id, body.requestId, signature, batchId, jobId, body.kind, copyIndex, target.revisionId, body.action, body.instructions || '', new Date().toISOString(),JSON.stringify(pending));
    void this.run(id, { ...target, result: source }, body);
    return this.public(this.get(id));
  }
  async sourcePath(url) {
    const name = /^\/api\/uploads\/([0-9a-f-]+\.png)$/iu.exec(url || '')?.[1];
    if (!name) throw fail('当前图片路径无效。');
    const base = await realpath(this.uploadDir), path = await realpath(join(this.uploadDir, name));
    if (!path.startsWith(base + sep)) throw fail('当前图片路径无效。');
    return path;
  }
  async run(id, target, body) {
    const dir = join(this.root, 'scratch/hanabi-runtime/revisions', id), output = join(dir, 'result.json');
    const imageOutput = join(this.uploadDir, `${id}.png`);
    this.children.set(id, null);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await mkdir(this.uploadDir, { recursive: true, mode: 0o700 });
      const manifest = parse(await readFile(join(target.row.output_dir, 'manifest.json'), 'utf8').catch(() => '{}'));
      const data = { kind: body.kind, action: body.action, model: target.row.model, platform: target.row.platform,
        source_text: body.sourceText || target.result.text, text: body.text, brief: target.row.brief || '', facts: manifest.facts || {},
        instructions: body.instructions, region: body.region, image_data: body.imageData,
        prompt:body.prompt,render_mode:body.renderMode,cover_texts:body.coverTexts,background_style:body.backgroundStyle,typography:body.typography,
        color_grade:body.colorGrade,background_path:join(dir,'background.png') };
      if (body.kind === 'image'&&body.action!=='regenerate') data.source_image = await this.sourcePath(target.result.image);
      if(body.action==='typeset'){data.source_rows=this.imageContext(target,target.result).sourceRows;data.background_recovered=target.result.backgroundRecovered;}
      const input = join(dir, 'request.json');
      await writeFile(input, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
      if (this.get(id).status !== 'running') return;
      const python = [join(this.root, 'scratch/.venv/bin/python'), join(this.root, '.venv/bin/python')].find(path => existsSync(path)) || 'python3';
      const args = [join(this.root, 'scripts/generate.py'), 'revise', '--input', input, '--output', output,
        '--config', join(this.root, 'scratch/gateway.env'), ...(body.kind === 'image' ? ['--image-output', imageOutput] : [])];
      await this.invoke(python,args,child=>this.children.set(id,child),this.timeout);
      if (this.get(id).status !== 'running') return;
      const result = {...parse(this.get(id).result),...parse(await readFile(output, 'utf8'))};
      if (result.error) throw fail(String(result.error).slice(0, 1500));
      result.sourceRevision = body.sourceRevision || target.revisionId;
      if (body.kind === 'image') result.region = body.region || null;
      if (body.kind === 'copy' && !validText(result.text, 18000)) throw fail('修改结果没有完整文案，原稿已保留。');
      if (body.kind === 'image') {
        const bytes = await readFile(imageOutput);
        if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw fail('修改结果不是有效PNG，原图已保留。');
        result.image = `/api/uploads/${id}.png`;
        delete result.output;
      }
      this.db.prepare("UPDATE content_ops_revisions SET status='ready',result=? WHERE id=? AND status='running'").run(JSON.stringify(result), id);
    } catch (error) {
      this.db.prepare("UPDATE content_ops_revisions SET status='failed',error=? WHERE id=? AND status='running'").run(error.code === 'ENOENT' ? '修改程序没有返回结果，请检查Python环境；原稿已保留。' : String(error.message || '修改失败，原稿已保留。').slice(0, 1500), id);
      await rm(imageOutput, { force: true }).catch(() => {});
    } finally {
      this.children.delete(id);
      if (this.get(id).status !== 'ready') await rm(imageOutput, { force: true }).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  invoke(python,args,onChild,timeout){
    return new Promise((done,reject)=>{
      const child=this.spawnProcess(python,args,{cwd:this.root,env:process.env,stdio:['ignore','ignore','ignore'],shell:false});onChild(child);
      const timer=setTimeout(()=>{child.kill('SIGTERM');reject(fail('排版或修改超时，原稿保留。'));},timeout);
      child.once('error',()=>{clearTimeout(timer);reject(fail('修改程序启动失败，请检查Python环境。'));});
      child.once('close',code=>{clearTimeout(timer);done(code);});
    });
  }
  async preview(batchId,jobId,body){
    if(!body||typeof body!=='object'||Array.isArray(body))throw fail('预览参数无效。');
    if(this.previewChildren.size>=2)throw fail('正在更新其他排版预览，请稍后再试。',429);
    const target=this.target(batchId,jobId,'image',0);this.checkBase(target,body);
    let source=target.result;
    if(body.sourceRevision==='original')source=target.original;
    else if(body.sourceRevision&&body.sourceRevision!==target.revisionId){const row=this.get(body.sourceRevision);if(row.batch_id!==batchId||row.job_id!==jobId||row.kind!=='image'||row.status!=='ready')throw fail('预览底稿无效。');source=parse(row.result);}
    const context=this.imageContext(target,source);
    if(context.renderMode!=='layered_poster'||!source.image)throw fail('此图片不支持本机文字排版，请使用完整海报提示词或原图修改。');
    const coverTexts=normalizeCoverTexts(body.coverTexts);
    const typography=normalizeTypography(body.typography);
    const colorGrade=normalizeColorGrade(body.colorGrade);
    const id=randomUUID(),dir=join(this.root,'scratch/hanabi-runtime/previews',id),output=join(dir,'result.json'),image=join(dir,'image.png');
    this.previewChildren.set(id,null);
    try{
      const data={kind:'image',action:'typeset',platform:target.row.platform,model:target.row.model,source_image:await this.sourcePath(source.image),source_rows:context.sourceRows,
        background_recovered:source.backgroundRecovered,prompt:context.prompt,cover_texts:coverTexts,background_style:body.backgroundStyle,typography,color_grade:colorGrade};
      await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,'request.json'),JSON.stringify(data),{flag:'wx',mode:0o600});
      const python=[join(this.root,'scratch/.venv/bin/python'),join(this.root,'.venv/bin/python')].find(p=>existsSync(p))||'python3';
      await this.invoke(python,[join(this.root,'scripts/generate.py'),'revise','--input',join(dir,'request.json'),'--output',output,'--image-output',image,'--config',join(this.root,'scratch/gateway.env')],child=>this.previewChildren.set(id,child),20000);
      const result=parse(await readFile(output,'utf8'));if(result.error)throw fail(result.error);
      const bytes=await readFile(image);if(bytes.length>20*1024*1024)throw fail('排版预览过大。');
      return {...result,image:'data:image/png;base64,'+bytes.toString('base64')};
    }finally{this.previewChildren.delete(id);await rm(dir,{recursive:true,force:true});}
  }
  apply(batchId, jobId, body) {
    if (!body || typeof body.revisionId !== 'string') throw fail('采用版本请求无效。');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const target = this.target(batchId, jobId, body.kind, body.copyIndex);
      this.checkBase(target, body);
      if (this.db.prepare("SELECT 1 FROM content_ops_revisions WHERE job_id=? AND kind=? AND copy_index=? AND status='running'").get(jobId, body.kind, body.copyIndex)) throw fail('这项内容仍在修改，请等待结果或取消修改。', 409);
      if (body.revisionId !== 'original') {
        const revision = this.get(body.revisionId);
        if (revision.batch_id !== batchId || revision.job_id !== jobId || revision.kind !== body.kind || revision.copy_index !== body.copyIndex || revision.status !== 'ready') throw fail('不能采用其他内容或未完成的版本。');
      }
      this.db.prepare('INSERT INTO content_ops_revision_heads(job_id,kind,copy_index,revision_id) VALUES(?,?,?,?) ON CONFLICT(job_id,kind,copy_index) DO UPDATE SET revision_id=excluded.revision_id').run(jobId, body.kind, body.copyIndex, body.revisionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const batch = this.production.public(this.production.get(batchId));
    let corpusGap = null;
    try {
      const row = this.production.get(batchId);
      let manifest = {};
      try { manifest = JSON.parse(readFileSync(join(row.output_dir, 'manifest.json'), 'utf8')); } catch {}
      const post = batch.posts?.find(item => item.jobId === jobId) || batch.posts?.[0];
      const adoptedText = body.kind === 'copy' ? (post?.copies?.[body.copyIndex]?.text || post?.text || '') : '';
      const coverTexts = body.kind === 'image' ? (manifest.posts?.find(item => item.index === post?.index)?.cover_texts || []) : [];
      corpusGap = {
        trigger: 'corpus_gap',
        targetDoc: 'model-corpus',
        addedItem: {
          displayModel: batch.model,
          corpusModel: batch.corpusModel || row.corpus_model || batch.model,
          kind: body.kind,
          adoptedText: String(adoptedText).slice(0, 4000),
          coverTexts,
          researchNotes: manifest.research_notes || null,
        },
      };
    } catch {}
    return { batch, corpusGap };
  }
  recover() {
    this.db.prepare("UPDATE content_ops_revisions SET status='failed',error='服务已重启；原稿保留，修改任务不会自动重跑。' WHERE status='running'").run();
  }
  cancel(id) {
    this.db.prepare("UPDATE content_ops_revisions SET status='cancelled',error='修改已取消，原稿保留。' WHERE id=? AND status='running'").run(id);
    this.children.get(id)?.kill('SIGTERM');
    return this.public(this.get(id));
  }
  shutdown() { for(const child of this.previewChildren.values())child?.kill('SIGTERM');for (const child of this.children.values()) child?.kill('SIGTERM'); }
}
