const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const keyOf = reference => `${reference.platform}:${reference.id}`;
const metric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—';
const modelOptions = [['GLM','GLM'],['Kimi','Kimi'],['Seedance/视频','Seedance/视频'],['其他','其他']];
const layoutOptions = [['bold_typo','撞色大字报'],['code_ide','极客代码屏'],['card_3d','3D卡片流程'],['comparison','痛点对比'],['other','通用日常']];
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
    this.modelCategory = this.addFilter('模型分类', 'model_category', [['all','全部模型'],...modelOptions]);
    this.layoutStyle = this.addFilter('版式流派', 'layout_style', [['all','全部版式'],...layoutOptions]);
    try {
      const savedFilters = JSON.parse(sessionStorage.getItem('content-ops-reference-filters') || '{}');
      if (savedFilters.platform && platforms.has(savedFilters.platform)) {
        this.platform.value = savedFilters.platform;
        this.updateSortOptions();
      }
      if (savedFilters.sort && this.sort.querySelector(`option[value="${savedFilters.sort}"]`)) this.sort.value = savedFilters.sort;
      if (savedFilters.modelCategory && this.modelCategory.querySelector(`option[value="${savedFilters.modelCategory}"]`)) this.modelCategory.value = savedFilters.modelCategory;
      if (savedFilters.layoutStyle && this.layoutStyle.querySelector(`option[value="${savedFilters.layoutStyle}"]`)) this.layoutStyle.value = savedFilters.layoutStyle;
    } catch {}
    const saveFilters = () => {
      try {
        sessionStorage.setItem('content-ops-reference-filters', JSON.stringify({
          platform: this.platform.value,
          sort: this.sort.value,
          modelCategory: this.modelCategory.value,
          layoutStyle: this.layoutStyle.value
        }));
      } catch {}
    };
    this.platform.addEventListener('change', saveFilters);
    this.sort.addEventListener('change', saveFilters);
    this.modelCategory.addEventListener('change', saveFilters);
    this.layoutStyle.addEventListener('change', saveFilters);
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
    this.mountEditor();
    this.platform.addEventListener('change', () => {
      this.focusVersion++;
      this.updateSortOptions();
      void this.load(true);
    });
    this.sort.addEventListener('change', () => { this.focusVersion++; void this.load(true); });
    for (const filter of [this.modelCategory,this.layoutStyle]) filter.addEventListener('change',()=>{this.focusVersion++;void this.load(true);});
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

  addFilter(labelText, name, options) {
    const label=document.createElement('label');label.append(document.createTextNode(labelText));
    const select=document.createElement('select');select.id=`content-ops-ref-${name}`;
    for(const [value,title] of options){const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}
    label.append(select);this.root.querySelector('.ref-toolbar').insertBefore(label,this.root.querySelector('#content-ops-ref-total'));return select;
  }

  mountEditor() {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ref-button ref-add'; button.textContent = '➕ 添加素材';
    this.root.querySelector('.ref-toolbar').append(button);
    button.addEventListener('click', () => this.openEditor());
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'ref-editor'; this.dialog.setAttribute('aria-labelledby', 'ref-editor-title');
    const options = rows => rows.map(([value,label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    this.dialog.innerHTML = `<form class="ref-editor-form">
      <header><h2 id="ref-editor-title">添加素材</h2><button type="button" class="ref-text-button" data-ref-close aria-label="关闭素材编辑器">关闭</button></header>
      <label>平台<select name="platform">${options([['xhs','小红书'],['xianyu','闲鱼']])}</select></label>
      <div class="ref-upload" tabindex="0" role="button" aria-label="选择或拖拽封面图片" data-ref-drop><strong>封面图片（选填）</strong><span>点击选择或拖拽一张 PNG / JPEG / WebP，最大 15MB</span><input type="file" name="upload" accept="image/png,image/jpeg,image/webp" hidden></div>
      <div class="ref-editor-preview" hidden><img alt="封面预览"><button type="button" class="ref-text-button" data-ref-remove>移除图片</button><span data-ref-image-note></span></div>
      <label>标题（选填）<input name="title" maxlength="200000"></label>
      <label>正文内容（选填）<textarea name="body" rows="6" maxlength="200000"></textarea></label>
      <label>封面字样 / OCR（选填）<textarea name="cover_ocr" rows="2" maxlength="200000"></textarea></label>
      <label>模型 / 型号（选填）<input name="model" maxlength="200000"></label>
      <div class="ref-editor-columns"><label>模型分类<select name="model_category">${options(modelOptions)}</select></label><label>版式流派<select name="layout_style">${options(layoutOptions)}</select></label></div>
      <label class="ref-editor-good"><input type="checkbox" name="good">设为精选</label>
      <p class="ref-editor-status" role="status" aria-live="polite"></p>
      <footer><button type="button" class="ref-button" data-ref-close>取消</button><button type="submit" class="ref-button ref-add">保存素材</button></footer>
    </form>`;
    this.root.append(this.dialog);
    this.form = this.dialog.querySelector('form');
    this.editorStatus = this.dialog.querySelector('.ref-editor-status');
    this.preview = this.dialog.querySelector('.ref-editor-preview');
    this.dialog.querySelectorAll('[data-ref-close]').forEach(close => close.addEventListener('click', () => { if (!this.mutating) this.dialog.close(); }));
    this.dialog.addEventListener('cancel', event => { if (this.mutating) event.preventDefault(); });
    this.form.addEventListener('submit', event => { event.preventDefault(); void this.saveEditor(); });
    this.form.elements.upload.addEventListener('click', event => event.stopPropagation());
    this.form.elements.upload.addEventListener('change', event => void this.chooseImage(event.target.files));
    const drop = this.dialog.querySelector('[data-ref-drop]');
    drop.addEventListener('click', () => { if (!this.mutating) this.form.elements.upload.click(); });
    drop.addEventListener('keydown', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); drop.click(); } });
    for (const name of ['dragover','dragleave','drop']) drop.addEventListener(name, event => {
      event.preventDefault(); drop.classList.toggle('ref-upload--active', name === 'dragover');
      if (name === 'drop' && !this.mutating) void this.chooseImage(event.dataTransfer.files);
    });
    this.dialog.querySelector('[data-ref-remove]').addEventListener('click', () => {
      if (this.mutating) return;
      this.imageVersion++; this.readingImage = false; this.editorImage = null; this.hasImage = false;
      this.form.elements.upload.value = ''; this.showPreview('');
    });
  }

  openEditor(post = null) {
    if (this.mutating) return;
    this.editing = post; this.form.reset(); this.editorStatus.textContent = '';
    this.dialog.querySelector('h2').textContent = post ? '编辑素材' : '添加素材';
    this.form.elements.platform.value = post?.platform || this.platform.value;
    for (const name of ['title','cover_ocr','model']) this.form.elements[name].value = post?.[name] || '';
    this.form.elements.body.value = post?.body_full || '';
    this.form.elements.model_category.value = post?.model_category || '其他';
    this.form.elements.layout_style.value = post?.layout_style || 'other';
    this.form.elements.good.checked = post?.label_good === true;
    this.editorImage = undefined; this.hasImage = Boolean(post && imageList(post).length);
    this.imageVersion = (this.imageVersion || 0) + 1; this.readingImage = false;
    this.showPreview(post ? imageList(post)[0] : '');
    this.dialog.showModal();
  }

  showPreview(source) {
    this.preview.hidden = !source;
    const image = this.preview.querySelector('img');
    if (source) image.src = source; else image.removeAttribute('src');
    const count = this.editorImage === undefined && this.editing ? imageList(this.editing).length : 1;
    this.preview.querySelector('[data-ref-image-note]').textContent = count > 1 ? `共 ${count} 张；上传会替换封面，移除会删除全部图片` : '';
  }

  async chooseImage(files) {
    if (files.length !== 1) { this.editorStatus.textContent = '请选择一张封面图片。'; return; }
    const file = files[0], version = ++this.imageVersion;
    this.readingImage = false;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      this.editorStatus.textContent = '仅支持 PNG / JPEG / WebP，图片不能超过 15MB。'; return;
    }
    this.readingImage = true; this.editorStatus.textContent = '正在读取图片…';
    try {
      const source = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败，请重新选择。')); reader.readAsDataURL(file); });
      if (version !== this.imageVersion) return;
      this.editorImage = source; this.hasImage = true; this.showPreview(source); this.editorStatus.textContent = '';
    } catch (error) { if (version === this.imageVersion) this.editorStatus.textContent = error.message; }
    finally { if (version === this.imageVersion) this.readingImage = false; }
  }

  async mutationRequest(path, payload) {
    const response = await this.fetcher(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '保存失败，请稍后重试。');
    return data;
  }

  reconcileSelection(old, replacement) {
    if (!old) return;
    this.selectedReferences = this.selectedReferences.flatMap(reference => keyOf(reference) === keyOf(old) ? replacement ? [{id:replacement.id,platform:replacement.platform}] : [] : [reference]);
    this.selectedKeys = new Set(this.selectedReferences.map(keyOf));
    this.saveSelection(); this.refreshBadges();
  }

  async refreshAfterMutation(message) {
    const count = this.posts.length;
    await this.load(true);
    const version = this.requestVersion;
    while (!this.loadError && !this.exhausted && this.posts.length < count && version === this.requestVersion) await this.load();
    if (!this.loadError) this.status.textContent = message;
  }

  async saveEditor() {
    if (this.mutating || this.readingImage) { this.editorStatus.textContent = '请等待当前操作完成。'; return; }
    const payload = {};
    for (const name of ['platform','title','body','cover_ocr','model','model_category','layout_style']) payload[name] = this.form.elements[name].value;
    payload.label = {good:this.form.elements.good.checked};
    if (!this.hasImage && !payload.title.trim() && !payload.body.trim()) { this.editorStatus.textContent = '请至少提供图片、标题或正文中的一项。'; return; }
    if (this.editorImage !== undefined) payload.image = this.editorImage;
    const old = this.editing;
    this.mutating = true; this.form.querySelectorAll('button,input,textarea,select').forEach(element => element.disabled = true);
    this.editorStatus.textContent = '正在保存…';
    try {
      const data = await this.mutationRequest(`/api/content-ops/references${old ? `/${encodeURIComponent(old.id)}/edit` : ''}`, payload);
      this.reconcileSelection(old, data.reference); this.dialog.close();
      await this.refreshAfterMutation('素材已保存；列表已按当前筛选与排序更新。');
    } catch (error) { this.editorStatus.textContent = error.message; }
    finally { this.mutating = false; this.form.querySelectorAll('button,input,textarea,select').forEach(element => element.disabled = false); }
  }

  async deletePost(post) {
    if (!window.confirm('确定要删除该素材吗？')) return;
    this.mutating = true;
    try {
      await this.mutationRequest(`/api/content-ops/references/${encodeURIComponent(post.id)}/delete`, {});
      this.reconcileSelection(post, null);
      await this.refreshAfterMutation('素材及本地图片已删除。');
    } catch (error) { this.status.textContent = `删除失败：${error.message}`; }
    finally { this.mutating = false; }
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
    this.loadError = false;
    this.root.setAttribute('aria-busy', 'true');
    this.more.disabled = true;
    this.more.textContent = '正在加载…';
    this.status.textContent = '正在读取素材…';
    this.totalLabel.textContent = this.total == null ? '正在读取' : `${this.total} 条`;
    this.progress.textContent = this.total == null ? '' : `已显示 ${this.posts.length} / ${this.total}`;
    const query = new URLSearchParams({platform:this.platform.value, sort:this.sort.value, model_category:this.modelCategory.value, layout_style:this.layoutStyle.value, offset:String(this.nextOffset), limit:'30'});
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
      this.status.textContent = this.total === 0 ? '当前筛选组合没有匹配素材，请调整模型或版式。' : '版式优先使用人工标注，未标注时按封面 OCR 与标题推断。';
      this.totalLabel.textContent = `${this.total} 条`;
      this.progress.textContent = `已显示 ${this.posts.length} / ${this.total}`;
    } catch (error) {
      if (version !== this.requestVersion || error.name === 'AbortError') return;
      this.loadError = true;
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
        <button class="ref-text-button" type="button" data-ref-edit>编辑</button><button class="ref-text-button ref-delete" type="button" data-ref-delete>删除</button>
        <dl class="ref-facts"><div><dt>模型</dt><dd>${esc(post.model || post.model_category || '—')}</dd></div><div><dt>版式</dt><dd>${esc(Object.fromEntries(layoutOptions)[post.layout_style] || '通用日常')}（${post.classification_method === 'manual' ? '人工标注' : '自动推断'}）</dd></div><div><dt>互动层级</dt><dd>${esc(post.engagement_tier || '—')}</dd></div><div><dt>采集时间</dt><dd>${esc(post.fetched_at || '—')}</dd></div><div><dt>参考状态</dt><dd>${post.clean_for_style_reference === true ? '可用于风格参考' : post.clean_for_style_reference === false ? '需先核对风险' : '—'}</dd></div></dl>
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
    const action = event.target.closest('[data-ref-edit],[data-ref-delete]');
    if (action) {
      const post = this.findPost(action.closest('.ref-card'));
      if (!post || this.mutating) return;
      if (action.hasAttribute('data-ref-edit')) this.openEditor(post);
      else void this.deletePost(post);
      return;
    }
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
    document.querySelector('[data-view="references"]')?.click();
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
