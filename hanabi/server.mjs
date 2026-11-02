import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContentOpsProduction } from './lib/content-ops-production.mjs';
import { ContentOpsReferenceStore, referenceImageRequestPath } from './lib/content-ops-reference-store.mjs';
import { ContentOpsEditor } from './lib/content-ops-editor.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CONTENT_ALCHEMY_PORT || 6187);
const HOST = '127.0.0.1';
const REPO_ROOT = resolve(ROOT, '..');
const APP_DATA = process.env.CONTENT_ALCHEMY_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Content Alchemy');
const UPLOAD_DIR = join(APP_DATA, 'uploads');
const DB_PATH = process.env.CONTENT_OPS_DB_PATH || join(APP_DATA, 'content-ops.sqlite');
const runtimeRoot = process.env.CONTENT_ALCHEMY_RUNTIME_ROOT || join(homedir(), 'Library', 'Application Support', 'Content Alchemy', 'runtime');
await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });

const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS content_ops_batches (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, model TEXT NOT NULL, platform TEXT NOT NULL,
 count INTEGER NOT NULL, background_mode TEXT NOT NULL, reference_ids TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL, job_ids TEXT NOT NULL, output_dir TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
); CREATE TABLE IF NOT EXISTS analysis_jobs (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0,
 progress_message TEXT NOT NULL DEFAULT '', attachments TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS jobs_batch ON analysis_jobs(batch_id,position);`);
const production = new ContentOpsProduction({ db, root: REPO_ROOT, uploadDir: UPLOAD_DIR });
const references = new ContentOpsReferenceStore({ root: REPO_ROOT });
const editor = new ContentOpsEditor({ root: REPO_ROOT, runtimeRoot: existsSync(runtimeRoot) ? runtimeRoot : null });

const json = value => JSON.stringify(value, null, 2);
const send = (res, status, value, headers = {}) => { const body = Buffer.from(typeof value === 'string' ? value : json(value)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ...headers }); res.end(body); };
const error = (res, err) => send(res, err.statusCode || 500, { error: err.message || '服务器错误' });
const body = async req => { let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Object.assign(new Error('请求体过大。'), { statusCode: 413 }); } try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('JSON 请求体无效。'), { statusCode: 400 }); } };
const env = async () => { let raw = await readFile(join(REPO_ROOT, 'tmp/gateway.env'), 'utf8').catch(() => ''); if (!raw) raw = await readFile(join(REPO_ROOT, 'work/gateway.env'), 'utf8').catch(() => ''); const values = {}; for (const line of raw.split(/\r?\n/u)) { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u); if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/gu, ''); } return { ...values, ...process.env }; };
const gateway = async (req, res, pathname) => { const cfg = await env(); if (!cfg.CONTENT_OPS_BASE_URL || !cfg.CONTENT_OPS_API_KEY) return send(res, 503, { error: '本机网关未配置，请设置 tmp/gateway.env。' }); const base = String(cfg.CONTENT_OPS_BASE_URL).replace(/\/$/u, ''); const target = `${base}${pathname.startsWith('/v1') ? pathname.slice(3) || '/' : pathname}`; const headers = {}; for (const [key, value] of Object.entries(req.headers)) if (!['host', 'content-length', 'authorization'].includes(key)) headers[key] = value; headers.authorization = `Bearer ${cfg.CONTENT_OPS_API_KEY}`; const init = { method: req.method, headers }; if (!['GET', 'HEAD'].includes(req.method)) init.body = await collect(req); let upstream; try { upstream = await fetch(target, init); } catch (err) { return send(res, 502, { error: `公司网关连接失败：${err.message}` }); } res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key]) => !['content-length', 'connection', 'transfer-encoding'].includes(key)))); if (upstream.body) { for await (const chunk of upstream.body) res.write(chunk); } res.end(); };
const collect = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); };

async function route(req, res) {
  const parsed = new URL(req.url, `http://${HOST}:${PORT}`), pathname = parsed.pathname;
  if (pathname === '/v1' || pathname.startsWith('/v1/')) return gateway(req, res, pathname);
  if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, { ok: true, service: 'hanabi', port: PORT });
  try {
    if (req.method === 'GET' && pathname === '/api/content-ops/config') return send(res, 200, await production.config());
    if (req.method === 'POST' && pathname === '/api/content-ops/generate') return send(res, 200, await production.create(await body(req)));
    if (req.method === 'GET' && pathname === '/api/content-ops/batches') return send(res, 200, { batches: production.list() });
    const batchMatch = pathname.match(/^\/api\/content-ops\/batches\/([^/]+)(?:\/(stop))?$/u);
    if (batchMatch) { const id = decodeURIComponent(batchMatch[1]); if (req.method === 'GET' && !batchMatch[2]) return send(res, 200, { batch: production.public(production.get(id)) }); if (req.method === 'POST' && batchMatch[2] === 'stop') return send(res, 200, { batch: production.stop(id) }); }
    if (req.method === 'GET' && pathname === '/api/content-ops/references') return send(res, 200, await references.list(parsed.searchParams));
    if (req.method === 'GET' && pathname.startsWith('/api/content-ops/image/')) { const imagePath = referenceImageRequestPath(req.url); const image = await references.image(imagePath); const bytes = await readFile(image.path); res.writeHead(200, { 'Content-Type': image.mimeType, 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=3600' }); return res.end(bytes); }
    if (req.method === 'GET' && pathname === '/api/content-ops/persona') return send(res, 200, await editor.persona());
    if (req.method === 'POST' && pathname === '/api/content-ops/persona') return send(res, 200, await editor.mutate('persona', await body(req)));
    if (req.method === 'GET' && pathname === '/api/content-ops/banned-words') return send(res, 200, await editor.bannedWords());
    if (req.method === 'POST' && pathname === '/api/content-ops/banned-words') return send(res, 200, await editor.mutate('words', await body(req)));
    const uploadMatch = pathname.match(/^\/api\/uploads\/([0-9a-f-]+)\.png$/iu); if (req.method === 'GET' && uploadMatch) { const file = join(UPLOAD_DIR, `${uploadMatch[1]}.png`); const info = await stat(file).catch(() => null); if (!info?.isFile()) return send(res, 404, { error: '图片不存在。' }); const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=31536000, immutable' }); return res.end(bytes); }
    return staticFile(req, res, pathname);
  } catch (err) { return error(res, err); }
}

async function staticFile(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '方法不支持。' });
  let path = pathname === '/' ? '/index.html' : pathname; try { path = decodeURIComponent(path); } catch { return send(res, 400, { error: '路径无效。' }); }
  const file = resolve(ROOT, `.${path}`); if (!file.startsWith(`${ROOT}/`) || file.includes('\0')) return send(res, 400, { error: '路径无效。' });
  const info = await stat(file).catch(() => null); if (!info?.isFile()) return send(res, 404, { error: '文件不存在。' });
  const bytes = await readFile(file), types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' }); if (req.method === 'GET') res.end(bytes); else res.end();
}

const server = createServer((req, res) => void route(req, res));
server.on('error', err => { console.error(err); process.exitCode = 1; });
await production.recover();
server.listen(PORT, HOST, () => console.log(`Hanabi content-ops listening on http://${HOST}:${PORT}`));
const shutdown = async () => { await production.shutdown(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
