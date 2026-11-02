import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const now = () => new Date().toISOString();
const sameRefs = (a = [], b = []) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x?.platform === b[i]?.platform && String(x?.id).toLowerCase() === String(b[i]?.id).toLowerCase());
const gatewayEnvPath = root => [join(root, 'tmp/gateway.env'), join(root, 'work/gateway.env')].find(path => existsSync(path)) || join(root, 'tmp/gateway.env');

export function validateContentOpsInput(body) {
  if (typeof body?.model !== 'string' || !body.model.trim() || body.model.trim().length > 80 || /[\x00-\x1f\x7f]/u.test(body.model)) throw fail('模型名须为 1–80 个字符，不能含换行。');
  if (body.platform !== 'xhs' || !Number.isInteger(body.count) || body.count < 1 || body.count > 10) throw fail('请选择小红书，数量为 1–10。');
  if (!['cached', 'fresh'].includes(body.backgroundMode)) throw fail('请选择复用背景或生成新背景。');
  if (typeof body.requestId !== 'string' || !/^[\w-]{8,100}$/u.test(body.requestId)) throw fail('请求标识无效。');
  const refs = body.references ?? [];
  if (!Array.isArray(refs) || refs.length > 8 || refs.some(ref => !ref || !['xhs', 'xianyu'].includes(ref.platform) || typeof ref.id !== 'string' || !/^[0-9a-f]{1,64}$/iu.test(ref.id))) throw fail('参考帖无效；最多选择 8 条不同的本地帖子。');
  const references = refs.map(({ platform, id }) => ({ platform, id: id.toLowerCase() }));
  if (new Set(references.map(ref => `${ref.platform}:${ref.id}`)).size !== references.length) throw fail('参考帖无效；最多选择 8 条不同的本地帖子。');
  return { model: body.model.trim(), platform: 'xhs', count: body.count, backgroundMode: body.backgroundMode, requestId: body.requestId, references };
}

export class ContentOpsProduction {
  constructor({ db, root, uploadDir, spawnProcess = spawn }) { Object.assign(this, { db, root: resolve(root), uploadDir, spawnProcess }); this.active = null; }
  async config() {
    const env = await readFile(gatewayEnvPath(this.root), 'utf8').catch(() => '');
    const setting = name => process.env[name] || env.split(/\r?\n/u).find(line => line.trim().startsWith(`${name}=`))?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/gu, '') || '';
    const preferences = parse(await readFile(join(this.root, 'data/distilled-preferences.json'), 'utf8').catch(() => ''), null);
    const ready = Boolean(preferences?.version && preferences?.persona && preferences?.platform_rules);
    const distilledAt = preferences?.distilled_at;
    return { available: existsSync(join(this.root, 'scripts/gen-xhs-post.py')), configured: Boolean(setting('CONTENT_OPS_API_KEY') && setting('CONTENT_OPS_BASE_URL')), cachedAvailable: existsSync(this.backgroundPath()), textModel: setting('CONTENT_OPS_TEXT_MODEL') || 'claude-sonnet-4-6', imageModel: setting('CONTENT_OPS_IMAGE_MODEL') || 'qwen-image-3.0', preferencesReady: ready, preferencesVersion: ready ? { version: preferences.version, distilledAt } : null };
  }
  backgroundPath() { return join(this.root, 'data/images/backgrounds/company-qwen-2026-11-01.png'); }
  get(id) { const row = this.db.prepare('SELECT * FROM content_ops_batches WHERE id=?').get(id); if (!row) throw fail('生成批次不存在。', 404); return row; }
  jobs(row) { return parse(row.job_ids, []).map(id => this.db.prepare('SELECT * FROM analysis_jobs WHERE id=?').get(id)).filter(Boolean); }
  public(row) { const jobs = this.jobs(row); let manifest = {}; try { manifest = parse(readFileSync(join(row.output_dir, 'manifest.json'), 'utf8'), {}); } catch {} const references = Array.isArray(manifest.references) ? manifest.references.filter(ref => ref?.platform && ref?.id).map(ref => ({ platform: ref.platform, id: String(ref.id), title: String(ref.title || ref.id) })) : []; return { id: row.id, model: row.model, platform: row.platform, count: row.count, backgroundMode: row.background_mode, status: row.status, error: row.error || '', createdAt: row.created_at, references, posts: jobs.map(job => ({ index: job.position, jobId: job.id, status: job.status, text: job.result || '', error: job.error || '', progressMessage: job.progress_message || '', image: parse(job.attachments, []).find(item => item.mimeType === 'image/png')?.url || null })) }; }
  list() { return this.db.prepare('SELECT * FROM content_ops_batches ORDER BY created_at DESC LIMIT 30').all().map(row => this.public(row)); }
  async create(body) {
    const input = validateContentOpsInput(body), prior = this.db.prepare('SELECT * FROM content_ops_batches WHERE request_id=?').get(input.requestId);
    if (prior) { if (prior.model !== input.model || prior.count !== input.count || prior.background_mode !== input.backgroundMode || !sameRefs(parse(prior.reference_ids, []), input.references)) throw fail('同一请求标识的内容已改变，请另起一批。', 409); return { batch: this.public(prior), reused: true }; }
    if (this.db.prepare("SELECT 1 FROM content_ops_batches WHERE status='running'").get()) throw fail('已有一批图文正在生成，请完成或停止后再开始。', 409);
    const config = await this.config(); if (!config.available || !config.configured) throw fail('本机生成脚本或公司网关尚未配置。', 503); if (input.backgroundMode === 'cached' && !config.cachedAvailable) throw fail('本机缓存背景不存在，请恢复背景文件或选择生成新背景。', 409);
    const id = randomUUID(), time = now(), date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()), outputDir = join(this.root, 'outputs', date, 'hanabi', id), jobIds = [], brief = `生成 ${input.count} 篇 ${input.model} 小红书图文。`;
    this.db.exec('BEGIN IMMEDIATE'); try { for (let position = 1; position <= input.count; position++) { const jobId = randomUUID(); jobIds.push(jobId); this.db.prepare("INSERT INTO analysis_jobs(id,batch_id,position,status,result,error,progress,progress_message,attachments,created_at,updated_at) VALUES(?,?,?,'analyzing','','',1,'Claude 正在写稿和终审','[]',?,?)").run(jobId, id, position, time, time); } this.db.prepare("INSERT INTO content_ops_batches(id,request_id,model,platform,count,background_mode,reference_ids,status,job_ids,output_dir,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'running',?,?,?, ?,?)").run(id, input.requestId, input.model, input.platform, input.count, input.backgroundMode, JSON.stringify(input.references), JSON.stringify(jobIds), outputDir, '', time, time); this.db.exec('COMMIT'); } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
    void this.run(id); return { batch: this.public(this.get(id)), reused: false };
  }
  referencePath(id) { return join(this.root, 'tmp', `hanabi-references-${id}.json`); }
  async run(id) {
    const row = this.get(id), python = existsSync(join(this.root, '.venv/bin/python')) ? join(this.root, '.venv/bin/python') : 'python3', args = [join(this.root, 'scripts/gen-xhs-post.py'), '--model', row.model, '--platform', row.platform, '--count', String(row.count), '--output', row.output_dir, '--config', gatewayEnvPath(this.root)], refs = parse(row.reference_ids, []), referenceFile = this.referencePath(id), current = { id, child: null, stopped: false, message: '', stderr: '' }; this.active = current;
    try { if (refs.length) { await mkdir(join(this.root, 'tmp'), { recursive: true }); await writeFile(referenceFile, JSON.stringify(refs)); args.push('--references', referenceFile); } if (row.background_mode === 'cached') args.push('--background', this.backgroundPath()); const child = this.spawnProcess(python, args, { cwd: this.root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false }); current.child = child; child.stderr.on('data', chunk => { current.stderr = (current.stderr + chunk.toString()).slice(-4000); }); child.stdout.on('data', () => this.db.prepare("UPDATE analysis_jobs SET progress=40,progress_message='文案已保存，正在完成图片',updated_at=? WHERE batch_id=? AND status='analyzing'").run(now(), id)); child.once('error', error => void this.finish(id, 1, error.message)); child.once('close', code => void this.finish(id, code ?? 1, current.stopped ? current.message : current.stderr)); } catch (error) { await this.finish(id, 1, error.message); }
  }
  async finish(id, code, error = '') {
    const row = this.get(id), manifest = parse(await readFile(join(row.output_dir, 'manifest.json'), 'utf8').catch(() => '{}')), jobs = this.jobs(row); let completed = 0; await mkdir(this.uploadDir, { recursive: true });
    for (const job of jobs) { if (job.status === 'completed') { completed++; continue; } const index = job.position, post = (manifest.posts || []).find(item => item.index === index), text = await readFile(join(row.output_dir, `post-${index}.md`), 'utf8').catch(() => ''); let attachment = null; if (post?.status === 'completed' && post.image === `post-${index}.png`) { const bytes = await readFile(join(row.output_dir, post.image)); if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw fail('生成图片校验失败。'); const expected = post.image_metadata?.sha256, actual = createHash('sha256').update(bytes).digest('hex'); if (expected && expected !== actual) throw fail('生成图片校验失败。'); const attachmentId = randomUUID(); await copyFile(join(row.output_dir, post.image), join(this.uploadDir, `${attachmentId}.png`)); attachment = { id: attachmentId, name: `${row.model}-post-${index}.png`, mimeType: 'image/png', size: bytes.length, url: `/api/uploads/${attachmentId}.png` }; } const ok = Boolean(text && attachment), message = ok ? '图文已保存到燃放预览' : error || manifest.error || '缺少完整文案或图片；请检查公司网关额度。'; if (ok) completed++; this.db.prepare('UPDATE analysis_jobs SET status=?,result=?,error=?,progress=?,progress_message=?,attachments=?,updated_at=? WHERE id=?').run(ok ? 'completed' : 'failed', text, ok ? '' : message.slice(0, 1800), ok ? 100 : 0, ok ? '图文已保存到燃放预览' : '生成未完成，已保留部分结果', JSON.stringify(attachment ? [attachment] : []), now(), job.id); }
    const status = completed === row.count ? 'completed' : completed ? 'partial' : 'failed'; this.db.prepare('UPDATE content_ops_batches SET status=?,error=?,updated_at=? WHERE id=?').run(status, status === 'completed' ? '' : `${completed}/${row.count} 篇完成；${error || manifest.error || '生成未完成'}`.slice(0, 1800), now(), id); if (this.active?.id === id) this.active = null; await rm(this.referencePath(id), { force: true });
  }
  async recover() { for (const row of this.db.prepare("SELECT * FROM content_ops_batches WHERE status='running'").all()) await this.finish(row.id, 1, '服务已重启，收费任务不会自动重跑。'); }
  stop(id) { const row = this.get(id); if (row.status === 'running' && this.active?.id === id) { this.active.stopped = true; this.active.message = '用户已停止；已完成文件保留。'; this.active.child?.kill('SIGTERM'); } return this.public(row); }
  async shutdown() { if (!this.active) return; this.active.stopped = true; this.active.message = '服务已停止；已有文件保留。'; this.active.child?.kill('SIGTERM'); }
}
