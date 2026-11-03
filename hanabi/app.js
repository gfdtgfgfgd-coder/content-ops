import { ContentOpsUI } from '/lib/content-ops-ui.mjs';
import { mountContentOpsReferences } from '/lib/content-ops-references.mjs';

const views = ['generate', 'references', 'persona', 'banned', 'preview'];
const showView = (name) => {
  const view = views.includes(name) ? name : 'generate';
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
    card.className = 'content-ops-post';
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

const contentOpsUI = new ContentOpsUI({ navigate: (view, detail) => {
  if (detail?.jobId) window.dispatchEvent(new CustomEvent('content-ops:preview', { detail: { batch: contentOpsUI.batch } }));
  showView(view === 'preview' ? 'preview' : 'generate');
}, refresh: async () => {} });
mountContentOpsReferences();

showView(location.hash.slice(1) || 'generate');
void api('/healthz').catch(() => {});
