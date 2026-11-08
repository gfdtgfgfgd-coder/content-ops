import { marked } from '/node_modules/marked/lib/marked.esm.js';
import DOMPurify from '/node_modules/dompurify/dist/purify.es.mjs';
import { ContentOpsUI } from '/lib/content-ops-ui.mjs';
import { mountContentOpsReferences } from '/lib/content-ops-references.mjs';

const views = ['generate', 'references', 'rules', 'documents'];

const railResizer = document.querySelector('.rail-resizer');
const appShell = document.querySelector('#app-shell');
const railWidthKey = 'hanabi.left-rail-width';
const defaultRailWidth = 280;
const minRailWidth = 190;
const getRailBounds = () => ({ min: minRailWidth, max: Math.max(minRailWidth, Math.min(500, window.innerWidth * 0.45)) });
const clampRailWidth = width => {
  const bounds = getRailBounds();
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, width)));
};
const setRailWidth = width => {
  const value = clampRailWidth(width);
  appShell.style.setProperty('--left-rail-width', `${value}px`);
  railResizer.setAttribute('aria-valuenow', String(value));
  return value;
};
try {
  const savedRailWidth = Number.parseFloat(localStorage.getItem(railWidthKey));
  if (Number.isFinite(savedRailWidth)) setRailWidth(savedRailWidth);
} catch {}

let activeRailPointer = null;
const finishRailResize = (event, persist = true) => {
  if (activeRailPointer === null || (event && event.pointerId !== activeRailPointer)) return;
  activeRailPointer = null;
  document.body.classList.remove('is-resizing');
  if (persist) {
    try { localStorage.setItem(railWidthKey, `${parseFloat(appShell.style.getPropertyValue('--left-rail-width'))}px`); } catch {}
  }
};
railResizer.addEventListener('pointerdown', event => {
  if (window.innerWidth < 681 || event.button !== 0) return;
  activeRailPointer = event.pointerId;
  railResizer.setPointerCapture(event.pointerId);
  document.body.classList.add('is-resizing');
  event.preventDefault();
});
railResizer.addEventListener('pointermove', event => {
  if (event.pointerId === activeRailPointer) setRailWidth(event.clientX);
});
railResizer.addEventListener('pointerup', event => finishRailResize(event));
railResizer.addEventListener('pointercancel', event => finishRailResize(event));
railResizer.addEventListener('lostpointercapture', event => finishRailResize(event));
railResizer.addEventListener('dblclick', () => {
  const width = setRailWidth(defaultRailWidth);
  try { localStorage.setItem(railWidthKey, `${width}px`); } catch {}
});
railResizer.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  event.preventDefault();
  const current = parseFloat(appShell.style.getPropertyValue('--left-rail-width')) || defaultRailWidth;
  const width = setRailWidth(event.key === 'Home' ? defaultRailWidth : current + (event.key === 'ArrowRight' ? 10 : -10));
  try { localStorage.setItem(railWidthKey, `${width}px`); } catch {}
});
window.addEventListener('resize', () => {
  if (window.innerWidth < 681) finishRailResize(null, false);
  const current = parseFloat(appShell.style.getPropertyValue('--left-rail-width'));
  if (Number.isFinite(current)) setRailWidth(current);
});

const docToGroup = {
  'content-spec': 'documents',
  'persona': 'rules',
  'banned': 'rules',
  'guide': 'documents',
  'corpus': 'documents'
};

const defaultTabs = {
  rules: 'persona',
  documents: 'guide'
};

const parseRoute = (raw) => {
  const token = String(raw || '').replace(/^#/, '').trim();
  if (!token) {
    const saved = sessionStorage.getItem('hanabi.current-route');
    if (saved) return parseRoute(saved);
    return { view: 'generate', tab: null, key: 'generate' };
  }
  if (token.includes('/')) {
    const [view, tab] = token.split('/');
    if (docToGroup[tab] === view) return { view, tab, key: tab };
  }
  if (docToGroup[token]) {
    return { view: docToGroup[token], tab: token, key: token };
  }
  if (token === 'rules') {
    const tab = sessionStorage.getItem('hanabi.tab.rules') || defaultTabs.rules;
    return { view: 'rules', tab, key: tab };
  }
  if (token === 'documents') {
    const tab = sessionStorage.getItem('hanabi.tab.documents') || defaultTabs.documents;
    return { view: 'documents', tab, key: tab };
  }
  if (views.includes(token)) {
    return { view: token, tab: null, key: token };
  }
  return { view: 'generate', tab: null, key: 'generate' };
};

const saveScroll = () => {
  const route = parseRoute(location.hash.slice(1) || sessionStorage.getItem('hanabi.current-route'));
  try {
    sessionStorage.setItem(`hanabi.scroll.${route.key}`, String(window.scrollY));
  } catch {}
};

let scrollDebounce = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollDebounce);
  scrollDebounce = setTimeout(saveScroll, 60);
}, { passive: true });
window.addEventListener('beforeunload', saveScroll);

const restoreScroll = (key) => {
  const saved = sessionStorage.getItem(`hanabi.scroll.${key}`);
  if (saved != null) {
    const y = Number(saved);
    if (!Number.isNaN(y)) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: 'instant' });
      });
    }
  }
};

const showView = (name, { replace = true, restore = false } = {}) => {
  const route = parseRoute(name);
  const { view, tab, key } = route;
  const currentActivePanel = document.querySelector('.view-panel.active');
  const changed = currentActivePanel?.id !== `view-${view}`;

  for (const panel of document.querySelectorAll('.view-panel')) {
    const isTarget = panel.id === `view-${view}`;
    panel.hidden = !isTarget;
    panel.classList.toggle('active', isTarget);
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  const newHash = `#${key}`;
  if (location.hash !== newHash) {
    if (replace) history.replaceState(null, '', newHash);
    else history.pushState(null, '', newHash);
  }
  sessionStorage.setItem('hanabi.current-route', key);
  if (tab && docToGroup[tab]) {
    sessionStorage.setItem(`hanabi.tab.${docToGroup[tab]}`, tab);
  }

  document.dispatchEvent(new CustomEvent('content-ops:view', {
    detail: { view, tab, restore }
  }));

  if (restore) {
    restoreScroll(key);
  } else if (changed) {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
};
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) { event.preventDefault(); showView(button.dataset.view, { replace: false, restore: false }); }
});
window.addEventListener('popstate', () => showView(location.hash.slice(1), { replace: true, restore: true }));
window.addEventListener('hashchange', () => showView(location.hash.slice(1), { replace: true, restore: true }));

const api = async (path, options = {}) => {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
};

function mountDocumentViews() {
  const groups = [
    ['rules', '原料库', [['persona','运营偏好'], ['banned','风险词库']]],
    ['documents', '操作规范', [['content-spec','内容生产规范'], ['guide','系统操作手册'], ['corpus','模型语料库']]]
  ];
  const documentPaths = {'rules/content-spec.md':'content-spec', 'docs/GUIDE.md':'guide',
    'skills/simin-persona/SKILL.md':'persona', 'rules/banned-words-quick.yaml':'banned', 'data/model-corpus.md':'corpus'};
  const readers = new Map();
  for (const [view, title, docs] of groups) {
    const panel = document.createElement('section'); panel.className = 'view-panel'; panel.id = `view-${view}`; panel.hidden = true;
    const heading = document.createElement('h1'); heading.textContent = title;
    const syncButton = document.createElement('button'); syncButton.type='button'; syncButton.className='button button-outline'; syncButton.textContent='同步原料库'; syncButton.addEventListener('click',()=>void openSpecSync({trigger:'manual'}));
    const headingRow = document.createElement('header'); headingRow.className='doc-view-heading'; headingRow.append(heading,syncButton);
    const tabs = document.createElement('div'); tabs.className = 'doc-tabs'; tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label',title);
    const reader = document.createElement('div'); reader.className = 'document-reader';
    const toc = document.createElement('nav'); toc.className = 'document-toc'; toc.setAttribute('aria-label','文档目录');
    const article = document.createElement('article'); article.className = 'document-content'; article.setAttribute('aria-live','polite');
    reader.append(toc, article); panel.append(headingRow, tabs, reader); document.querySelector('.main-content').append(panel);
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
    if(view==='rules'){
      const editor=editors.get('persona');
      const button=syncButton.cloneNode(true);button.addEventListener('click',()=>void openSpecSync({trigger:'manual'}));
      editor.querySelector('.content-ops-editors').prepend(button);
    }
    let active = defaultTabs[view] || docs[0][0], version = 0;
    const select = async (name = active, { restore = false } = {}) => {
      active = name; const request = ++version;
      sessionStorage.setItem(`hanabi.tab.${view}`, name);
      sessionStorage.setItem('hanabi.current-route', name);
      const newHash = `#${name}`;
      if (location.hash !== newHash) {
        history.replaceState(null, '', newHash);
      }
      for (const tab of tabs.querySelectorAll('[data-doc]')) {
        const selected = tab.dataset.doc === name; tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1;
      }
      for (const [id, editor] of editors) editor.hidden = id !== name;
      reader.hidden = editors.has(name);
      if (reader.hidden) {
        void window.contentOpsEditors?.reload?.();
        if (restore) restoreScroll(name);
        return;
      }
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
        if (restore) {
          restoreScroll(name);
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
  function openDocument(name) { showView(name, { replace: false, restore: false }); }
  document.addEventListener('content-ops:view', event => {
    if (readers.has(event.detail.view)) {
      const targetDoc = event.detail.tab || sessionStorage.getItem(`hanabi.tab.${event.detail.view}`) || defaultTabs[event.detail.view];
      void readers.get(event.detail.view)(targetDoc, { restore: event.detail.restore });
    }
  });
}

mountDocumentViews();

const syncDialog=document.querySelector('#spec-sync-dialog');
let syncDraft=null;
async function openSpecSync(input){
  if(!syncDialog.open)syncDialog.showModal();
  syncDialog.querySelector('#spec-sync-status').textContent='正在调用分析模型…';
  syncDialog.querySelector('[data-spec-sync-apply]').disabled=true;
  if(input.trigger==='manual')showView('content-spec',{replace:false,restore:false});
  try{await analyzeSpec(input);}catch(error){syncDialog.querySelector('#spec-sync-status').textContent=`分析失败：${error.message}`;}
}
async function analyzeSpec(input){
  const result=await api('/api/content-ops/spec-sync/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  syncDraft=result;
  syncDialog.querySelector('#spec-sync-status').textContent='请审核差异后确认或继续调整。';
  syncDialog.querySelector('#spec-sync-summary').textContent=result.summary||'模型未提供摘要。';
  syncDialog.querySelector('#spec-sync-before').textContent=result.before;
  syncDialog.querySelector('#spec-sync-after').textContent=result.updatedContent;
  syncDialog.querySelector('[data-spec-sync-apply]').disabled=false;
}
document.addEventListener('content-ops:spec-sync',event=>void openSpecSync(event.detail));
syncDialog.querySelector('[data-spec-sync-close]').addEventListener('click',()=>{syncDraft=null;syncDialog.close();});
syncDialog.querySelector('[data-spec-sync-cancel]').addEventListener('click',()=>{syncDraft=null;syncDialog.close();});
syncDialog.querySelector('[data-spec-sync-reanalyze]').addEventListener('click',async()=>{
  if(!syncDraft)return;const feedback=syncDialog.querySelector('[name="feedback"]').value.trim();
  if(!feedback){syncDialog.querySelector('#spec-sync-status').textContent='请先填写修改建议。';return;}
  syncDialog.querySelector('[data-spec-sync-reanalyze]').disabled=true;
  try{await analyzeSpec({trigger:'manual',previousDraft:syncDraft.updatedContent,feedback});syncDialog.querySelector('[name="feedback"]').value='';}
  catch(error){syncDialog.querySelector('#spec-sync-status').textContent=`重新分析失败：${error.message}`;}
  finally{syncDialog.querySelector('[data-spec-sync-reanalyze]').disabled=false;}
});
syncDialog.querySelector('[data-spec-sync-apply]').addEventListener('click',async event=>{
  if(!syncDraft)return;const button=event.currentTarget;button.disabled=true;
  try{const saved=await api('/api/content-ops/spec-sync/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({updatedContent:syncDraft.updatedContent,revision:syncDraft.revision,summary:syncDraft.summary})});syncDialog.querySelector('#spec-sync-status').textContent=`已同步并提交 ${saved.commit}。`;showView('content-spec',{replace:false,restore:false});setTimeout(()=>{syncDraft=null;syncDialog.close();},700);}
  catch(error){syncDialog.querySelector('#spec-sync-status').textContent=`同步失败：${error.message}`;button.disabled=false;}
});

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
  fields.textModel.value = config.textModel || '';
  fields.visionModel.value = config.visionModel || '';
  fields.imageModel.value = config.imageModel || '';
  fields.analysisModel.value = config.analysisModel || '';
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

const contentOpsUI = new ContentOpsUI();
mountContentOpsReferences();

showView(location.hash.slice(1) || sessionStorage.getItem('hanabi.current-route') || 'generate', { replace: true, restore: true });
void api('/healthz').catch(() => {});
