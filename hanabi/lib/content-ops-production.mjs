import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, constants } from 'node:fs';
import { readFile, mkdir, copyFile, rm, writeFile, readdir, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadGatewaySettings } from './content-ops-connections.mjs';
import { listProductModels, resolveProductModel } from './content-ops-models.mjs';

const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const now = () => new Date().toISOString();
const sameRefs = (a = [], b = []) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x?.platform === b[i]?.platform && String(x?.id).toLowerCase() === String(b[i]?.id).toLowerCase());
const gatewayEnvPath = root => [join(root, 'scratch/gateway.env')].find(path => existsSync(path)) || join(root, 'scratch/gateway.env');
const STYLE_PRESETS = new Set(['', 'bold_typo', 'code_ide', 'card_3d', 'comparison', 'promo', 'top_middle_bottom', 'left_right_bottom', 'surround', '大字报', '上中下', '左右下', '环绕']);

function validateCopyOptions(copyFormat, copyMultiplier) {
  if (!['all_variations', 'format_1', 'format_2', 'format_3'].includes(copyFormat)) throw fail('文案结构无效。');
  if (!Number.isInteger(copyMultiplier) || copyMultiplier < 1 || copyMultiplier > 5) throw fail('每张封面文案数须为 1–5 的整数。');
  return { copyFormat, copyMultiplier };
}

export function validateContentOpsInput(body, defaults = {}) {
  if (typeof body?.model !== 'string' || !body.model.trim() || body.model.trim().length > 80 || /[\x00-\x1f\x7f]/u.test(body.model)) throw fail('模型名须为 1–80 个字符，不能含换行。');
  if (!['xhs', 'xianyu'].includes(body.platform) || !Number.isInteger(body.count) || body.count < 1 || body.count > 10) throw fail('请选择支持的平台（小红书或闲鱼），数量为 1–10。');
  if (!['cached', 'fresh'].includes(body.backgroundMode)) throw fail('请选择复用背景或生成新背景。');
  if (typeof body.requestId !== 'string' || !/^[\w-]{8,100}$/u.test(body.requestId)) throw fail('请求标识无效。');
  const copyFormat = body.copyFormat ?? body.copy_format ?? defaults.copyFormat ?? 'all_variations';
  const copyMultiplier = body.copyMultiplier ?? body.copy_multiplier ?? defaults.copyMultiplier ?? 3;
  validateCopyOptions(copyFormat, copyMultiplier);
  const brief = body.brief ?? '';
  if (typeof brief !== 'string' || Array.from(brief).length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(brief)) throw fail('需求须为不超过1000字的文本，不能含控制字符。');
  const styleMode = body.styleMode ?? 'auto';
  if (!['auto', 'manual'].includes(styleMode)) throw fail('请选择自动或手动封面风格模式。');
  const rawPreset = body.stylePreset ?? '';
  if (typeof rawPreset !== 'string' || !STYLE_PRESETS.has(rawPreset)) throw fail('预设封面风格无效。');
  const rawPrompt = body.stylePrompt ?? '';
  if (typeof rawPrompt !== 'string' || Array.from(rawPrompt).length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(rawPrompt)) throw fail('自定义画面感觉须为不超过500字的文本，不能含控制字符。');
  const stylePreset = styleMode === 'manual' ? rawPreset : '';
  const stylePrompt = styleMode === 'manual' ? rawPrompt.trim() : '';
  if (styleMode === 'manual' && !stylePreset && !stylePrompt) throw fail('手动风格模式下，请至少选择一种预设风格或填写自定义画面感觉。');
  const refs = body.references ?? [];
  if (!Array.isArray(refs) || refs.length > 8 || refs.some(ref => !ref || !['xhs', 'xianyu'].includes(ref.platform) || typeof ref.id !== 'string' || !/^[0-9a-f]{1,64}$/iu.test(ref.id))) throw fail('参考帖无效；最多选择 8 条不同的本地帖子。');
  const references = refs.map(({ platform, id }) => ({ platform, id: id.toLowerCase() }));
  if (new Set(references.map(ref => `${ref.platform}:${ref.id}`)).size !== references.length) throw fail('参考帖无效；最多选择 8 条不同的本地帖子。');
  const rawModel = body.model.trim();
  let model = rawModel;
  if (Array.isArray(defaults.productModels) && defaults.productModels.length) {
    try { model = resolveProductModel(rawModel, defaults.productModels, { requireCover: false }); }
    catch { model = rawModel; }
  }
  return { model, platform: body.platform, count: body.count, copyFormat, copyMultiplier, backgroundMode: body.backgroundMode, styleMode, stylePreset, stylePrompt, requestId: body.requestId, references, brief };
}

export class ContentOpsProduction {
  constructor({ db, root, uploadDir, spawnProcess = spawn }) { Object.assign(this, { db, root: resolve(root), uploadDir, spawnProcess }); this.active = null; this.resumeTasks = new Map();
    // Existing installations retain batches; add optional columns in place.
    const columns = new Set(db.prepare('PRAGMA table_info(content_ops_batches)').all().map(column => column.name));
    if (!columns.has('brief')) db.exec("ALTER TABLE content_ops_batches ADD COLUMN brief TEXT NOT NULL DEFAULT ''");
    if (!columns.has('style_mode')) db.exec("ALTER TABLE content_ops_batches ADD COLUMN style_mode TEXT NOT NULL DEFAULT 'auto'");
    if (!columns.has('style_preset')) db.exec("ALTER TABLE content_ops_batches ADD COLUMN style_preset TEXT NOT NULL DEFAULT ''");
    if (!columns.has('style_prompt')) db.exec("ALTER TABLE content_ops_batches ADD COLUMN style_prompt TEXT NOT NULL DEFAULT ''");
    if (!columns.has('copy_format')) db.exec("ALTER TABLE content_ops_batches ADD COLUMN copy_format TEXT NOT NULL DEFAULT 'all_variations'");
    // Old batches have one copy per image; new creates always write the chosen multiplier.
    if (!columns.has('copy_multiplier')) db.exec('ALTER TABLE content_ops_batches ADD COLUMN copy_multiplier INTEGER NOT NULL DEFAULT 1');
    const jobColumns = new Set(db.prepare('PRAGMA table_info(analysis_jobs)').all().map(column => column.name));
    if (!jobColumns.has('copies')) db.exec("ALTER TABLE analysis_jobs ADD COLUMN copies TEXT NOT NULL DEFAULT '[]'");
  }
  async config() {
    const settings = await loadGatewaySettings(this.root);
    const setting = name => settings[name] || '';
    const preferences = parse(await readFile(join(this.root, 'data/distilled-preferences.json'), 'utf8').catch(() => ''), null);
    const ready = Boolean(preferences?.version && preferences?.persona && preferences?.platform_rules);
    const distilledAt = preferences?.distilled_at;
    const { copyFormat, copyMultiplier } = validateCopyOptions(setting('CONTENT_OPS_COPY_FORMAT') || 'all_variations', Number(setting('CONTENT_OPS_COPY_MULTIPLIER') || 3));
    const productModels = listProductModels(this.root);
    return { copyFormat, copyMultiplier, available: existsSync(join(this.root, 'scripts/generate.py')), configured: Boolean(setting('CONTENT_OPS_API_KEY') && setting('CONTENT_OPS_BASE_URL')), cachedAvailable: existsSync(this.backgroundPath()), textModel: setting('CONTENT_OPS_TEXT_MODEL'), visionModel: setting('CONTENT_OPS_VISION_MODEL'), imageModel: setting('CONTENT_OPS_IMAGE_MODEL'), preferencesReady: ready, preferencesVersion: ready ? { version: preferences.version, distilledAt } : null, productModels };
  }
  backgroundPath() { return join(this.root, 'data/images/backgrounds/company-qwen-2026-11-01.png'); }
  get(id) { const row = this.db.prepare('SELECT * FROM content_ops_batches WHERE id=?').get(id); if (!row) throw fail('生成批次不存在。', 404); return row; }
  jobs(row) { return parse(row.job_ids, []).map(id => this.db.prepare('SELECT * FROM analysis_jobs WHERE id=?').get(id)).filter(Boolean); }
  public(row) { const batch=this.original(row); batch.resumable=['failed','partial'].includes(row.status)&&existsSync(join(row.output_dir,'copy.json'))&&existsSync(join(row.output_dir,'manifest.json')); return this.revisions ? this.revisions.decorate(batch) : batch; }
  original(row) { const jobs = this.jobs(row); let manifest = {}; try { manifest = parse(readFileSync(join(row.output_dir, 'manifest.json'), 'utf8'), {}); } catch {} const references = Array.isArray(manifest.references) ? manifest.references.filter(ref => ref?.platform && ref?.id).map(ref => ({ platform: ref.platform, id: String(ref.id), title: String(ref.title || ref.id), collection_name: String(ref.collection_name || '') })) : []; return { id: row.id, model: row.model, brief: row.brief || '', platform: row.platform, count: row.count, imageCount: row.count, copyFormat: row.copy_format || 'all_variations', copyMultiplier: row.copy_multiplier ?? 1, copyCount: row.count * (row.copy_multiplier ?? 1), backgroundMode: row.background_mode, styleMode: row.style_mode || 'auto', stylePreset: row.style_preset || '', stylePrompt: row.style_prompt || '', status: row.status, error: row.error || '', createdAt: row.created_at, references, posts: jobs.map(job => ({ index: job.position, jobId: job.id, status: job.status, text: job.result || '', copies: parse(job.copies, []).length ? parse(job.copies, []) : (job.result ? [{index:1, text:job.result, copyFormat:null}] : []), error: job.error || '', progressMessage: job.progress_message || '', image: parse(job.attachments, []).find(item => item.mimeType === 'image/png')?.url || null })) }; }
  list() { return this.db.prepare('SELECT * FROM content_ops_batches ORDER BY created_at DESC LIMIT 30').all().map(row => this.public(row)); }
  async create(body) {
    const config = await this.config();
    const input = validateContentOpsInput(body, config), prior = this.db.prepare('SELECT * FROM content_ops_batches WHERE request_id=?').get(input.requestId);
    if (prior) { if ((prior.brief || '') !== input.brief || prior.model !== input.model || prior.platform !== input.platform || (prior.copy_format || 'all_variations') !== input.copyFormat || (prior.copy_multiplier ?? 1) !== input.copyMultiplier || prior.count !== input.count || prior.background_mode !== input.backgroundMode || (prior.style_mode || 'auto') !== input.styleMode || (prior.style_preset || '') !== input.stylePreset || (prior.style_prompt || '') !== input.stylePrompt || !sameRefs(parse(prior.reference_ids, []), input.references)) throw fail('同一请求标识的内容已改变，请另起一批。', 409); return { batch: this.public(prior), reused: true }; }
    if (this.db.prepare("SELECT 1 FROM content_ops_batches WHERE status='running'").get()) throw fail('已有一批图文正在生成，请完成或停止后再开始。', 409);
    if (!config.available || !config.configured) throw fail('本机生成脚本或公司网关尚未配置。', 503); if (input.backgroundMode === 'cached' && !config.cachedAvailable) throw fail('本机缓存背景不存在，请恢复背景文件或选择生成新背景。', 409);
    const id = randomUUID(), time = now(), date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()), outputDir = join(this.root, 'outputs', date, 'hanabi', id), jobIds = [];
    this.db.exec('BEGIN IMMEDIATE'); try { for (let position = 1; position <= input.count; position++) { const jobId = randomUUID(); jobIds.push(jobId); this.db.prepare("INSERT INTO analysis_jobs(id,batch_id,position,status,result,error,progress,progress_message,attachments,created_at,updated_at) VALUES(?,?,?,'analyzing','','',1,'正在生成文案','[]',?,?)").run(jobId, id, position, time, time); } this.db.prepare("INSERT INTO content_ops_batches(id,request_id,model,platform,count,background_mode,style_mode,style_preset,style_prompt,copy_format,copy_multiplier,reference_ids,brief,status,job_ids,output_dir,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'running',?,?,?, ?,?)").run(id, input.requestId, input.model, input.platform, input.count, input.backgroundMode, input.styleMode, input.stylePreset, input.stylePrompt, input.copyFormat, input.copyMultiplier, JSON.stringify(input.references), input.brief, JSON.stringify(jobIds), outputDir, '', time, time); this.db.exec('COMMIT'); } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
    void this.run(id); return { batch: this.public(this.get(id)), reused: false };
  }
  referencePath(id) { return join(this.root, 'scratch', 'hanabi-runtime', `references-${id}.json`); }
  resume(id) {
    if (this.resumeTasks.has(id)) return this.resumeTasks.get(id);
    const task = this.prepareResume(id).finally(() => this.resumeTasks.delete(id));
    this.resumeTasks.set(id, task);
    return task;
  }
  async prepareResume(id) {
    const row = this.get(id);
    if (row.status === 'running' || row.status === 'completed') return { batch:this.public(row), reused:true };
    if (!['failed','partial'].includes(row.status) || !this.public(row).resumable) throw fail('这批尚无完整可复用文案，请另做一批。');
    if (this.db.prepare("SELECT 1 FROM content_ops_batches WHERE status='running'").get()) throw fail('已有一批图文正在生成，请稍后继续。',409);
    const manifest = JSON.parse(await readFile(join(row.output_dir,'manifest.json'),'utf8'));
    if (manifest.product_model !== row.model || manifest.platform !== row.platform) throw fail('原始生成记录与批次不一致，未发起模型调用。');
    // Append a recovery snapshot beside the local history, preserving every exported original.
    const parent = join(dirname(this.uploadDir),'recovered-batches');
    await mkdir(parent,{recursive:true,mode:0o700});
    const outputDir = join(parent,randomUUID());
    await mkdir(outputDir,{mode:0o700});
    const allowed = /^(?:manifest\.json|copy\.json|post-\d+(?:-copy-\d+)?\.md|post-\d+(?:-background)?\.png|(?:vision-prompt|copy-response)-\d+\.txt)$/u;
    for (const name of await readdir(row.output_dir)) {
      if (!allowed.test(name)) continue;
      const source = join(row.output_dir,name), info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) throw fail('恢复快照包含异常文件，原始结果保留。');
      await copyFile(source,join(outputDir,name),constants.COPYFILE_EXCL);
    }
    manifest.recovery = { source_output_dir:row.output_dir, original_output_dir:manifest.recovery?.original_output_dir||row.output_dir, created_at:now() };
    await writeFile(join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare("SELECT 1 FROM content_ops_batches WHERE status='running'").get() || this.get(id).output_dir !== row.output_dir) throw fail('批次状态已改变，请重新读取后继续。',409);
      this.db.prepare("UPDATE content_ops_batches SET output_dir=?,status='running',error='',updated_at=? WHERE id=?").run(outputDir,now(),id);
      this.db.prepare("UPDATE analysis_jobs SET status='analyzing',error='',progress_message='复用已有结果，仅继续未完成阶段',updated_at=? WHERE batch_id=? AND status!='completed'").run(now(),id);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    void this.run(id,{resume:true});
    return { batch:this.public(this.get(id)), reused:false };
  }
  async run(id, { resume = false } = {}) {
    const row = this.get(id), python = [join(this.root, 'scratch/.venv/bin/python'), join(this.root, '.venv/bin/python')].find(path => existsSync(path)) || 'python3', args = [join(this.root, 'scripts/generate.py'), 'copy', '--model', row.model, '--platform', row.platform, '--count', String(row.count), '--copy-format', row.copy_format || 'all_variations', '--copy-multiplier', String(row.copy_multiplier ?? 1), '--output', row.output_dir, '--config', gatewayEnvPath(this.root), '--brief', row.brief || '', '--style-mode', row.style_mode || 'auto'], refs = parse(row.reference_ids, []), referenceFile = this.referencePath(id), current = { id, child: null, stopped: false, message: '', stderr: '' }; this.active = current;
    if (resume) args.push('--resume');
    if ((row.style_mode || 'auto') === 'manual') { if (row.style_preset) args.push('--style-preset', row.style_preset); if (row.style_prompt) args.push('--style-prompt', row.style_prompt); }
    try { if (refs.length) { await mkdir(join(this.root, 'scratch', 'hanabi-runtime'), { recursive: true }); await writeFile(referenceFile, JSON.stringify(refs)); args.push('--references', referenceFile); } if (row.background_mode === 'cached') args.push('--background', this.backgroundPath()); const child = this.spawnProcess(python, args, { cwd: this.root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false }); current.child = child; child.stderr.on('data', chunk => { current.stderr = (current.stderr + chunk.toString()).slice(-4000); }); child.stdout.on('data', () => this.db.prepare("UPDATE analysis_jobs SET progress=40,progress_message='文案已保存，正在完成图片',updated_at=? WHERE batch_id=? AND status='analyzing'").run(now(), id)); child.once('error', error => void this.finish(id, 1, error.message)); child.once('close', code => void this.finish(id, code ?? 1, current.stopped ? current.message : current.stderr)); } catch (error) { await this.finish(id, 1, error.message); }
  }
  async finish(id, code, error = '') {
    const row = this.get(id), manifest = parse(await readFile(join(row.output_dir, 'manifest.json'), 'utf8').catch(() => '{}')), jobs = this.jobs(row); let completed = 0; await mkdir(this.uploadDir, { recursive: true });
    for (const job of jobs) {
      if (job.status === 'completed') { completed++; continue; }
      const index = job.position, post = (manifest.posts || []).find(item => item.index === index);
      const copies = []; let attachment = null, problem = '';
      try {
        const versions = Array.isArray(post?.copies) ? post.copies : [{index:1, markdown:`post-${index}.md`}];
        for (const [offset, version] of versions.entries()) {
          const position = offset + 1;
          if (version.index !== position || ![`post-${index}-copy-${position}.md`, ...(position === 1 ? [`post-${index}.md`] : [])].includes(version.markdown)) throw fail('文案版本路径或序号无效。');
          const text = await readFile(join(row.output_dir, version.markdown), 'utf8');
          if (!text.trim()) throw fail('文案版本为空。');
          copies.push({index:position, copyFormat:version.copy_format || null, text});
        }
        if (copies.length !== (row.copy_multiplier ?? 1)) throw fail('文案版本数量不完整。');
        if (post?.status === 'completed' && post.image === `post-${index}.png`) {
          const bytes = await readFile(join(row.output_dir, post.image));
          if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw fail('生成图片校验失败。');
          const expected = post.image_metadata?.sha256, actual = createHash('sha256').update(bytes).digest('hex');
          if (expected && expected !== actual) throw fail('生成图片校验失败。');
          const attachmentId = randomUUID();
          await copyFile(join(row.output_dir, post.image), join(this.uploadDir, `${attachmentId}.png`));
          attachment = {id:attachmentId, name:`${row.model}-post-${index}.png`, mimeType:'image/png', size:bytes.length, url:`/api/uploads/${attachmentId}.png`};
        }
      } catch (cause) { problem = cause.code === 'ENOENT' ? '文案版本或图片文件缺失。' : cause.message; }
      const text = copies[0]?.text || '', ok = Boolean(!problem && copies.length === (row.copy_multiplier ?? 1) && attachment);
      const message = ok ? '图文已保存到燃放预览' : problem || error || manifest.error || '缺少完整文案或图片；请检查公司网关额度。';
      if (ok) completed++;
      this.db.prepare('UPDATE analysis_jobs SET status=?,result=?,copies=?,error=?,progress=?,progress_message=?,attachments=?,updated_at=? WHERE id=?').run(ok ? 'completed' : 'failed', text, JSON.stringify(copies), ok ? '' : message.slice(0, 1800), ok ? 100 : 0, ok ? '图文已保存到燃放预览' : '生成未完成，已保留部分结果', JSON.stringify(attachment ? [attachment] : []), now(), job.id);
    }
    const status = completed === row.count ? 'completed' : completed ? 'partial' : 'failed'; this.db.prepare('UPDATE content_ops_batches SET status=?,error=?,updated_at=? WHERE id=?').run(status, status === 'completed' ? '' : `${completed}/${row.count} 张封面组完成；${error || manifest.error || '生成未完成'}`.slice(0, 1800), now(), id); if (this.active?.id === id) this.active = null; await rm(this.referencePath(id), { force: true });
  }
  async recover() { for (const row of this.db.prepare("SELECT * FROM content_ops_batches WHERE status='running'").all()) await this.finish(row.id, 1, '服务已重启，收费任务不会自动重跑。'); }
  stop(id) { const row = this.get(id); if (row.status === 'running' && this.active?.id === id) { this.active.stopped = true; this.active.message = '用户已停止；已完成文件保留。'; this.active.child?.kill('SIGTERM'); } return this.public(row); }
  async shutdown() { if (!this.active) return; this.active.stopped = true; this.active.message = '服务已停止；已有文件保留。'; this.active.child?.kill('SIGTERM'); }
}
