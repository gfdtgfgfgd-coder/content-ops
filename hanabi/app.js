import { marked } from '/node_modules/marked/lib/marked.esm.js';
import DOMPurify from '/node_modules/dompurify/dist/purify.es.mjs';
import { ContentOpsUI } from '/lib/content-ops-ui.mjs';
import { mountContentOpsReferences } from '/lib/content-ops-references.mjs';

const views = ['generate', 'references', 'persona', 'banned', 'preview', 'rules', 'documents'];
const showView = (name) => {
  const view = ['persona', 'banned'].includes(name) ? 'rules' : views.includes(name) ? name : 'generate';
  const changed = !document.querySelector(`#view-${view}`)?.classList.contains('active');
  for (const panel of document.querySelectorAll('.view-panel')) {
    panel.hidden = panel.id !== `view-${view}`;
    panel.classList.toggle('active', !panel.hidden);
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  history.replaceState(null, '', `#${view}`);
  document.dispatchEvent(new CustomEvent('content-ops:view', {detail:{view, tab:['persona','banned'].includes(name) ? name : null}}));
  if (changed) window.scrollTo({ top:0, behavior:'instant' });
};
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) { event.preventDefault(); showView(button.dataset.view); }
});
window.addEventListener('popstate', () => showView(location.hash.slice(1)));
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

const preview = document.querySelector('#preview-content');
window.addEventListener('content-ops:preview', (event) => {
  const batch = event.detail?.batch;
  if (!preview || !batch) return;
  preview.replaceChildren();
  for (const post of batch.posts || []) {
    const card = document.createElement('article');
    card.className = `content-ops-post content-ops-post--${batch.platform}`;
    const title = document.createElement('h3'); title.textContent = `${batch.model} · 第 ${post.index} 篇`;
    const text = document.createElement('pre'); text.textContent = post.text || post.progressMessage || '';
    card.append(title, text);
    if (post.image) { const image = document.createElement('img'); image.src = post.image; image.alt = title.textContent; card.prepend(image); }
    preview.append(card);
  }
  showView('preview');
});

const api = async (path, options = {}) => {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
};

function mountDocumentViews() {
  const groups = [
    ['rules', '运营规则', [['platform-rules','平台规则'], ['design-rules','设计规则'], ['persona','思敏偏好'], ['banned','风险词库']]],
    ['documents', '文档与决策', [['guide','操作手册'], ['decisions','决策记录'], ['sources','素材来源']]]
  ];
  const documentPaths = {'rules/platform-rules.md':'platform-rules', 'rules/design-rules.md':'design-rules',
    'docs/GUIDE.md':'guide', 'docs/01-决策记录.md':'decisions', 'data/sources/README.md':'sources',
    'skills/simin-persona/SKILL.md':'persona', 'rules/banned-words-quick.yaml':'banned'};
  const readers = new Map();
  for (const [view, title, docs] of groups) {
    const panel = document.createElement('section'); panel.className = 'view-panel'; panel.id = `view-${view}`; panel.hidden = true;
    const heading = document.createElement('h1'); heading.textContent = title;
    const tabs = document.createElement('div'); tabs.className = 'doc-tabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label',title);
    const reader = document.createElement('div'); reader.className = 'document-reader';
    const toc = document.createElement('nav'); toc.className = 'document-toc'; toc.setAttribute('aria-label','文档目录');
    const article = document.createElement('article'); article.className = 'document-content'; article.setAttribute('aria-live','polite');
    reader.append(toc, article); panel.append(heading, tabs, reader); document.querySelector('.main-content').append(panel);
    const editors = new Map();
    for (const [id, label] of docs) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = label; tab.dataset.doc = id;
      tab.setAttribute('role','tab'); tab.id = `tab-${id}`; tab.setAttribute('aria-controls', `doc-panel-${id}`); tabs.append(tab);
      if (['persona','banned'].includes(id)) {
        const editor = document.querySelector(`#view-${id}`);
        editor.classList.remove('view-panel'); editor.id = `doc-panel-${id}`; editor.hidden = true;
        editor.setAttribute('role','tabpanel'); editor.setAttribute('aria-labelledby',tab.id); panel.append(editor); editors.set(id,editor);
        editor.querySelector('h1').hidden = true;
      }
    }
    let active = docs[0][0], version = 0;
    const select = async (name = active) => {
      active = name; const request = ++version;
      for (const tab of tabs.querySelectorAll('[data-doc]')) {
        const selected = tab.dataset.doc === name; tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1;
      }
      for (const [id, editor] of editors) editor.hidden = id !== name;
      reader.hidden = editors.has(name); if (reader.hidden) { void window.contentOpsEditors?.reload?.(); return; }
      reader.setAttribute('role','tabpanel'); reader.id = `doc-panel-${name}`; reader.setAttribute('aria-labelledby',`tab-${name}`);
      article.textContent = '正在读取文档…'; toc.replaceChildren();
      try {
        const doc = await api(`/api/content-ops/documents?doc=${encodeURIComponent(name)}`);
        if (request !== version) return;
        article.innerHTML = DOMPurify.sanitize(marked.parse(doc.content), {USE_PROFILES:{html:true}});
        const updatedAt = doc.content.match(/最近更新时间[：:]\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
        const caption = document.createElement('p'); caption.className = 'document-source'; caption.textContent = `源文件 · ${doc.path}${updatedAt ? ` · 最近更新时间 ${updatedAt}` : ''} · 打开时实时读取`; article.prepend(caption);
        const used = new Set(), tocTitle = document.createElement('strong'); tocTitle.textContent = '本页目录'; toc.append(tocTitle);
        for (const item of article.querySelectorAll('h1,h2,h3,h4')) {
          const slug = item.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu,'').replace(/\s+/gu,'-') || 'section';
          let id = slug, suffix = 1; while (used.has(id)) id = `${slug}-${suffix++}`; used.add(id); item.id = id;
          const link = document.createElement('a'); link.href = `#${id}`; link.textContent = item.textContent; link.dataset.level = item.tagName;
          link.addEventListener('click',event => {event.preventDefault(); item.scrollIntoView({behavior:'smooth',block:'start'});}); toc.append(link);
        }
        for (const link of article.querySelectorAll('a[href]')) {
          const href = link.getAttribute('href');
          if (href.startsWith('#')) {link.addEventListener('click',event => {event.preventDefault(); document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({behavior:'smooth'});});continue;}
          const relative = new URL(href, `https://local.invalid/${doc.path}`);
          const target = relative.origin === 'https://local.invalid' ? documentPaths[decodeURIComponent(relative.pathname).slice(1)] : null;
          if (target) {link.addEventListener('click',event => {event.preventDefault(); openDocument(target);});}
          else if (['https:','http:'].includes(relative.protocol) && relative.origin !== 'https://local.invalid') {link.target = '_blank';link.rel = 'noopener noreferrer';}
          else {link.removeAttribute('href');link.title = '此文件未纳入业务文档面板';}
        }
      } catch (error) {if (request === version) article.textContent = `文档读取失败：${error.message}`;}
    };
    tabs.addEventListener('click', event => {const tab = event.target.closest('[data-doc]'); if(tab) void select(tab.dataset.doc);});
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const buttons = [...tabs.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus(); void select(buttons[next].dataset.doc);
    });
    readers.set(view, select);
  }
  function openDocument(name) {const view = ['guide','decisions','sources'].includes(name) ? 'documents' : 'rules'; showView(view); void readers.get(view)(name);}
  document.addEventListener('content-ops:view', event => {if (readers.has(event.detail.view)) void readers.get(event.detail.view)(event.detail.tab || undefined);});
}

mountDocumentViews();

const connectionsDialog = document.querySelector('#connections-dialog');
const connectionsForm = document.querySelector('#connections-form');

const connectionsStatus = document.querySelector('#connections-status');
const connectionSummary = document.querySelector('#connection-summary');
const connectionLauncher = document.querySelector('#connections-open');
const setConnectionStatus = (message, state = '') => {
  connectionsStatus.textContent = message;
  connectionsStatus.dataset.state = state;
};
const renderConnectionState = config => {
  const state = config.connection?.state || 'untested';
  const labels = { ok: '连接正常', error: '测试失败', untested: '已配置 · 未测试', missing: '尚未配置' };
  connectionSummary.textContent = labels[state] || '未测试';
  connectionLauncher.dataset.state = state;
  setConnectionStatus(config.connection?.message || (config.configured ? '密钥已配置；保存时将测试连接。' : '请填写接口地址与密钥。'), state);
};
const refreshConnections = async () => {
  const config = await api('/api/connections');
  const fields = connectionsForm.elements;
  fields.baseUrl.value = config.baseUrl || '';
  fields.apiKey.value = '';
  fields.apiKey.placeholder = config.hasKey ? `已配置 ${config.apiKey}，留空保留` : '请输入本机网关密钥';
  fields.textModel.value = config.textModel || 'claude-sonnet-4-6';
  fields.visionModel.value = config.visionModel || 'claude-sonnet-4-6';
  fields.imageModel.value = config.imageModel || 'qwen-image-3.0';
  renderConnectionState(config);
};
const connectionError = error => {
  connectionSummary.textContent = '读取或保存失败';
  connectionLauncher.dataset.state = 'error';
  setConnectionStatus(error.message, 'error');
};
const connectionBusy = busy => {
  for (const field of connectionsForm.querySelectorAll('input, button[type="submit"]')) field.disabled = busy;
};
connectionLauncher.addEventListener('click', async () => {
  if (connectionsDialog.open) return;
  connectionsDialog.showModal();
  setConnectionStatus('正在读取本机配置…');
  connectionBusy(true);
  try { await refreshConnections(); } catch (error) { connectionError(error); }
  finally { connectionBusy(false); }
});
connectionsDialog.addEventListener('click', event => {
  if (event.target === connectionsDialog || event.target.closest('[data-connections-close]')) connectionsDialog.close();
});
connectionsForm.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(connectionsForm));
  connectionBusy(true);
  setConnectionStatus('正在保存并测试连接…');
  try {
    const result = await api('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    connectionsForm.elements.apiKey.value = '';
    connectionsForm.elements.apiKey.placeholder = '已配置 ••••••••，留空保留';
    renderConnectionState(result);
    setConnectionStatus(`配置已保存。${result.test.message}`, result.ok ? 'ok' : 'error');
    await contentOpsUI.refreshConfig();
  } catch (error) { connectionError(error); }
  finally { connectionBusy(false); }
});
void refreshConnections().catch(connectionError);

const contentOpsUI = new ContentOpsUI({ navigate: (view, detail) => {
  if (detail?.jobId) window.dispatchEvent(new CustomEvent('content-ops:preview', { detail: { batch: contentOpsUI.batch } }));
  showView(view === 'preview' ? 'preview' : 'generate');
}, refresh: async () => {} });
mountContentOpsReferences();

showView(location.hash.slice(1) || 'generate');
void api('/healthz').catch(() => {});
