import { promptUI } from './content-ops-prompt-ui.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const dateLabel = value => !value ? '未知' : /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '未知';
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
    this.model = root.querySelector('#content-ops-ref-model');
    this.collection = root.querySelector('#content-ops-ref-collection');
    this.viewModeButton = root.querySelector('#content-ops-ref-view-mode');
    this.manageCollections = root.querySelector('#content-ops-ref-manage-collections');
    this.collections = [];
    this.collectionFilterPreference = 'all';
    this.modelFilterPreference = 'all';
    this.viewMode = 'expanded';
    const modelOptions = new Set([...this.model?.options || []].map(option => option.value));
    try {
      const savedFilters = JSON.parse(sessionStorage.getItem('content-ops-reference-filters') || '{}');
      if (savedFilters.platform && ['all', ...platforms].includes(savedFilters.platform)) {
        this.platform.value = savedFilters.platform;
      }
      if (savedFilters.modelCategory && modelOptions.has(String(savedFilters.modelCategory))) {
        this.model.value = String(savedFilters.modelCategory);
        this.modelFilterPreference = this.model.value;
      }
      if (savedFilters.collectionId) this.collectionFilterPreference = String(savedFilters.collectionId);
    } catch {}
    try {
      if (sessionStorage.getItem('content-ops-ref-view-mode') === 'collapsed') this.viewMode = 'collapsed';
    } catch {}
    const saveFilters = () => {
      this.collectionFilterPreference = this.collection.value;
      this.modelFilterPreference = this.model?.value || 'all';
      try {
        sessionStorage.setItem('content-ops-reference-filters', JSON.stringify({
          platform: this.platform.value,
          modelCategory: this.model?.value || 'all',
          collectionId: this.collection.value
        }));
      } catch {}
    };
    this.platform.addEventListener('change', saveFilters);
    this.model?.addEventListener('change', saveFilters);
    this.collection.addEventListener('change', saveFilters);
    this.grid = root.querySelector('#content-ops-ref-grid');
    this.pinnedGrid = root.querySelector('#content-ops-ref-pinned');
    this.status = root.querySelector('#content-ops-ref-status');
    this.totalLabel = root.querySelector('#content-ops-ref-total');
    this.progress = root.querySelector('#content-ops-ref-progress');
    this.selectionLabel = root.querySelector('#content-ops-ref-selection');
    this.clearSelection = root.querySelector('#content-ops-ref-clear');
    this.posts = [];
    this.references = [];
    let savedSelection = [];
    try { savedSelection = JSON.parse(sessionStorage.getItem('content-ops-reference-selection') || '[]'); } catch {}
    this.selectedReferences = normalizeReferences(savedSelection).slice(0, 8);
    this.selectedKeys = new Set(this.selectedReferences.map(keyOf));
    this.requestVersion = 0;
    this.focusVersion = 0;
    this.total = null;
    this.loading = false;
    this.draggedKey = null;
    this.dropTarget = null;
    this.expandedOutlineKeys = new Set();
    this.collapsedCardKeys = new Set();
    this.collectionsDialog = document.querySelector('#content-ops-collections-dialog');
    this.collectionForm = document.querySelector('#content-ops-collections-form');
    this.collectionList = document.querySelector('#content-ops-collection-list');
    this.collectionStatus = document.querySelector('#content-ops-collections-status');
    this.collectionCancel = this.collectionForm?.querySelector('[data-ref-collection-cancel]');
    this.mountEditor();
    this.applyViewMode();
    this.platform.addEventListener('change', () => {
      this.focusVersion++;
      void this.load(true);
    });
    this.model?.addEventListener('change', () => { this.focusVersion++; void this.load(true); });
    this.collection.addEventListener('change', () => { this.focusVersion++; void this.load(true); });
    this.manageCollections.addEventListener('click', () => this.openCollectionsDialog());
    this.collectionForm?.addEventListener('submit', event => void this.saveCollection(event));
    this.collectionForm?.querySelectorAll('[data-ref-collections-close]').forEach(button => button.addEventListener('click', () => { if (!this.mutating) this.collectionsDialog.close(); }));
    this.collectionCancel?.addEventListener('click', () => this.resetCollectionForm());
    this.collectionList?.addEventListener('click', event => {
      const edit = event.target.closest('[data-ref-collection-edit]'), remove = event.target.closest('[data-ref-collection-delete]');
      if (edit) this.editCollection(edit.dataset.refCollectionEdit);
      if (remove) void this.removeCollection(remove.dataset.refCollectionDelete);
    });
    this.viewModeButton?.addEventListener('click', () => this.toggleViewMode());
    this.clearSelection.addEventListener('click', () => {
      this.clearSelectionNow();
    });
    root.querySelector('#content-ops-ref-generate')?.addEventListener('click', () => document.querySelector('[data-view="generate"]')?.click());
    root.addEventListener('click', event => this.handleClick(event));
    root.addEventListener('dragstart', event => this.handleDragStart(event));
    root.addEventListener('dragover', event => this.handleDragOver(event));
    root.addEventListener('dragenter', event => this.handleDragEnter(event));
    root.addEventListener('dragleave', event => this.handleDragLeave(event));
    root.addEventListener('drop', event => void this.handleDrop(event));
    root.addEventListener('dragend', event => this.handleDragEnd(event));
    root.addEventListener('change', event => {
      const select = event.target.closest?.('[data-ref-collection]');
      if (!select) return;
      const post = this.findPost(select.closest('.ref-card'));
      const value = select.value;
      select.value = '';
      if (post && value) void this.assignCollection(post, value);
    });
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
      const open=figure.querySelector('[data-ref-prompt]');if(open)open.disabled=true;
      figure.querySelector('.ref-image-error').hidden = false;
    }, true);
    // Capture also receives non-bubbling events dispatched on document.
    window.addEventListener('content-ops:reference-focus', event => void this.focusReference(event.detail), true);
    this.refreshBadges();
    void this.initialize();
  }

  async initialize() {
    try { await this.loadCollections(); } catch (error) { this.status.textContent = `合集读取失败：${error.message}。`; }
    void this.load(true);
  }

  applyViewMode() {
    const collapsed = this.viewMode === 'collapsed';
    for (const grid of [this.grid, this.pinnedGrid]) {
      grid?.classList.toggle('ref-grid--collapsed', collapsed);
      grid?.querySelectorAll('.ref-card').forEach(card => this.applyCardViewMode(card));
    }
    if (this.viewModeButton) {
      this.viewModeButton.textContent = collapsed ? '📖 展开图文' : '📋 仅看标题';
      this.viewModeButton.setAttribute('aria-pressed', String(collapsed));
    }
  }

  isCardCollapsed(key) {
    return this.viewMode === 'collapsed' ? !this.expandedOutlineKeys.has(key) : this.collapsedCardKeys.has(key);
  }

  applyCardViewMode(card) {
    const collapsed = this.isCardCollapsed(keyOf(card.dataset));
    card.classList.toggle('ref-card--collapsed', collapsed);
    card.classList.toggle('ref-card--outline-open', !collapsed && this.viewMode === 'collapsed');
    const button = card.querySelector('[data-ref-outline-expand]');
    if (button) {
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? '展开图文' : '收起图文');
      button.title = collapsed ? '展开图文' : '收起图文';
      button.textContent = collapsed ? '▸' : '▾';
    }
  }

  toggleViewMode() {
    this.expandedOutlineKeys.clear();
    this.collapsedCardKeys.clear();
    this.viewMode = this.viewMode === 'collapsed' ? 'expanded' : 'collapsed';
    try { sessionStorage.setItem('content-ops-ref-view-mode', this.viewMode); } catch {}
    this.applyViewMode();
  }

  async collectionRequest(path, method = 'GET', payload) {
    const options = {method, headers:{'Content-Type':'application/json'}};
    if (payload !== undefined) options.body = JSON.stringify(payload);
    const response = await this.fetcher(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '合集操作失败，请稍后重试。');
    return data;
  }

  async loadCollections() {
    const data = await this.collectionRequest('/api/content-ops/collections');
    this.collections = Array.isArray(data.collections) ? data.collections : [];
    this.renderCollectionFilter();
    this.renderCollectionList();
  }

  renderCollectionFilter() {
    const selected = this.collectionFilterPreference || this.collection.value;
    this.collection.replaceChildren(new Option('全部合集', 'all'), new Option('未分类', 'uncategorized'));
    for (const item of this.collections) this.collection.append(new Option(item.name, item.id));
    this.collection.value = [...this.collection.options].some(option => option.value === selected) ? selected : 'all';
    this.collectionFilterPreference = this.collection.value;
  }

  renderCollectionList() {
    if (!this.collectionList) return;
    this.collectionList.innerHTML = this.collections.length ? this.collections.map(item => `<div class="ref-collection-row"><div><strong>${esc(item.name)}</strong><span>${item.reference_ids.length} 条素材</span></div><div><button class="button button-outline" type="button" data-ref-collection-edit="${esc(item.id)}">改名</button><button class="button button-outline ref-delete" type="button" data-ref-collection-delete="${esc(item.id)}">删除</button></div></div>`).join('') : '<p class="ref-collection-empty">还没有自定义合集。</p>';
  }

  resetCollectionForm() {
    this.collectionForm.reset();
    this.collectionForm.elements.id.value = '';
    this.collectionForm.querySelector('[type="submit"]').textContent = '新建合集';
    this.collectionCancel.hidden = true;
  }

  openCollectionsDialog() {
    this.resetCollectionForm();
    this.collectionStatus.textContent = '';
    this.collectionsDialog.showModal();
  }

  editCollection(id) {
    const item = this.collections.find(collection => collection.id === id);
    if (!item) return;
    this.collectionForm.elements.id.value = item.id;
    this.collectionForm.elements.name.value = item.name;
    this.collectionForm.querySelector('[type="submit"]').textContent = '保存修改';
    this.collectionCancel.hidden = false;
    this.collectionForm.elements.name.focus();
  }

  async saveCollection(event) {
    event.preventDefault();
    if (this.pendingOrder || this.orderSavePromise) await this.persistOrder();
    if (this.mutating) return;
    const id = this.collectionForm.elements.id.value, name = this.collectionForm.elements.name.value.trim();
    this.mutating = true; this.collectionStatus.textContent = '正在保存…';
    try {
      await this.collectionRequest(id ? `/api/content-ops/collections/${encodeURIComponent(id)}` : '/api/content-ops/collections', id ? 'PUT' : 'POST', {name});
      await this.loadCollections(); this.resetCollectionForm(); this.collectionStatus.textContent = id ? '合集名称已更新。' : '合集已创建。';
      await this.load(true);
    } catch (error) { this.collectionStatus.textContent = error.message; }
    finally { this.mutating = false; }
  }

  async removeCollection(id) {
    if (this.pendingOrder || this.orderSavePromise) await this.persistOrder();
    const item = this.collections.find(collection => collection.id === id);
    if (!item || !window.confirm(`确定删除合集“${item.name}”吗？其中的素材不会被删除。`)) return;
    this.mutating = true; this.collectionStatus.textContent = '正在删除…';
    try {
      await this.collectionRequest(`/api/content-ops/collections/${encodeURIComponent(id)}`, 'DELETE');
      const active = this.collection.value === id;
      await this.loadCollections();
      if (active) this.collection.value = 'all';
      this.collectionStatus.textContent = '合集已删除，素材已回到未分类。';
      await this.load(true);
    } catch (error) { this.collectionStatus.textContent = error.message; }
    finally { this.mutating = false; }
  }

  async assignCollection(post, collectionId) {
    if (this.mutating || this.loading) return;
    if (this.pendingOrder || this.orderSavePromise) await this.persistOrder();
    if (this.mutating) return;
    const key = `${post.platform}:${post.id}`;
    this.mutating = true;
    try {
      const updates = this.collections.map(item => ({...item, reference_ids:[...(item.reference_ids || [])]}));
      if (collectionId === 'uncategorized') {
        for (const item of updates) item.reference_ids = item.reference_ids.filter(referenceId => referenceId !== key);
      } else {
        const target = updates.find(item => item.id === collectionId);
        if (!target) return;
        target.reference_ids = target.reference_ids.includes(key)
          ? target.reference_ids.filter(referenceId => referenceId !== key)
          : [...new Set([...target.reference_ids, key])];
      }
      for (const item of updates) {
        const current = this.collections.find(collection => collection.id === item.id);
        if (JSON.stringify(current.reference_ids) !== JSON.stringify(item.reference_ids)) await this.collectionRequest(`/api/content-ops/collections/${encodeURIComponent(item.id)}`, 'PUT', {reference_ids:item.reference_ids});
      }
      await this.loadCollections();
      this.refreshCollectionMembership();
      this.showSavedStatus(collectionId === 'uncategorized' ? '素材已移出全部合集。' : '素材合集归属已更新。');
    } catch (error) { this.status.textContent = `合集更新失败：${error.message}`; }
    finally { this.mutating = false; }
  }

  refreshCollectionMembership() {
    for (const post of [...this.posts, ...(this.pinned ? [this.pinned] : [])]) {
      const memberships = this.collections.filter(item => item.reference_ids.includes(keyOf(post)));
      post.collection_ids = memberships.map(item => item.id);
      post.collection_names = memberships.map(item => item.name);
    }
    const filter = this.collection.value;
    const removed = new Set(this.posts.filter(post => filter === 'uncategorized'
      ? post.collection_ids.length > 0
      : filter !== 'all' && !post.collection_ids.includes(filter)).map(keyOf));
    this.updateListInPlace(() => {
      this.posts = this.posts.filter(post => !removed.has(keyOf(post)));
      for (const card of [...this.grid.children]) {
        if (removed.has(keyOf(card.dataset))) card.remove();
      }
      for (const card of this.root.querySelectorAll('.ref-card')) {
        const post = this.findPost(card);
        if (!post) continue;
        card.querySelector('.ref-outline-badges').innerHTML = this.badges(post);
        card.querySelector('[data-ref-collection]').innerHTML = this.collectionOptions(post);
      }
      this.total = this.posts.length;
      this.totalLabel.textContent = `共 ${this.total} 条`;
    }, removed, true);
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
      <div class="ref-upload" tabindex="0" role="button" aria-label="添加图片，点击选择或拖拽多张图片" data-ref-drop><strong>➕ 添加图片（选填）</strong><span>可继续追加或拖拽多张 PNG / JPEG / WebP；每张不超过 15MB，单次新增共 45MB</span><input type="file" name="upload" accept="image/png,image/jpeg,image/webp" multiple hidden></div>
      <div class="ref-editor-preview" role="list" aria-label="素材图片编辑队列" hidden></div>
      <label>发布日期（选填，留空表示未知）<input type="date" name="published_at"></label>
      <label>标题（选填）<input name="title" maxlength="200000"></label>
      <label>正文内容（选填）<textarea name="body" rows="6" maxlength="200000"></textarea></label>
      <label>封面字样 / OCR（选填）<textarea name="cover_ocr" rows="6" maxlength="200000"></textarea></label>
      <label>模型 / 型号（选填）<input name="model" maxlength="200000"></label>
      <label class="ref-editor-good"><input type="checkbox" name="good">设为精选</label>
      <p class="ref-editor-status" role="status" aria-live="polite"></p>
      <footer><button type="button" class="ref-button" data-ref-close>取消</button><button type="submit" class="ref-button ref-add">保存素材</button></footer>
    </form>`;
    this.root.append(this.dialog);
    this.form = this.dialog.querySelector('form');
    this.editorStatus = this.dialog.querySelector('.ref-editor-status');
    this.preview = this.dialog.querySelector('.ref-editor-preview');
    this.dialog.querySelectorAll('[data-ref-close]').forEach(close => close.addEventListener('click', () => { if (!this.mutating) this.dialog.close(); }));
    this.dialog.addEventListener('close', () => { this.imageVersion++; this.readingImage = false; });
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
    this.preview.addEventListener('click', event => {
      const remove = event.target.closest('[data-ref-remove]');
      if (!remove || this.mutating || this.readingImage) return;
      this.editorImages.splice(Number(remove.dataset.refRemove), 1);
      this.showPreview();
    });
  }

  openEditor(post = null) {
    if (this.mutating) return;
    this.editing = post; this.form.reset(); this.editorStatus.textContent = '';
    this.dialog.querySelector('h2').textContent = post ? '编辑素材' : '添加素材';
    this.form.elements.platform.value = post?.platform || this.platform.value;
    for (const name of ['title','cover_ocr','model']) this.form.elements[name].value = post?.[name] || '';
    this.form.elements.body.value = post?.body_full || '';
    this.form.elements.published_at.value = (post?.published_at || '').slice(0,10);
    this.form.elements.good.checked = post?.label_good === true;
    this.editorImages = post ? imageList(post).map(source => ({source, path:decodeURIComponent(source.replace('/api/content-ops/image/', 'data/images/'))})) : [];
    this.imageVersion = (this.imageVersion || 0) + 1; this.readingImage = false;
    this.showPreview();
    this.dialog.showModal();
  }

  showPreview() {
    this.hasImage = this.editorImages.length > 0;
    this.preview.hidden = !this.hasImage;
    this.preview.innerHTML = this.editorImages.map((image,index) => `<figure class="ref-editor-image" role="listitem"><img src="${esc(image.source)}" alt="第 ${index + 1} 张素材图片" decoding="async"><figcaption>${index === 0 ? '封面 · ' : ''}第 ${index + 1} 张${image.upload ? ' · 新增' : ''}</figcaption><button type="button" class="ref-image-remove" data-ref-remove="${index}" aria-label="删除第 ${index + 1} 张图片">✕</button></figure>`).join('');
  }

  async chooseImage(files) {
    if (this.mutating || this.readingImage) return;
    const additions = Array.from(files || []);
    this.form.elements.upload.value = '';
    if (!additions.length) return;
    if (this.editorImages.length + additions.length > 200 || this.editorImages.filter(image => image.upload).length + additions.length > 50) {
      this.editorStatus.textContent = '最多保留 200 张，单次最多新增 50 张图片。'; return;
    }
    if (additions.some(file => !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024)) {
      this.editorStatus.textContent = '仅支持 PNG / JPEG / WebP，每张图片不能超过 15MB。'; return;
    }
    if (additions.reduce((size,file) => size + file.size, this.editorImages.reduce((size,image) => size + (image.bytes || 0), 0)) > 45 * 1024 * 1024) {
      this.editorStatus.textContent = '单次新增图片总大小不能超过 45MB。'; return;
    }
    const version = ++this.imageVersion;
    this.readingImage = true; this.editorStatus.textContent = '正在读取图片…';
    try {
      const images = await Promise.all(additions.map(async file => {
        const source = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败，请重新选择。')); reader.readAsDataURL(file); });
        return {source,upload:source,bytes:file.size};
      }));
      if (version !== this.imageVersion) return;
      this.editorImages.push(...images); this.showPreview(); this.editorStatus.textContent = '';
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

  async refreshAfterMutation(message, old = null, replacement = null) {
    if (!old) {
      await this.load(true);
      if (!this.loadError) this.status.textContent = message;
      return;
    }
    // Read the normalized card model without ever clearing the live list.
    const version = this.requestVersion;
    const query = new URLSearchParams({platform:replacement.platform, ids:replacement.id, limit:'1'});
    try {
      const response = await this.fetcher(`/api/content-ops/references?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败');
      if (version !== this.requestVersion) return;
      const post = data.posts?.find(item => keyOf(item) === keyOf(replacement));
      if (!post) throw new Error('未读取到保存后的素材');
      this.updateEditedPost(old, post);
      this.status.textContent = message;
    } catch (error) {
      if (version === this.requestVersion) this.status.textContent = `素材已保存，卡片更新失败：${error.message}。请重试刷新。`;
    }
  }

  updateEditedPost(old, post) {
    const oldKey = keyOf(old), newKey = keyOf(post);
    const listed = this.posts.some(item => keyOf(item) === oldKey);
    const matches = (this.platform.value === 'all' || this.platform.value === post.platform)
      && (this.model?.value === 'all' || !this.model || this.model.value === post.model_category)
      && (this.collection.value === 'all' || (this.collection.value === 'uncategorized'
        ? !post.collection_ids?.length : post.collection_ids?.includes(this.collection.value)));
    const removed = listed && !matches ? new Set([oldKey]) : new Set();
    const pinned = this.pinned && keyOf(this.pinned) === oldKey;
    this.updateListInPlace(() => {
      for (const keys of [this.expandedOutlineKeys, this.collapsedCardKeys]) {
        if (keys.delete(oldKey)) keys.add(newKey);
      }
      this.posts = this.posts.flatMap(item => keyOf(item) === oldKey ? matches ? [post] : [] : [item]);
      if (pinned) this.pinned = post;
      for (const card of this.root.querySelectorAll('.ref-card')) {
        if (keyOf(card.dataset) !== oldKey) continue;
        if (removed.has(oldKey) && !this.pinnedGrid.contains(card)) { card.remove(); continue; }
        const template = document.createElement('template');
        template.innerHTML = this.card(post);
        const updated = template.content.firstElementChild;
        // Keep the article itself: it may be the viewport anchor or dialog opener.
        card.className = updated.className;
        card.dataset.platform = post.platform; card.dataset.id = String(post.id);
        card.dataset.cited = updated.dataset.cited;
        card.replaceChildren(...updated.childNodes);
      }
      for (const collection of this.collections) {
        collection.reference_ids = collection.reference_ids.map(key => key === oldKey ? newKey : key);
      }
      if (removed.size && this.total != null) this.total = Math.max(0, this.total - 1);
      this.totalLabel.textContent = `共 ${this.total ?? this.posts.length} 条`;
      this.applyViewMode();
    }, removed, Boolean(pinned));
  }

  async saveEditor() {
    if (this.pendingOrder || this.orderSavePromise) await this.persistOrder();
    if (this.mutating || this.readingImage) { this.editorStatus.textContent = '请等待当前操作完成。'; return; }
    const payload = {};
    for (const name of ['platform','title','body','cover_ocr','model']) payload[name] = this.form.elements[name].value;
    if(this.form.elements.published_at.value !== (this.editing?.published_at || '').slice(0,10))payload.published_at=this.form.elements.published_at.value;
    payload.label = {good:this.form.elements.good.checked};
    if (!this.hasImage && !payload.title.trim() && !payload.body.trim()) { this.editorStatus.textContent = '请至少保留一张图片或填写标题/正文。'; return; }
    payload.retained_images = this.editorImages.filter(image => image.path).map(image => image.path);
    payload.new_images = this.editorImages.filter(image => image.upload).map(image => image.upload);
    const old = this.editing;
    this.mutating = true; this.form.querySelectorAll('button,input,textarea,select').forEach(element => element.disabled = true);
    this.editorStatus.textContent = '正在保存…';
    try {
      const data = await this.mutationRequest(`/api/content-ops/references${old ? `/${encodeURIComponent(old.id)}/edit` : ''}`, payload);
      this.reconcileSelection(old, data.reference);
      // Closing a modal can restore focus with scrolling before the card update.
      const {scrollX, scrollY} = window;
      this.dialog.close();
      window.scrollTo({left:scrollX, top:scrollY, behavior:'instant'});
      await this.refreshAfterMutation('素材已保存；列表已按当前筛选更新。', old, data.reference);
    } catch (error) { this.editorStatus.textContent = error.message; }
    finally { this.mutating = false; this.form.querySelectorAll('button,input,textarea,select').forEach(element => element.disabled = false); }
  }

  updateListInPlace(update, removedKeys = new Set(), keepPinned = false) {
    const cards = [...this.root.querySelectorAll('.ref-card')];
    const survives = card => !removedKeys.has(keyOf(card.dataset)) || (keepPinned && this.pinnedGrid.contains(card));
    const survivors = cards.filter(survives);
    // Capture after the request, so scrolling while saving is respected.
    const anchor = survivors.find(card => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    }) || survivors.filter(card => card.getBoundingClientRect().top < window.innerHeight).at(-1);
    const top = anchor?.getBoundingClientRect().top;
    const restoreFocus = cards.some(card => !survives(card) && card.contains(document.activeElement));
    update();
    if (restoreFocus) (anchor || this.viewModeButton)?.focus({preventScroll:true});
    if (anchor) window.scrollBy({top:anchor.getBoundingClientRect().top - top, behavior:'instant'});
  }

  removeDeletedPost(post) {
    const key = keyOf(post);
    if (this.pinned && keyOf(this.pinned) === key) this.pinned = null;
    this.updateListInPlace(() => {
      const listed = this.posts.some(item => keyOf(item) === key);
      this.posts = this.posts.filter(item => keyOf(item) !== key);
      for (const card of this.root.querySelectorAll('.ref-card')) {
        if (keyOf(card.dataset) === key) card.remove();
      }
      this.pinnedGrid.hidden = !this.pinned;
      if (listed && this.total != null) this.total = Math.max(0, this.total - 1);
      this.totalLabel.textContent = `共 ${this.total ?? this.posts.length} 条`;
      for (const collection of this.collections) {
        collection.reference_ids = collection.reference_ids.filter(id => id !== key);
      }
      this.renderCollectionList();
      this.expandedOutlineKeys.delete(key);
      this.collapsedCardKeys.delete(key);
      this.reconcileSelection(post, null);
    }, new Set([key]));
  }

  async deletePost(post) {
    if (this.mutating || this.loading) return;
    if (this.pendingOrder || this.orderSavePromise) await this.persistOrder();
    if (!window.confirm('确定要删除该素材吗？')) return;
    this.mutating = true;
    try {
      await this.mutationRequest(`/api/content-ops/references/${encodeURIComponent(post.id)}/delete`, {});
      this.removeDeletedPost(post);
      this.status.textContent = this.total === 0 ? '素材已删除，当前筛选下没有素材。' : '素材及本地图片已删除。';
    } catch (error) { this.status.textContent = `删除失败：${error.message}`; }
    finally { this.mutating = false; }
  }

  async load(reset = false) {
    if (this.pendingOrder || this.orderSavePromise) await this.persistOrder();
    clearTimeout(this.statusTimer);
    this.status.classList.remove('ref-status--saved');
    if (!reset && this.loading) return;
    if (reset) {
      this.controller?.abort();
      this.requestVersion++;
      this.posts = [];
      this.pinned = null;
      this.total = null;
      this.renderPinned();
      this.grid.innerHTML = '<div class="ref-loading" aria-label="正在读取素材"><span></span><span></span><span></span></div>';
    }
    const version = this.requestVersion;
    this.controller = new AbortController();
    this.loading = true;
    this.loadError = false;
    this.root.setAttribute('aria-busy', 'true');
    this.status.textContent = '正在读取素材…';
    this.totalLabel.textContent = this.total == null ? '正在读取' : `${this.total} 条`;
    this.progress.textContent = '';
    const query = new URLSearchParams({platform:this.platform.value, model_category:this.model?.value || 'all', collection_id:this.collection.value, offset:'0', limit:'5000'});
    try {
      const response = await this.fetcher(`/api/content-ops/references?${query}`, {signal:this.controller.signal});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败');
      if (version !== this.requestVersion) return;
      if (!Array.isArray(data.posts) || !Number.isInteger(data.total) || data.total < 0) throw new Error('素材数据格式不完整');
      const additions = data.posts.filter(post => platforms.has(post.platform) && (this.platform.value === 'all' || post.platform === this.platform.value) && post.id != null);
      this.posts = additions;
      this.total = data.total;
      this.grid.innerHTML = additions.map(post => this.card(post)).join('');
      if (this.pinned && additions.some(post => keyOf(post) === keyOf(this.pinned))) this.pinned = null;
      this.renderPinned();
      this.applyViewMode();
      this.status.textContent = this.total === 0 ? '当前平台与合集没有匹配素材。' : '素材已全部加载，拖动条目可调整顺序。';
      this.totalLabel.textContent = `共 ${this.total} 条`;
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
      }
    }
  }

  image(source, title, index = 0) {
    return `<figure class="ref-image"><button type="button" class="ref-image-prompt" data-ref-prompt="${esc(source)}" aria-label="反推 ${esc(title||'素材')} 第 ${index+1} 张图片的提示词"><img src="${esc(source)}" loading="lazy" decoding="async" width="360" height="480" alt="${esc(title || '素材')} · 第 ${index + 1} 张"><span>点击反推提示词</span></button><figcaption class="ref-image-error" hidden>本机图片缺失或无法读取</figcaption></figure>`;
  }

  badges(post) {
    const hits = (Array.isArray(post.banned_word_hits) ? post.banned_word_hits : []).map(hit => typeof hit === 'string' ? hit : hit?.word || hit?.term || hit?.pattern || hit?.id || '').filter(Boolean);
    const selected = this.selectedKeys.has(keyOf(post));
    const collections = Array.isArray(post.collection_names) ? post.collection_names : [];
    return `<span class="ref-badge-platform">${post.platform === 'xhs' ? '小红书' : '闲鱼'}</span><span class="ref-badge-model">模型：${esc(post.model_category || '其他')}</span>${collections.length ? collections.map(name => `<span class="ref-badge-collection">合集：${esc(name)}</span>`).join('') : '<span class="ref-badge-uncategorized">未分类</span>'}${post.label_good === true ? '<span class="ref-badge-good">✅ 精选</span>' : ''}${hits.length ? `<span class="ref-badge-warn">⚠️ 含禁词：${esc([...new Set(hits)].join('、'))}</span>` : ''}${post.heat?.status === 'relative_hot' ? `<span class="ref-badge-good">同账号相对热帖 · 参考权重 ${esc(post.heat.weight)}×</span>` : post.heat ? '<span>互动观察中</span>' : ''}<span class="ref-badge-date">发布：${esc((post.published_at || '').slice(0,10) || '日期未知')}</span>${selected ? '<span class="ref-badge-selected">下批待引用</span>' : ''}`;
  }

  collectionOptions(post) {
    const current = new Set(Array.isArray(post.collection_ids) ? post.collection_ids : []);
    return `<option value="">调整合集…</option><option value="uncategorized">移出全部合集</option>${this.collections.map(item => `<option value="${esc(item.id)}">${current.has(item.id) ? '移出：' : '加入：'}${esc(item.name)}</option>`).join('')}`;
  }

  card(post) {
    const images = imageList(post);
    const body = String(post.body_full ?? post.body_preview ?? '');
    const key = keyOf(post), collapsed = this.isCardCollapsed(key);
    const outlineOpen = this.viewMode === 'collapsed' && !collapsed;
    return `<article class="ref-card${post.label_good === true ? ' ref-card--good' : ''}${post.banned_word_hits?.length ? ' ref-card--warned' : ''}${collapsed ? ' ref-card--collapsed' : ''}${outlineOpen ? ' ref-card--outline-open' : ''}" data-id="${esc(post.id)}" data-platform="${esc(post.platform)}" tabindex="-1">
      <div class="ref-card-head">
        <button class="ref-drag-handle" type="button" draggable="true" data-ref-drag-handle aria-label="拖动调整素材顺序" title="拖动调整顺序">⠿</button>
        <div class="ref-outline-badges">${this.badges(post)}</div>
        <h2 class="ref-title" title="${esc(post.title || '无标题')}">${esc(post.title || '无标题')}</h2>
        <div class="ref-card-actions">
          <button class="ref-icon-button" type="button" data-ref-outline-expand aria-expanded="${!collapsed}" aria-label="${collapsed ? '展开图文' : '收起图文'}" title="${collapsed ? '展开图文' : '收起图文'}">${collapsed ? '▸' : '▾'}</button>
          <button class="ref-icon-button" type="button" data-ref-move-up aria-label="上移" title="上移">↑</button>
          <button class="ref-icon-button" type="button" data-ref-move-down aria-label="下移" title="下移">↓</button>
          <button class="ref-text-button" type="button" data-ref-select aria-pressed="${this.selectedKeys.has(key)}">${this.selectedKeys.has(key) ? '移出引用' : '引用'}</button>
          <button class="ref-text-button" type="button" data-ref-edit>编辑</button><button class="ref-text-button ref-delete" type="button" data-ref-delete>删除</button>
        </div>
      </div>
      <div class="ref-media">${images.length ? this.image(images[0], post.title) : '<div class="ref-image ref-image--missing"><p>本机暂无图片</p></div>'}${images.length > 1 ? `<details class="ref-images" data-ref-images><summary>查看其余 ${images.length - 1} 张图片</summary><div class="ref-extra-images"></div></details>` : ''}</div>
      <div class="ref-body">
        <div class="ref-collection-actions"><label>素材归属<select data-ref-collection aria-label="调整素材合集">${this.collectionOptions(post)}</select></label></div>
        <p class="ref-text">发布：${esc(dateLabel(post.published_at))} · ${post.published_at_source === 'xhs_note.time' ? '平台发布时间' : post.published_at ? '手动日期' : '待采集'}<br>点赞 ${esc(post.metrics?.likes ?? '未知')} · 收藏 ${esc(post.metrics?.collects ?? '未知')} · 评论 ${esc(post.metrics?.comments ?? '未知')}<br>互动采样（北京时间）：${esc(post.metrics_observed_at ? dateLabel(post.metrics_observed_at) : '未记录')}${post.heat ? `<br>同账号样本 ${esc(post.heat.peer_count)} 篇 · 相对分位 ${esc(Math.round(post.heat.relative_percentile*100))}% · 参考权重 ${esc(post.heat.weight)}×${post.heat.growth_per_hour == null ? ' · 暂无跨日增长数据' : ` · 加权互动增长 ${esc(post.heat.growth_per_hour.toFixed(2))}/小时`}` : ''}</p>
        <section class="ref-copy-section"><h3>正文</h3><p class="ref-text">${esc(body || '—')}</p></section>
      </div>
    </article>`;
  }

  findPost(card) {
    return [...this.posts, ...(this.pinned ? [this.pinned] : [])].find(post => post.platform === card.dataset.platform && String(post.id) === card.dataset.id);
  }

  renderPosts() {
    const cards = new Map([...this.grid.children].map(card => [`${card.dataset.platform}:${card.dataset.id}`, card]));
    for (const post of this.posts) {
      const card = cards.get(keyOf(post));
      if (card) this.grid.append(card);
    }
  }

  async movePost(post, direction) {
    if (!post || this.loading || this.savingOrder || this.mutating) return;
    const index = this.posts.findIndex(item => keyOf(item) === keyOf(post)), target = index + direction;
    if (index < 0 || target < 0 || target >= this.posts.length) return;
    const [moved] = this.posts.splice(index, 1);
    this.posts.splice(target, 0, moved);
    this.renderPosts();
    this.scheduleOrderSave();
  }

  scheduleOrderSave() {
    this.pendingOrder = {platform:this.platform.value, collectionId:this.collection.value,
      posts:[...this.posts], requestVersion:this.requestVersion};
    clearTimeout(this.orderTimer);
    this.orderTimer = setTimeout(() => void this.persistOrder(), 250);
  }

  persistOrder() {
    clearTimeout(this.orderTimer);
    if (this.orderSavePromise) return this.orderSavePromise;
    const order = this.pendingOrder;
    if (!order) return Promise.resolve();
    this.pendingOrder = null;
    this.savingOrder = true;
    const done = () => { this.savingOrder = false; this.orderSavePromise = null; };
    this.orderSavePromise = this.saveOrder(order).then(done, async error => {
      done();
      if (order.requestVersion === this.requestVersion) {
        await this.load(true);
        this.status.textContent = `排序保存失败：${error.message}`;
      }
    });
    return this.orderSavePromise;
  }

  async saveOrder(order) {
    const ids = order.posts.map(keyOf);
    if (order.collectionId !== 'all' && order.collectionId !== 'uncategorized') {
      const collection = this.collections.find(item => item.id === order.collectionId);
      if (!collection) throw new Error('当前合集不存在，请刷新后重试。');
      const visible = new Set(ids);
      let cursor = 0;
      const reference_ids = collection.reference_ids.map(referenceId => visible.has(referenceId) ? ids[cursor++] : referenceId);
      while (cursor < ids.length) reference_ids.push(ids[cursor++]);
      await this.collectionRequest(`/api/content-ops/collections/${encodeURIComponent(collection.id)}`, 'PUT', {reference_ids});
      collection.reference_ids = reference_ids;
    } else {
      await this.mutationRequest('/api/content-ops/references/reorder', {platform:order.platform,ids:order.posts.map(post => post.id)});
    }
    if (order.requestVersion === this.requestVersion) this.showSavedStatus('已保存排序');
  }

  showSavedStatus(message) {
    clearTimeout(this.statusTimer);
    this.status.classList.remove('ref-status--saved');
    this.status.textContent = message;
    requestAnimationFrame(() => this.status.classList.add('ref-status--saved'));
    this.statusTimer = setTimeout(() => {
      this.status.classList.remove('ref-status--saved');
      if (!this.loading) this.status.textContent = '';
    }, 1500);
  }

  handleDragStart(event) {
    if (!event.target.closest?.('[data-ref-drag-handle]')) return;
    const card = event.target.closest?.('.ref-card');
    if (!card || !this.grid.contains(card) || this.loading || this.savingOrder || this.mutating) { event.preventDefault(); return; }
    this.draggedKey = `${card.dataset.platform}:${card.dataset.id}`;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', this.draggedKey);
    card.classList.add('ref-card--dragging');
  }

  handleDragOver(event) {
    if (!this.draggedKey) return;
    const card = event.target.closest?.('.ref-card');
    if (!card || !this.grid.contains(card) || `${card.dataset.platform}:${card.dataset.id}` === this.draggedKey) return;
    event.preventDefault();
    const before = event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
    this.clearDropTarget();
    this.dropTarget = {card, before};
    card.classList.add(before ? 'ref-card--drop-before' : 'ref-card--drop-after');
  }

  handleDragEnter(event) {
    if (this.draggedKey) event.preventDefault();
  }

  handleDragLeave(event) {
    if (this.dropTarget?.card && !this.dropTarget.card.contains(event.relatedTarget)) this.clearDropTarget();
  }

  async handleDrop(event) {
    if (!this.draggedKey) return;
    event.preventDefault();
    const target = this.dropTarget;
    const sourceIndex = this.posts.findIndex(post => keyOf(post) === this.draggedKey);
    const targetIndex = target ? this.posts.findIndex(post => keyOf(post) === keyOf({platform:target.card.dataset.platform,id:target.card.dataset.id})) : -1;
    const insertAt = targetIndex < 0 ? -1 : targetIndex + (target.before ? 0 : 1);
    this.clearDragState();
    if (sourceIndex < 0 || insertAt < 0 || sourceIndex === targetIndex) return;
    const [post] = this.posts.splice(sourceIndex, 1);
    this.posts.splice(Math.max(0, insertAt - (sourceIndex < insertAt ? 1 : 0)), 0, post);
    this.renderPosts();
    this.scheduleOrderSave();
  }

  handleDragEnd() { this.clearDragState(); }

  clearDropTarget() {
    if (!this.dropTarget?.card) return;
    this.dropTarget.card.classList.remove('ref-card--drop-before', 'ref-card--drop-after');
    this.dropTarget = null;
  }

  clearDragState() {
    this.root.querySelectorAll('.ref-card--dragging').forEach(card => card.classList.remove('ref-card--dragging'));
    this.clearDropTarget();
    this.draggedKey = null;
  }

  handleClick(event) {
    const image=event.target.closest('[data-ref-prompt]');
    if(image){const post=this.findPost(image.closest('.ref-card'));void promptUI().reference(image.dataset.refPrompt,post?.title);return;}
    const move = event.target.closest('[data-ref-move-up],[data-ref-move-down]');
    if (move) {
      const post = this.findPost(move.closest('.ref-card'));
      if (post) void this.movePost(post, move.hasAttribute('data-ref-move-up') ? -1 : 1);
      return;
    }
    const outline = event.target.closest('[data-ref-outline-expand]');
    if (outline) {
      const card = outline.closest('.ref-card'), post = this.findPost(card);
      if (!card || !post) return;
      const key = keyOf(post);
      const overrides = this.viewMode === 'collapsed' ? this.expandedOutlineKeys : this.collapsedCardKeys;
      if (overrides.has(key)) overrides.delete(key); else overrides.add(key);
      // The same reference may also be visible in the pinned area.
      for (const grid of [this.grid, this.pinnedGrid]) {
        grid?.querySelectorAll('.ref-card').forEach(item => {
          if (keyOf(item.dataset) === key) this.applyCardViewMode(item);
        });
      }
      return;
    }
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
  }

  saveSelection() {
    try { sessionStorage.setItem('content-ops-reference-selection', JSON.stringify(this.selectedReferences)); } catch {}
  }

  getSelection() { return this.selectedReferences.map(({platform,id}) => ({platform,id})); }

  clearSelectionNow() {
    this.selectedReferences = [];
    this.selectedKeys.clear();
    this.saveSelection();
    this.refreshBadges();
  }

  removeSelection(reference) {
    if (!reference) return;
    const key = keyOf(reference);
    this.selectedReferences = this.selectedReferences.filter(item => keyOf(item) !== key);
    this.selectedKeys.delete(key);
    this.saveSelection();
    this.refreshBadges();
  }

  refreshBadges() {
    for (const card of this.root.querySelectorAll('.ref-card')) {
      const post = this.findPost(card);
      if (!post) continue;
      const key = keyOf(post);
      const selected = this.selectedKeys.has(key);
      const button = card.querySelector('[data-ref-select]');
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? '移出引用' : '引用';
      card.querySelector('.ref-outline-badges').innerHTML = this.badges(post);
    }
    this.selectionLabel.textContent = this.selectedReferences.length ? `下批引用 ${this.selectedReferences.length} 条` : '';
    this.clearSelection.hidden = !this.selectedReferences.length;
    const generate = this.root.querySelector('#content-ops-ref-generate');
    if (generate) generate.hidden = !this.selectedReferences.length;
    window.dispatchEvent(new CustomEvent('content-ops:reference-selection',{detail:{references:this.getSelection()}}));
  }

  loadExtraImages(disclosure) {
    if (disclosure.dataset.loaded) return;
    const post = this.findPost(disclosure.closest('.ref-card'));
    if (!post) return;
    disclosure.querySelector('.ref-extra-images').innerHTML = imageList(post).slice(1).map((source,index) => this.image(source,post.title,index+1)).join('');
    disclosure.dataset.loaded = 'true';
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
      if (this.platform.value !== 'all' && target.platform !== this.platform.value) {
        this.platform.value = target.platform;
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
        // A targeted lookup stays separate from the current filtered list.
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
