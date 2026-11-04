// The only persisted configuration is scratch/gateway.env; probe results are disposable memory.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const fields = {
  baseUrl: 'CONTENT_OPS_BASE_URL', apiKey: 'CONTENT_OPS_API_KEY',
  textModel: 'CONTENT_OPS_TEXT_MODEL', visionModel: 'CONTENT_OPS_VISION_MODEL', imageModel: 'CONTENT_OPS_IMAGE_MODEL', analysisModel: 'CONTENT_OPS_ANALYSIS_MODEL'
};
const defaults = { CONTENT_OPS_TEXT_MODEL: 'claude-sonnet-4-6', CONTENT_OPS_VISION_MODEL: 'claude-sonnet-4-6', CONTENT_OPS_IMAGE_MODEL: 'qwen-image-3.0', CONTENT_OPS_ANALYSIS_MODEL: 'claude-sonnet-4-6' };
const fail = message => Object.assign(new Error(message), { statusCode: 400 });
export function parseGatewayEnv(raw) {
  const settings = {};
  for (const line of raw.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match) continue;
    let value = match[2];
    if (value.length >= 2 && ['"', "'"].includes(value[0]) && value.at(-1) === value[0]) value = value.slice(1, -1);
    settings[match[1]] = value;
  }
  return settings;
}
async function readEnvFile(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('无法读取本机网关配置文件。'); }
}
export async function loadGatewaySettings(root, environment = process.env) {
  const file = parseGatewayEnv(await readEnvFile(join(root, 'scratch/gateway.env')));
  const settings = { ...file, ...environment };
  // UI-managed fields take their authoritative values from the file when present.
  for (const name of Object.values(fields)) if (Object.hasOwn(file, name)) settings[name] = file[name];
  return { ...defaults, ...settings };
}
const fingerprint = settings => createHash('sha256').update(JSON.stringify(Object.values(fields).map(name => settings[name] || ''))).digest('hex');
const configured = settings => Boolean(settings.CONTENT_OPS_BASE_URL && settings.CONTENT_OPS_API_KEY);

export class ContentOpsConnections {
  constructor({ root, environment = process.env, fetchRequest = fetch, probeTimeout = 10000 }) {
    Object.assign(this, { root, environment, fetchRequest, probeTimeout });
    this.path = join(root, 'scratch/gateway.env');
    this.queue = Promise.resolve();
    this.lastProbe = null;
  }
  async settings() { return loadGatewaySettings(this.root, this.environment); }
  public(settings) {
    const connection = this.lastProbe?.fingerprint === fingerprint(settings)
      ? this.lastProbe.result
      : { state: configured(settings) ? 'untested' : 'missing', ok: null, checkedAt: null };
    return {
      configured: configured(settings), baseUrl: settings.CONTENT_OPS_BASE_URL || '',
      apiKey: settings.CONTENT_OPS_API_KEY ? '••••••••' : '', hasKey: Boolean(settings.CONTENT_OPS_API_KEY),
      textModel: settings.CONTENT_OPS_TEXT_MODEL, visionModel: settings.CONTENT_OPS_VISION_MODEL, imageModel: settings.CONTENT_OPS_IMAGE_MODEL,
      analysisModel: settings.CONTENT_OPS_ANALYSIS_MODEL,
      connection, status: connection.state
    };
  }
  async get() { return this.public(await this.settings()); }
  validate(input, current) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('配置格式无效。');
    for (const name of Object.keys(input)) if (!Object.hasOwn(fields, name)) throw fail('配置字段无效。');
    for (const name of ['baseUrl', 'textModel', 'visionModel', 'imageModel', 'analysisModel']) if (typeof input[name] !== 'string') throw fail('接口地址和模型名称必须是文本。');
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw fail('API 密钥必须是文本。');
    const baseUrl = input.baseUrl.trim();
    let url;
    try { url = new URL(baseUrl); } catch { throw fail('接口地址必须是有效的 HTTPS 地址。'); }
    if (baseUrl.length > 2048 || /[\s'"\x00-\x1f\x7f]/u.test(baseUrl) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw fail('接口地址必须使用 HTTPS，且不能包含凭证、查询参数或片段。');
    const apiKey = input.apiKey?.trim() || current.CONTENT_OPS_API_KEY || '';
    if (!apiKey || apiKey.length > 4096 || /[\s'"\x00-\x1f\x7f]/u.test(apiKey)) throw fail('请输入有效的单行 API 密钥。');
    const textModel = input.textModel.trim(), visionModel = input.visionModel.trim(), imageModel = input.imageModel.trim(), analysisModel = input.analysisModel.trim();
    if (![textModel, visionModel, imageModel, analysisModel].every(model => /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}$/u.test(model))) throw fail('请输入有效的模型 ID（最多200字符，不含空白或引号）。');
    return { CONTENT_OPS_BASE_URL: baseUrl.replace(/\/+$/u, ''), CONTENT_OPS_API_KEY: apiKey, CONTENT_OPS_TEXT_MODEL: textModel, CONTENT_OPS_VISION_MODEL: visionModel, CONTENT_OPS_IMAGE_MODEL: imageModel, CONTENT_OPS_ANALYSIS_MODEL: analysisModel };
  }
  async probe(settings) {
    const base = settings.CONTENT_OPS_BASE_URL;
    const headers = { Authorization: `Bearer ${settings.CONTENT_OPS_API_KEY}` };
    let result;
    try {
      const response = await this.fetchRequest(`${base}/models`, { headers, redirect: 'error', signal: AbortSignal.timeout(this.probeTimeout) });
      if ([404, 405, 501].includes(response.status)) {
        await response.body?.cancel();
        const chat = await this.fetchRequest(`${base}/chat/completions`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, redirect: 'error',
          body: JSON.stringify({ model: settings.CONTENT_OPS_TEXT_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(this.probeTimeout)
        });
        const data = await chat.json().catch(() => null);
        const ok = chat.ok && !data?.error && Array.isArray(data?.choices) && data.choices.length > 0;
        result = { ok, status: chat.status, method: 'chat', message: ok ? '文案模型轻量测试通过；未测试生图。' : '文案模型请求未通过，请检查密钥、模型权限和额度。' };
      } else {
        const data = await response.json().catch(() => null);
        const ok = response.ok && !data?.error && Array.isArray(data?.data);
        result = { ok, status: response.status, method: 'models', message: ok ? '模型目录连接正常；未调用文案或生图。' : '模型目录测试失败，请检查地址、密钥或权限。' };
      }
    } catch { result = { ok: false, method: 'network', message: '连接超时或网络不可达，请检查接口地址。' }; }
    return { ...result, state: result.ok ? 'ok' : 'error', checkedAt: new Date().toISOString() };
  }
  save(input) {
    const task = this.queue.then(async () => {
      const updated = this.validate(input, await this.settings());
      const raw = await readEnvFile(this.path), seen = new Set();
      const lines = raw.split(/\r?\n/u).filter((line, index, all) => index !== all.length - 1 || line !== '').flatMap(line => {
        const name = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u)?.[1];
        if (!Object.hasOwn(updated, name)) return [line];
        if (seen.has(name)) return [];
        seen.add(name);
        return [`${name}=${updated[name]}`];
      });
      for (const [name, value] of Object.entries(updated)) if (!seen.has(name)) lines.push(`${name}=${value}`);
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await writeFile(temporary, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.path);
      } catch { throw new Error('无法保存本机网关配置，请检查文件权限。'); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
      const result = await this.probe(updated);
      this.lastProbe = { fingerprint: fingerprint(updated), result };
      return { ...this.public(updated), saved: true, ok: result.ok, test: result };
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
