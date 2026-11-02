const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const keyOf = reference => `${reference.platform}:${reference.id}`;
const metric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
const platforms = new Set(['xhs', 'xianyu']);
const imagePath = value => typeof value === 'string' && /^\/api\/content-ops\/image\/(xhs|xianyu)\/[^/?#]+\/[^/?#]+$/.test(value) ? value : '';
const imageList = post => [...new Set([post.image, ...(Array.isArray(post.images) ? post.images : [])].map(imagePath).filter(Boolean))];

function normalizeReferences(value) {
  const references = Array.isArray(value) ? value : value?.references;
  return [...new Map((Array.isArray(references) ? references : []).filter(reference => reference && platforms.has(reference.platform) && reference.id != null && String(reference.id).trim()).map(reference => {
    const normalized = {platform:reference.platform, id:String(reference.id)};
    return [keyOf(normalized), normalized];
  })).values()];
}

/** File-backed reference browser; it also mounts independently of the legacy app boot. */
export class ContentOpsReferences {
  constructor({root = document.querySelector('#content-ops-references'), fetcher = (...args) => fetch(...args)} = {}) {
    if (!root) throw new Error('素材库容器不存在');
    this.root = root;
    this.fetcher = fetcher;
    this.platform = root.querySelector('#content-ops-ref-platform');
    this.sort = root.querySelector('#content-ops-ref-sort');
    this.grid = root.querySelector('#content-ops-ref-grid');
    this.pinnedGrid = root.querySelector('#content-ops-ref-pinned');
    this.status = root.querySelector('#content-ops-ref-status');
    this.totalLabel = root.querySelector('#content-ops-ref-total');
    this.progress = root.querySelector('#content-ops-ref-progress');
    this.selectionLabel = root.querySelector('#content-ops-ref-selection');
    this.clearSelection = root.querySelector('#content-ops-ref-clear');
    this.more = root.querySelector('#content-ops-ref-more');
    this.posts = [];
    this.references = [];
    this.citedKeys = new Set();
    let savedSelection = [];
    try { savedSelection = JSON.parse(sessionStorage.getItem('content-ops-reference-selection') || '[]'); } catch {}
    this.selectedReferences = normalizeReferences(savedSelection).slice(0, 8);
    this.selectedKeys = new Set(this.selectedReferences.map(keyOf));
    this.requestVersion = 0;
    this.focusVersion = 0;
    this.nextOffset = 0;
    this.total = null;
    this.loading = false;
    this.exhausted = false;
    this.platform.addEventListener('change', () => {
      this.focusVersion++;
      this.updateSortOptions();
      void this.load(true);
    });
    this.sort.addEventListener('change', () => { this.focusVersion++; void this.load(true); });
    this.more.addEventListener('click', () => void this.load());
    this.clearSelection.addEventListener('click', () => {
      this.selectedReferences = [];
      this.selectedKeys.clear();
      this.saveSelection();
      this.refreshBadges();
    });
    root.addEventListener('click', event => this.handleClick(event));
    root.addEventListener('toggle', event => {
      const disclosure = event.target;
      if (disclosure.matches?.('[data-ref-images]') && disclosure.open) this.loadExtraImages(disclosure);
      if (disclosure === root && root.open && !this.focusInProgress) this.focusFirstCited();
    }, true);
    root.addEventListener('error', event => {
      const figure = event.target.closest?.('.ref-image');
      if (!figure) return;
      event.target.hidden = true;
      figure.classList.add('ref-image--missing');
      figure.querySelector('.ref-image-error').hidden = false;
    }, true);
    // Capture also receives non-bubbling events dispatched on document.
    window.addEventListener('content-ops:references', event => this.setReferences(event.detail), true);
    window.addEventListener('content-ops:reference-focus', event => void this.focusReference(event.detail), true);
    this.updateSortOptions();
    this.refreshBadges();
    void this.load(true);
  }

  updateSortOptions() {
    const wanted = this.sort.querySelector('option[value="wanted"]');
    wanted.hidden = wanted.disabled = this.platform.value !== 'xianyu';
    if (wanted.disabled && this.sort.value === 'wanted') this.sort.value = 'best';
  }

  async load(reset = false) {
    if (!reset && (this.loading || this.exhausted)) return;
    if (reset) {
      this.controller?.abort();
      this.requestVersion++;
      this.posts = [];
      this.pinned = null;
      this.nextOffset = 0;
      this.total = null;
      this.exhausted = false;
      this.renderPinned();
      this.grid.innerHTML = '<div class="ref-loading" aria-label="正在读取素材"><span></span><span></span><span></span></div>';
    }
    const version = this.requestVersion;
    this.controller = new AbortController();
    this.loading = true;
    this.root.setAttribute('aria-busy', 'true');
    this.more.disabled = true;
    this.more.textContent = '正在加载…';
    this.status.textContent = '正在读取素材…';
    this.totalLabel.textContent = this.total == null ? '正在读取' : `${this.total} 条`;
    this.progress.textContent = this.total == null ? '' : `已显示 ${this.posts.length} / ${this.total}`;
    const query = new URLSearchParams({platform:this.platform.value, sort:this.sort.value, offset:String(this.nextOffset), limit:'30'});
    try {
      const response = await this.fetcher(`/api/content-ops/references?${query}`, {signal:this.controller.signal});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败');
      if (version !== this.requestVersion) return;
      if (!Array.isArray(data.posts) || !Number.isInteger(data.total) || data.total < 0) throw new Error('素材数据格式不完整');
      const known = new Set(this.posts.map(keyOf));
      const additions = data.posts.filter(post => platforms.has(post.platform) && post.platform === this.platform.value && post.id != null && !known.has(keyOf(post)));
      this.posts.push(...additions);
      this.total = data.total;
      this.nextOffset += data.posts.length;
      this.exhausted = this.nextOffset >= this.total || data.posts.length === 0;
      if (reset) this.grid.replaceChildren();
      this.grid.insertAdjacentHTML('beforeend', additions.map(post => this.card(post)).join(''));
      if (this.pinned && (known.has(keyOf(this.pinned)) || additions.some(post => keyOf(post) === keyOf(this.pinned)))) this.pinned = null;
      this.renderPinned();
      this.status.textContent = this.total === 0 ? '这个平台还没有可浏览的素材。' : '';
      this.totalLabel.textContent = `${this.total} 条`;
      this.progress.textContent = `已显示 ${this.posts.length} / ${this.total}`;
    } catch (error) {
      if (version !== this.requestVersion || error.name === 'AbortError') return;
      if (reset) this.grid.replaceChildren();
      this.status.replaceChildren(document.createTextNode(`素材读取失败：${error.message}。`));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'ref-text-button';
      retry.textContent = '重试';
      retry.addEventListener('click', () => void this.load(reset));
      this.status.append(retry);
      if (this.total == null) this.totalLabel.textContent = '读取失败';
    } finally {
      if (version === this.requestVersion) {
        this.loading = false;
        this.root.setAttribute('aria-busy', 'false');
        this.more.disabled = false;
        this.more.hidden = this.total == null || this.exhausted;
        this.more.textContent = '加载更多 · 30 条';
      }
    }
  }

  image(source, title, index = 0) {
    return `<figure class="ref-image"><img src="${esc(source)}" loading="lazy" decoding="async" width="360" height="480" alt="${esc(title || '素材')} · 第 ${index + 1} 张"><figcaption class="ref-image-error" hidden>本机图片缺失或无法读取</figcaption></figure>`;
  }

  badges(post) {
    const hits = (Array.isArray(post.banned_word_hits) ? post.banned_word_hits : []).map(hit => typeof hit === 'string' ? hit : hit?.word || hit?.term || hit?.pattern || hit?.id || '').filter(Boolean);
    const cited = this.citedKeys.has(keyOf(post));
    const selected = this.selectedKeys.has(keyOf(post));
    return `${post.label_good === true ? '<span class="ref-badge-good">✅ 精选</span>' : ''}${hits.length ? `<span class="ref-badge-warn">⚠️ 含禁词：${esc([...new Set(hits)].join('、'))}</span>` : ''}${cited ? '<span class="ref-badge-cited">本批已引用</span>' : ''}${selected ? '<span class="ref-badge-selected">下批待引用</span>' : ''}`;
  }

  card(post) {
    const images = imageList(post);
    const body = String(post.body_full ?? post.body_preview ?? '');
    const preview = String(post.body_preview ?? [...body].slice(0, 300).join(''));
    const cited = this.citedKeys.has(keyOf(post));
    const tags = Array.isArray(post.tags) ? post.tags.join(' ') : '';
    const numbers = post.metrics || {};
    return `<article class="ref-card${post.label_good === true ? ' ref-card--good' : ''}${cited ? ' ref-card--cited' : ''}${post.banned_word_hits?.length ? ' ref-card--warned' : ''}" data-id="${esc(post.id)}" data-platform="${esc(post.platform)}" data-cited="${cited}" tabindex="-1">
      <div class="ref-media">${images.length ? this.image(images[0], post.title) : '<div class="ref-image ref-image--missing"><p>本机暂无图片</p></div>'}${images.length > 1 ? `<details class="ref-images" data-ref-images><summary>查看其余 ${images.length - 1} 张图片</summary><div class="ref-extra-images"></div></details>` : ''}</div>
      <div class="ref-body">
        <div class="ref-badges">${this.badges(post)}</div>
        <h2 class="ref-title">${esc(post.title || '无标题')}</h2>
        <button class="ref-text-button" type="button" data-ref-select aria-pressed="${this.selectedKeys.has(keyOf(post))}">${this.selectedKeys.has(keyOf(post)) ? '移出下一批引用' : '引用到下一批'}</button>
        <dl class="ref-facts"><div><dt>模型</dt><dd>${esc(post.model || '—')}</dd></div><div><dt>互动层级</dt><dd>${esc(post.engagement_tier || '—')}</dd></div><div><dt>采集时间</dt><dd>${esc(post.fetched_at || '—')}</dd></div><div><dt>参考状态</dt><dd>${post.clean_for_style_reference === true ? '可用于风格参考' : post.clean_for_style_reference === false ? '需先核对风险' : '—'}</dd></div></dl>
        <section class="ref-copy-section"><h3>封面文字</h3><p class="ref-ocr">${esc(post.cover_ocr || '—')}</p></section>
        <section class="ref-copy-section"><h3>正文</h3><p class="ref-text">${esc(preview || '—')}</p>${body !== preview ? '<button class="ref-text-button ref-expand" type="button" data-ref-expand aria-expanded="false">展开全文</button>' : ''}</section>
        <p class="ref-tags">${esc(tags || '标签：—')}</p>
        <dl class="ref-metrics">${(post.platform === 'xianyu' ? [['想要',numbers.wants]] : [['点赞',numbers.likes],['收藏',numbers.collects],['评论',numbers.comments]]).map(([label,value]) => `<div><dt>${label}</dt><dd>${metric(value)}</dd></div>`).join('')}</dl>
      </div>
    </article>`;
  }

  findPost(card) {
    return [...this.posts, ...(this.pinned ? [this.pinned] : [])].find(post => post.platform === card.dataset.platform && String(post.id) === card.dataset.id);
  }

  handleClick(event) {
    const select = event.target.closest('[data-ref-select]');
    if (select) {
      const card = select.closest('.ref-card');
      const reference = {platform:card.dataset.platform,id:card.dataset.id};
      const key = keyOf(reference);
      if (this.selectedKeys.has(key)) {
        this.selectedKeys.delete(key);
        this.selectedReferences = this.selectedReferences.filter(item => keyOf(item) !== key);
      } else if (this.selectedReferences.length >= 8) {
        this.status.textContent = '一批最多选择 8 条参考帖。';
        return;
      } else {
        this.selectedKeys.add(key);
        this.selectedReferences.push(reference);
      }
      this.saveSelection();
      this.refreshBadges();
      return;
    }
    const button = event.target.closest('[data-ref-expand]');
    if (!button) return;
    const card = button.closest('.ref-card');
    const post = this.findPost(card);
    if (!post) return;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? '收起全文' : '展开全文';
    const preview = post.body_preview ?? [...String(post.body_full || '')].slice(0, 300).join('');
    card.querySelector('.ref-text').textContent = (expanded ? post.body_full ?? preview : preview) || '—';
  }

  saveSelection() {
    try { sessionStorage.setItem('content-ops-reference-selection', JSON.stringify(this.selectedReferences)); } catch {}
  }

  getSelection() { return this.selectedReferences.map(({platform,id}) => ({platform,id})); }

  refreshBadges() {
    for (const card of this.root.querySelectorAll('.ref-card')) {
      const post = this.findPost(card);
      if (!post) continue;
      const selected = this.selectedKeys.has(keyOf(post));
      const button = card.querySelector('[data-ref-select]');
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? '移出下一批引用' : '引用到下一批';
      card.querySelector('.ref-badges').innerHTML = this.badges(post);
    }
    this.selectionLabel.textContent = this.selectedReferences.length ? `下批引用 ${this.selectedReferences.length} 条` : '';
    this.clearSelection.hidden = !this.selectedReferences.length;
    window.dispatchEvent(new CustomEvent('content-ops:reference-selection',{detail:{references:this.getSelection()}}));
  }

  loadExtraImages(disclosure) {
    if (disclosure.dataset.loaded) return;
    const post = this.findPost(disclosure.closest('.ref-card'));
    if (!post) return;
    disclosure.querySelector('.ref-extra-images').innerHTML = imageList(post).slice(1).map((source,index) => this.image(source,post.title,index+1)).join('');
    disclosure.dataset.loaded = 'true';
  }

  setReferences(references) {
    this.references = normalizeReferences(references);
    this.citedKeys = new Set(this.references.map(keyOf));
    for (const card of this.root.querySelectorAll('.ref-card')) {
      const cited = this.citedKeys.has(`${card.dataset.platform}:${card.dataset.id}`);
      card.classList.toggle('ref-card--cited', cited);
      card.dataset.cited = String(cited);
      const post = this.findPost(card);
      if (post) card.querySelector('.ref-badges').innerHTML = this.badges(post);
    }
  }

  focusFirstCited() {
    const reference = this.references.find(item => item.platform === this.platform.value) || this.references[0];
    if (reference) void this.focusReference(reference);
  }

  renderPinned() {
    this.pinnedGrid.hidden = !this.pinned;
    this.pinnedGrid.innerHTML = this.pinned ? `<p class="ref-pin-label">定位的参考帖 · 下方列表保持当前排序</p>${this.card(this.pinned)}` : '';
  }

  async focusReference(reference) {
    const target = normalizeReferences([reference])[0];
    if (!target) return false;
    const focusVersion = ++this.focusVersion;
    this.focusInProgress = true;
    this.root.open = true;
    document.querySelector('[data-view="caihuo"]')?.click();
    try {
      if (target.platform !== this.platform.value) {
        this.platform.value = target.platform;
        this.updateSortOptions();
        await this.load(true);
      }
      if (focusVersion !== this.focusVersion) return false;
      let card = [...this.root.querySelectorAll('.ref-card')].find(item => item.dataset.platform === target.platform && item.dataset.id === target.id);
      if (!card) {
        const version = this.requestVersion;
        const query = new URLSearchParams({platform:target.platform, ids:target.id, limit:'1'});
        const response = await this.fetcher(`/api/content-ops/references?${query}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '请求失败');
        if (version !== this.requestVersion || focusVersion !== this.focusVersion) return false;
        const post = data.posts?.find(item => keyOf(item) === keyOf(target));
        if (!post) throw new Error('这个引用在当前素材库中不存在');
        // A targeted lookup must not advance the main list's pagination offset.
        this.pinned = post;
        this.renderPinned();
        card = this.pinnedGrid.querySelector('.ref-card');
      }
      this.status.textContent = '';
      card.focus({preventScroll:true});
      card.scrollIntoView({block:'start', behavior:'instant'});
      return true;
    } catch (error) {
      if (focusVersion === this.focusVersion) this.status.textContent = `参考帖定位失败：${error.message}。`;
      return false;
    } finally {
      if (focusVersion === this.focusVersion) this.focusInProgress = false;
    }
  }
}

const instances = new WeakMap();
export function mountContentOpsReferences() {
  const root = document.querySelector('#content-ops-references');
  if (!root) return null;
  if (!instances.has(root)) instances.set(root, new ContentOpsReferences({root}));
  window.contentOpsReferences = instances.get(root);
  return instances.get(root);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountContentOpsReferences, {once:true});
  else mountContentOpsReferences();
}
