const platforms = new Set(['xhs', 'xianyu', 'gzh']);
const labels = {xhs:'小红书', xianyu:'闲鱼', gzh:'公众号'};

const regexAliases = {
  '(?<![A-Za-z])token(?:s)?(?![A-Za-z])': 'token / tokens',
  '(?:神器|神奇)': '神器 / 神奇',
  '(?<![A-Za-z])(?:Cursor|Hermes\\s*Agent)(?![A-Za-z])': 'Cursor / Hermes Agent 等海外工具',
  '(?<![A-Za-z])(?:ChatGPT|GPT|Codex|GPT-Image|Claude|Gemini|Grok|OpenAI|Anthropic)(?![A-Za-z])': 'ChatGPT / Claude / Gemini 等境外模型',
  '(?:\\d+(?:\\.\\d+)?|[一二三四五六七八九十零〇两半]+(?:点[一二三四五六七八九十零〇]+)?|几)\\s*折': '具体折扣（如 5折、八折、几折）',
  '[¥￥]\\s*[0-9]+(?:\\.[0-9]+)?|(?:[0-9]+(?:\.[0-9]+)?|[一二三四五六七八九十百千万两零〇]+)\\s*(?:元|块钱|人民币|美元|美金|RMB|USD)': '具体价格与金额（含 ¥/￥、元、RMB等）',
};

function friendlyWord(entry) {
  if (!entry?.regex) return entry?.word || '';
  if (regexAliases[entry.word]) return regexAliases[entry.word];
  const clean = String(entry.word || '')
    .replace(/\(\?<![^)]+\)|\(\?![^)]+\)/g, '')
    .replace(/\(\?:([^()]+)\)/g, '$1')
    .replace(/\\s\*/g, ' ')
    .replace(/\\/g, '');
  return clean || entry.word;
}

async function request(path, body) {
  const response = await fetch(path, {
    cache: 'no-store',
    method: body ? 'POST' : 'GET',
    headers: {'content-type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};

function evidenceText(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(item => typeof item === 'string' ? item : item?.id || item?.evidence_id || '').filter(Boolean).join('、');
}

export class ContentOpsEditors {
  constructor(root = document.querySelector('.content-ops-editors')) {
    if (!root) return;
    this.root = root;
    this.personaStatus = root.querySelector('#persona-status');
    this.bannedStatus = root.querySelector('#banned-status');
    this.personaRaw = root.querySelector('#persona-raw');
    this.bannedRaw = root.querySelector('#banned-raw');
    this.personaRawDisclosure = this.personaRaw.closest('details');
    this.bannedRawDisclosure = this.bannedRaw.closest('details');
    this.wordsBody = root.querySelector('#banned-words-table tbody');
    this.words = [];
    this.personaRevision = '';
    this.bannedRevision = '';
    this.savingPersona = false;
    this.savingWord = false;
    root.querySelector('#persona-add-standard').addEventListener('click', () => this.showForm('standard'));
    root.querySelector('#persona-add-anti').addEventListener('click', () => this.showForm('anti'));
    root.querySelector('#persona-add-quote').addEventListener('click', () => this.showForm('quote'));
    root.querySelectorAll('[data-editor-cancel]').forEach(button => button.addEventListener('click', () => {
      const form = button.closest('form'); form.reset(); form.hidden = true;
    }));
    root.querySelector('#persona-form-standard').addEventListener('submit', event => { event.preventDefault(); void this.addPersona('add_standard', event.currentTarget); });
    root.querySelector('#persona-form-anti').addEventListener('submit', event => { event.preventDefault(); void this.addPersona('add_anti_pattern', event.currentTarget); });
    root.querySelector('#persona-form-quote').addEventListener('submit', event => { event.preventDefault(); void this.addPersona('add_quote', event.currentTarget); });
    root.querySelector('#banned-add-form')?.addEventListener('submit', event => { event.preventDefault(); void this.addWord(event.currentTarget); });
    void this.reload();
  }

  showForm(kind) {
    const form = this.root.querySelector(`#persona-form-${kind}`);
    form.hidden = false;
    if (kind === 'quote' && !form.elements.date.value) form.elements.date.value = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(new Date());
    form.querySelector('textarea,input')?.focus();
  }

  async reload() {
    this.personaStatus.textContent = '正在读取…';
    this.bannedStatus.textContent = '正在读取…';
    const [personaResult, bannedResult] = await Promise.allSettled([
      request('/api/content-ops/persona'), request('/api/content-ops/banned-words'),
    ]);
    if (personaResult.status === 'fulfilled') this.renderPersona(personaResult.value);
    else this.showRetry(this.personaStatus, `偏好读取失败：${personaResult.reason.message}。`);
    if (bannedResult.status === 'fulfilled') this.renderWords(bannedResult.value);
    else this.showRetry(this.bannedStatus, `风险词读取失败：${bannedResult.reason.message}。`);
  }

  showRetry(target, message) {
    target.replaceChildren(document.createTextNode(message + ' '));
    const button = node('button', '重试', 'ref-text-button');
    button.type = 'button'; button.addEventListener('click', () => void this.reload());
    target.append(button);
  }

  renderPersona(data) {
    this.personaRevision = typeof data.revision === 'string' ? data.revision : '';
    const textEntries = value => Array.isArray(value) && value.every(item => item && typeof item.text === 'string') ? value : null;
    const standards = data.parse_error ? null : textEntries(data.standards);
    const anti = data.parse_error ? null : textEntries(data.anti_patterns);
    const quotes = data.parse_error ? null : textEntries(data.quotes);
    this.personaRaw.textContent = typeof data.raw_md === 'string' ? data.raw_md : '没有提供原文回退内容。';
    this.personaRawDisclosure.hidden = typeof data.raw_md !== 'string' || Boolean(standards && anti && quotes);
    this.root.querySelector('#persona-version').textContent = data.version ? `证据版本 · 更新时间 ${data.version}` : '';
    if (!standards || !anti || !quotes) {
      this.personaRevision = '';
      this.root.querySelector('#persona-standards').replaceChildren();
      this.root.querySelector('#persona-anti').replaceChildren();
      this.root.querySelector('#persona-quotes').replaceChildren();
      this.personaStatus.textContent = '偏好结构无法完整解析；请展开原始文档查看，保存新条目前先修复格式。';
      this.root.querySelectorAll('#persona-add-standard,#persona-add-anti,#persona-add-quote,#content-ops-persona .editor-form button[type="submit"]').forEach(button => { button.disabled = true; });
      return;
    }
    this.root.querySelectorAll('#persona-add-standard,#persona-add-anti,#persona-add-quote,#content-ops-persona .editor-form button[type="submit"]').forEach(button => { button.disabled = !this.personaRevision; });
    this.personaStatus.textContent = `已读取 ${standards.length} 条标准、${anti.length} 条反例、${quotes.length} 条工作反馈${data.version ? `（最近更新：${data.version}，最新条目已置顶）` : ''}。`;
    const quoteDates = new Map(quotes.map(quote => [quote.id || quote.evidence_id, quote.date || '']));
    this.renderPersonaList('#persona-standards', standards, quoteDates);
    this.renderPersonaList('#persona-anti', anti, quoteDates);
    const quoteList = this.root.querySelector('#persona-quotes');
    quoteList.replaceChildren();
    const table = node('table');
    const head = node('thead'), headerRow = node('tr');
    for (const text of ['编号','更新时间','摘录']) headerRow.append(node('th', text));
    head.append(headerRow); table.append(head);
    const body = node('tbody');
    const sortedQuotes = [...quotes].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(String(b.id || '').slice(1)) - Number(String(a.id || '').slice(1)));
    for (const quote of sortedQuotes) {
      const row = node('tr');
      row.append(node('td', quote.id || quote.evidence_id || '—'), node('td', quote.date || '—'), node('td', quote.text || ''));
      body.append(row);
    }
    table.append(body); quoteList.append(table);
  }

  renderPersonaList(selector, entries, quoteDates) {
    const list = this.root.querySelector(selector);
    list.replaceChildren();
    const latestFor = entry => (Array.isArray(entry.evidence) ? entry.evidence : []).map(id => quoteDates?.get(id)).filter(Boolean).sort().at(-1) || '';
    const sorted = [...entries].sort((a, b) => latestFor(b).localeCompare(latestFor(a)) || (a.id || 0) - (b.id || 0));
    for (const entry of sorted) {
      const item = node('li');
      if (Number.isInteger(entry.id) && entry.id > 0) item.value = entry.id;
      item.append(node('span', entry.text || ''));
      const evidence = evidenceText(entry.evidence);
      const latestDate = latestFor(entry);
      if (evidence || latestDate) {
        const meta = [evidence ? `证据：${evidence}` : '', latestDate ? `更新时间：${latestDate}` : ''].filter(Boolean).join(' · ');
        item.append(node('span', meta, 'editor-evidence'));
      }
      list.append(item);
    }
  }

  renderWords(data) {
    const words = !data.parse_error && Array.isArray(data.words) && data.words.every(item => item && typeof item.word === 'string') ? data.words : null;
    this.words = words || [];
    this.bannedRevision = typeof data.revision === 'string' ? data.revision : '';
    this.bannedRaw.textContent = typeof data.raw_yaml === 'string' ? data.raw_yaml : '没有提供原文回退内容。';
    this.bannedRawDisclosure.hidden = typeof data.raw_yaml !== 'string' || Boolean(words);
    if (!words) {
      this.bannedRevision = '';
      this.wordsBody.replaceChildren();
      this.bannedStatus.textContent = '风险词结构无法解析；请展开原始文件查看。';
      this.root.querySelector('#banned-count').textContent = '';
      return;
    }
    const latestUpdate = words.map(item => item.added_at || item.updated_at || '').filter(Boolean).sort().at(-1) || '';
    this.root.querySelector('#banned-count').textContent = `${words.length} 条${latestUpdate ? ` · 更新时间 ${latestUpdate}` : ''}`;
    this.bannedStatus.textContent = `已读取 ${words.length} 条只读风控规则${latestUpdate ? `（最近更新：${latestUpdate}，最新词条已置顶）` : ''}。`;
    this.wordsBody.replaceChildren();
    const sortedWords = words.map((entry, index) => ({entry, index})).sort((a, b) => String(b.entry.added_at || b.entry.updated_at || '').localeCompare(String(a.entry.added_at || a.entry.updated_at || '')) || a.index - b.index).map(item => item.entry);
    for (const entry of sortedWords) {
      const row = node('tr');
      row.dataset.word = String(entry.word ?? '');
      const scope = Array.isArray(entry.platform) ? entry.platform : entry.platform ? [entry.platform] : [];
      const models = entry.model_scope ?? entry.models ?? [];
      const isRegex = Boolean(entry.regex);
      const displayName = isRegex ? friendlyWord(entry) : entry.word || '';
      const wordCell = node('th', null, 'editor-word');
      wordCell.scope = 'row';
      wordCell.append(node('span', displayName, 'editor-word-title'));
      if (isRegex) {
        const code = node('code', entry.word, 'editor-regex-code');
        code.title = `底层匹配正则：${entry.word}`;
        wordCell.append(code);
      }
      row.append(
        wordCell,
        node('td', entry.level || '—'),
        node('td', scope.map(value => labels[value] || value).join('、') || '—'),
        node('td', Array.isArray(models) ? models.join('、') : models || '—'),
        node('td', entry.replace || '—'),
        node('td', entry.reason || '—'),
        node('td', entry.added_at || entry.updated_at || '—'),
      );
      this.wordsBody.append(row);
    }
  }

  async addPersona(action, form) {
    if (this.savingPersona) return;
    const values = new FormData(form);
    const text = String(values.get('text') || '').trim();
    if (!text) return;
    const payload = {action, text, revision:this.personaRevision};
    if (action === 'add_quote') {
      payload.date = String(values.get('date') || '').trim();
      payload.redacted = values.get('redacted') === 'on';
    }
    else payload.evidence = String(values.get('evidence') || '').split(/[，,、\s]+/u).filter(Boolean);
    this.personaStatus.textContent = '正在保存…';
    this.savingPersona = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const saved = await request('/api/content-ops/persona', payload);
      form.reset(); form.hidden = true;
      await this.reload();
      this.personaStatus.append(document.createTextNode(` 已写回本机文档并提交 ${saved.commit || '已记录'}，正在分析规范…`));
      document.dispatchEvent(new CustomEvent('content-ops:spec-sync', {detail:{trigger:'persona_add',addedItem:{action,id:saved.id,text}}}));
    } catch (error) { this.showRetry(this.personaStatus, `保存失败：${error.message}。表单内容已保留。`); }
    finally { this.savingPersona = false; form.querySelector('button[type="submit"]').disabled = !this.personaRevision; }
  }

  async addWord(form) {
    if (this.savingWord) return;
    const values = new FormData(form);
    const word = String(values.get('word') || '').trim();
    const platform = values.getAll('platform').filter(value => platforms.has(value));
    if (!word || !platform.length) {
      this.bannedStatus.textContent = '请填写词或规则，并至少选择一个平台。';
      return;
    }
    const payload = {
      action:'add', word, regex:String(values.get('regex')) === 'true', level:String(values.get('level') || 'ban'), platform,
      replace:String(values.get('replace') || '').trim(), reason:String(values.get('reason') || '').trim(),
      model_scope:String(values.get('model_scope') || '').trim(), revision:this.bannedRevision,
    };
    this.bannedStatus.textContent = '正在保存…';
    this.savingWord = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const saved = await request('/api/content-ops/banned-words', payload);
      form.reset();
      form.querySelector('input[value="xhs"]').checked = true;
      await this.reload();
      this.bannedStatus.append(document.createTextNode(` 已写回本机文件并提交 ${saved.commit || '已记录'}，正在分析规范…`));
      document.dispatchEvent(new CustomEvent('content-ops:spec-sync', {detail:{trigger:'word_add',addedItem:{word,regex:payload.regex,level:payload.level,platform,replace:payload.replace,reason:payload.reason}}}));
    } catch (error) { this.showRetry(this.bannedStatus, `保存失败：${error.message}。表单内容已保留。`); }
    finally { this.savingWord = false; form.querySelector('button[type="submit"]').disabled = !this.bannedRevision; }
  }

}

if (typeof document !== 'undefined') {
  const mount = () => {
    if (!window.contentOpsEditors) window.contentOpsEditors = new ContentOpsEditors(document);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
}
