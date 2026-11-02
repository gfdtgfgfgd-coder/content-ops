const platforms = new Set(['xhs', 'xianyu', 'gzh']);
const labels = {xhs:'小红书', xianyu:'闲鱼', gzh:'公众号'};

async function request(path, body) {
  const response = await fetch(path, {
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
    this.pendingRemoval = new Set();
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
    root.querySelector('#banned-add-form').addEventListener('submit', event => { event.preventDefault(); void this.addWord(event.currentTarget); });
    this.wordsBody.addEventListener('click', event => { void this.handleWordAction(event); });
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
    this.root.querySelector('#persona-version').textContent = data.version ? `证据版本 ${data.version}` : '';
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
    this.personaStatus.textContent = `已读取 ${standards.length} 条标准、${anti.length} 条反例、${quotes.length} 条工作反馈。`;
    this.renderPersonaList('#persona-standards', standards);
    this.renderPersonaList('#persona-anti', anti);
    const quoteList = this.root.querySelector('#persona-quotes');
    quoteList.replaceChildren();
    const table = node('table');
    const head = node('thead'), headerRow = node('tr');
    for (const text of ['编号','日期','摘录']) headerRow.append(node('th', text));
    head.append(headerRow); table.append(head);
    const body = node('tbody');
    for (const quote of quotes) {
      const row = node('tr');
      row.append(node('td', quote.id || quote.evidence_id || '—'), node('td', quote.date || '—'), node('td', quote.text || ''));
      body.append(row);
    }
    table.append(body); quoteList.append(table);
  }

  renderPersonaList(selector, entries) {
    const list = this.root.querySelector(selector);
    list.replaceChildren();
    for (const entry of entries) {
      const item = node('li');
      if (Number.isInteger(entry.id) && entry.id > 0) item.value = entry.id;
      item.append(node('span', entry.text || ''));
      const evidence = evidenceText(entry.evidence);
      if (evidence) item.append(node('span', evidence, 'editor-evidence'));
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
      this.bannedStatus.textContent = '风险词结构无法解析；请展开原始文件查看，暂不能编辑。';
      this.root.querySelector('#banned-count').textContent = '';
      this.root.querySelectorAll('#banned-add-form input,#banned-add-form select,#banned-add-form textarea,#banned-add-form button').forEach(control => { control.disabled = true; });
      this.root.querySelector('.editor-add-details > summary').setAttribute('aria-disabled','true');
      return;
    }
    const formReady = Boolean(this.bannedRevision);
    this.root.querySelectorAll('#banned-add-form input,#banned-add-form select,#banned-add-form textarea,#banned-add-form button').forEach(control => { control.disabled = !formReady; });
    this.root.querySelector('.editor-add-details > summary').removeAttribute('aria-disabled');
    this.root.querySelector('#banned-count').textContent = `${words.length} 条`;
    this.bannedStatus.textContent = `已读取 ${words.length} 条规则。`;
    this.wordsBody.replaceChildren();
    for (const entry of words) {
      const row = node('tr');
      row.dataset.word = String(entry.word ?? '');
      const scope = Array.isArray(entry.platform) ? entry.platform : entry.platform ? [entry.platform] : [];
      const models = entry.model_scope ?? entry.models ?? [];
      const wordCell = node('th', entry.word || '', 'editor-word');
      wordCell.scope = 'row';
      if (entry.regex) wordCell.append(node('span', '正则规则', 'editor-evidence'));
      row.append(
        wordCell,
        node('td', entry.level || '—'),
        node('td', scope.map(value => labels[value] || value).join('、') || '—'),
        node('td', Array.isArray(models) ? models.join('、') : models || '—'),
        node('td', entry.replace || '—'),
        node('td', entry.reason || '—'),
      );
      const action = node('td');
      const remove = node('button', this.pendingRemoval.has(String(entry.word)) ? '确认删除' : '删除', 'ref-text-button');
      remove.type = 'button'; remove.dataset.removeWord = String(entry.word ?? '');
      remove.setAttribute('aria-label', this.pendingRemoval.has(String(entry.word)) ? `确认删除风险词 ${entry.word}` : `删除风险词 ${entry.word}`);
      action.append(remove);
      if (this.pendingRemoval.has(String(entry.word))) {
        const cancel = node('button', '取消', 'ref-text-button');
        cancel.type = 'button'; cancel.dataset.cancelWord = String(entry.word ?? ''); action.append(cancel);
      }
      row.append(action); this.wordsBody.append(row);
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
      this.personaStatus.append(document.createTextNode(` 已写回本机文档并提交 ${saved.commit || '已记录'}，尚未推送。`));
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
      action:'add', word, level:String(values.get('level') || 'ban'), platform,
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
      this.bannedStatus.append(document.createTextNode(` 已写回本机文件并提交 ${saved.commit || '已记录'}，尚未推送。`));
    } catch (error) { this.showRetry(this.bannedStatus, `保存失败：${error.message}。表单内容已保留。`); }
    finally { this.savingWord = false; form.querySelector('button[type="submit"]').disabled = !this.bannedRevision; }
  }

  async handleWordAction(event) {
    const cancel = event.target.closest('[data-cancel-word]');
    if (cancel) {
      if (this.savingWord) return;
      this.pendingRemoval.delete(cancel.dataset.cancelWord);
      const remove = cancel.parentElement.querySelector('[data-remove-word]');
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除风险词 ${cancel.dataset.cancelWord}`);
      cancel.remove();
      return;
    }
    const button = event.target.closest('[data-remove-word]');
    if (!button || this.savingWord) return;
    const word = button.dataset.removeWord;
    if (!this.pendingRemoval.has(word)) {
      this.pendingRemoval.add(word);
      const confirmButton = button.closest('tr').querySelector('[data-remove-word]');
      confirmButton.textContent = '确认删除';
      confirmButton.setAttribute('aria-label', `确认删除风险词 ${word}`);
      const action = button.parentElement;
      const cancelButton = node('button', '取消', 'ref-text-button');
      cancelButton.type = 'button'; cancelButton.dataset.cancelWord = word;
      action.append(cancelButton);
      return;
    }
    button.disabled = true;
    this.savingWord = true;
    this.bannedStatus.textContent = `正在删除「${word}」…`;
    try {
      const saved = await request('/api/content-ops/banned-words', {action:'remove', word, revision:this.bannedRevision});
      this.pendingRemoval.delete(word);
      await this.reload();
      this.bannedStatus.append(document.createTextNode(` 已从本机文件删除并提交 ${saved.commit || '已记录'}，尚未推送。`));
    } catch (error) {
      button.disabled = false;
      this.bannedStatus.textContent = `删除失败：${error.message}`;
    } finally { this.savingWord = false; }
  }
}

if (typeof document !== 'undefined') {
  const mount = () => {
    if (!window.contentOpsEditors) window.contentOpsEditors = new ContentOpsEditors(document);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
}
