const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '修改请求失败');
  return data;
}
const readFile = file => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(file);
});

export class ContentOpsRevisionUI {
  constructor(host, { parsePostText, renderPostContent }) {
    Object.assign(this, { host, parsePostText, renderPostContent, token: 0 });
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'revision-dialog';
    this.dialog.setAttribute('aria-labelledby', 'revision-title');
    this.dialog.innerHTML = `<header class="revision-header"><div><span class="revision-eyebrow">HANABI · 成稿编辑</span><h2 id="revision-title"></h2><p data-revision-subtitle></p></div><button type="button" class="button button-outline" data-revision-close>关闭</button></header>
      <div class="revision-workspace"><section class="revision-preview" aria-label="修改预览"><div class="revision-preview-bar"><strong data-preview-label>当前成稿</strong><button type="button" class="text-button" data-revision-current>查看当前采用版</button></div>
      <div class="revision-media" hidden><img alt="待修改的海报"><canvas aria-label="拖动框选需要修改的图片区域"></canvas></div><article class="revision-copy-preview"></article>
      <p class="revision-preview-note" data-region-note hidden>可拖动框选需要修改的区域，未框选时修改整张图片。</p></section>
      <section class="revision-controls" aria-label="修改工具"><div class="revision-copy-fields"><label>标题 <span data-title-count></span><input name="title" maxlength="160"></label><label>正文<textarea name="body" rows="10" maxlength="17000"></textarea></label><label>标签<input name="tags" maxlength="1000" placeholder="#标签一 #标签二"></label><button type="button" class="button button-primary" data-revision-save>保存文案并采用</button></div>
      <div class="revision-image-tools" hidden><h3>修改图片</h3><div class="revision-tool-row"><button type="button" class="button button-outline" data-revision-region aria-pressed="false">框选修改区域</button><button type="button" class="text-button" data-revision-clear-region hidden>清除选区</button></div><label class="revision-upload">上传图片替换<input type="file" accept="image/png,image/jpeg,image/webp" data-revision-upload></label><p class="revision-help">支持 PNG / JPEG / WebP，最多15MB。按原画幅适配，上传后可先预览。</p></div>
      <div class="revision-ai"><label><span data-ai-label>告诉 AI 怎么修改</span><textarea name="instructions" rows="3" maxlength="2000" placeholder="例如：标题更口语，保留卖点和价格；或把背景改浅、文字留白加大"></textarea></label><button type="button" class="button button-primary" data-revision-ai></button><p class="revision-help" data-ai-help></p></div>
      <section class="revision-history"><h3>版本记录 <small>原稿始终保留</small></h3><div data-revision-history></div></section></section></div>
      <footer class="revision-footer"><div class="revision-footer-note"><p class="revision-status" role="status" aria-live="polite"></p><p data-revision-footer>预览满意后采用，其他图文保持不变。</p></div><div><button type="button" class="text-button" data-revision-cancel hidden>取消本次修改</button><a class="button button-outline" data-revision-download download hidden>下载预览图</a><button type="button" class="button button-primary" data-revision-apply disabled>采用此版</button></div></footer>`;
    document.body.append(this.dialog);
    this.q = selector => this.dialog.querySelector(selector);
    this.status = (message, error = false) => { this.q('.revision-status').textContent = message; this.q('.revision-status').dataset.error = String(error); };
    this.q('[data-revision-close]').onclick = () => this.close();
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { this.token++; clearTimeout(this.timer); });
    this.q('[data-revision-current]').onclick = () => {
      if(!this.history || this.dirty&&!confirm('放弃当前未保存的文案修改，查看当前采用版？'))return;
      this.preview(this.history.current, this.history.currentRevision, '当前采用版');
    };
    this.q('[data-revision-save]').onclick = () => void this.start('manual', true);
    this.q('[data-revision-ai]').onclick = () => void this.start('ai');
    this.q('[data-revision-apply]').onclick = () => void this.apply();
    this.q('[data-revision-cancel]').onclick = () => void this.cancel();
    this.q('[data-revision-upload]').onchange = async event => {
      const file = event.target.files[0]; if (!file) return;
      const token = this.token;
      try { if (file.size > 15 * 1024 * 1024) throw new Error('图片最多15MB');
        const imageData = await readFile(file);
        if(token!==this.token||!this.dialog.open)return;
        await this.start('upload', false, { imageData });
      } catch (error) { if(token===this.token)this.status(error.message, true); }
      finally { event.target.value = ''; }
    };
    for (const input of this.dialog.querySelectorAll('.revision-copy-fields input,.revision-copy-fields textarea')) input.addEventListener('input', () => {
      this.dirty = true; this.candidateId = null; this.q('[data-preview-label]').textContent = '未保存的修改'; this.renderCopy(); this.updateApply();
    });
    this.q('[data-revision-region]').onclick = () => {
      this.selecting = !this.selecting; this.updateRegion();
    };
    this.q('[data-revision-clear-region]').onclick = () => { this.region = null; this.drawRegion(); this.updateRegion(); };
    const canvas = this.q('canvas');
    const point = event => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX-r.left)/r.width)), y: Math.max(0, Math.min(1, (event.clientY-r.top)/r.height)) }; };
    canvas.onpointerdown = event => { if (!this.selecting || this.busy) return; event.preventDefault(); this.anchor = point(event); canvas.setPointerCapture(event.pointerId); };
    canvas.onpointermove = event => {
      if (!this.anchor) return; const end = point(event);
      this.region = { x: Math.min(this.anchor.x,end.x), y: Math.min(this.anchor.y,end.y), width: Math.abs(end.x-this.anchor.x), height: Math.abs(end.y-this.anchor.y) }; this.drawRegion();
    };
    canvas.onpointerup = event => { this.anchor = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); if (this.region && (this.region.width<.01 || this.region.height<.01)) this.region=null; this.drawRegion(); this.updateRegion(); };
    canvas.onpointercancel = () => { this.anchor=null; };
    this.q('.revision-media img').onload = () => {
      const img = this.q('.revision-media img'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; this.drawRegion();
    };
    this.q('[data-revision-history]').addEventListener('click', event => {
      const button = event.target.closest('[data-version]'); if (!button || this.busy) return;
      if (this.dirty && !confirm('放弃当前未保存的文案修改，查看这个版本？')) return;
      const version = button.dataset.version === 'original' ? {result:this.history.original,id:'original'} : this.history.versions.find(v=>v.id===button.dataset.version);
      if (version?.status==='running') { this.runningId=version.id; this.setBusy(true); void this.poll(version.id,this.token); }
      else if (version?.result) this.preview(version.result,version.id,version.id==='original'?'最初原稿':'历史版本预览');
    });
  }
  endpoint(action = 'revisions') { return `/api/content-ops/batches/${this.batchId}/posts/${this.jobId}/${action}`; }
  async open(index, kind) {
    const batch = this.host.batch, post = batch?.posts[index]; if (!post) return;
    if (this.dialog.open) this.dialog.close();
    const token = ++this.token;
    Object.assign(this, { batchId:batch.id, jobId:post.jobId, kind, copyIndex:kind==='image'?0:this.host.currentCopy(post).index,
      platform:batch.platform, dirty:false, region:null, selecting:false, candidateId:null, runningId:null, request:null, busy:false, history:null });
    this.q('#revision-title').textContent = `修改第 ${post.index} 张${kind==='image'?'封面':`图的文案 ${String.fromCharCode(64+this.copyIndex)}`}`;
    this.q('[data-revision-subtitle]').textContent = `${batch.model} · ${batch.platform==='xianyu'?'闲鱼':'小红书'} · 只修改当前${kind==='image'?'图片':'文案版本'}`;
    this.q('.revision-copy-fields').hidden = kind!=='copy'; this.q('.revision-copy-preview').hidden = kind!=='copy';
    this.q('.revision-image-tools').hidden = kind!=='image'; this.q('.revision-media').hidden = kind!=='image'; this.q('[data-region-note]').hidden = kind!=='image';
    this.q('[data-revision-ai]').textContent = kind==='image'?'生成改图预览':'生成改写预览';
    this.q('[data-ai-help]').textContent = kind==='image'?'AI 会读取当前预览图。仅本次改图调用图像模型，结果先预览。':'AI 只改写当前预览文案，保留未要求修改的事实，结果先预览。';
    this.q('[name=instructions]').value=''; this.q('[data-revision-apply]').disabled=true;
    this.q('[data-revision-history]').innerHTML=''; this.q('.revision-copy-preview').innerHTML='';
    this.q('.revision-media img').removeAttribute('src');this.q('[data-revision-download]').hidden=true;
    this.setBusy(true); this.dialog.showModal(); this.status('正在读取成稿与版本记录…');
    try {
      const history = await api(this.endpoint()+`?kind=${kind}&copyIndex=${this.copyIndex}`); if(token!==this.token)return;
      this.history=history;this.expectedRevision=history.currentRevision;this.preview(history.current,history.currentRevision,'当前采用版');this.renderHistory();this.setBusy(false);this.status('修改会保存为独立版本，原稿始终保留。');
      const running=history.versions.find(v=>v.status==='running');
      if(running){this.runningId=running.id;this.setBusy(true);void this.poll(running.id,token);}
    } catch(error){if(token===this.token){this.setBusy(false);this.status(error.message,true);}}
  }
  close() { if(this.dirty&&!confirm('文案修改尚未保存，确定关闭？'))return; this.dialog.close(); }
  copyText() {
    const title=this.q('[name=title]').value.trim(), body=this.q('[name=body]').value.trim();
    const tags=this.q('[name=tags]').value.trim().split(/\s+/u).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).join(' ');
    return `# ${title}\n\n${body}${tags?'\n\n'+tags:''}`;
  }
  renderCopy() {
    const title=this.q('[name=title]').value;
    this.q('[data-title-count]').textContent=`${[...title].length}/${this.platform==='xhs'?20:80}`;
    this.q('.revision-copy-preview').innerHTML=this.renderPostContent(this.copyText());
  }
  preview(result, id, label) {
    this.candidateId=id;this.candidate=result;this.dirty=false;this.region=null;
    this.q('[data-preview-label]').textContent=label;
    if(this.kind==='copy'){
      const copy=this.parsePostText(result.text||'');for(const key of ['title','body','tags'])this.q(`[name=${key}]`).value=key==='tags'?copy.tags.join(' '):copy[key];this.renderCopy();
    }else{
      this.q('.revision-media img').src=result.image||'';
      this.q('[data-revision-download]').href=result.image||'';
      this.q('[data-revision-download]').download=`${this.host.batch.model}-修改预览.png`;
      this.q('[data-revision-download]').hidden=!result.image;this.drawRegion();this.updateRegion();
    }
    this.updateApply();
  }
  updateApply(){this.q('[data-revision-apply]').disabled=this.busy||!this.candidateId||this.candidateId===this.history?.currentRevision;}
  setBusy(busy){
    this.busy=busy;
    for(const control of this.dialog.querySelectorAll('.revision-controls input,.revision-controls textarea,.revision-controls button'))control.disabled=busy;
    this.q('[data-revision-current]').disabled=busy;this.q('[data-revision-cancel]').disabled=false;
    this.q('[data-revision-cancel]').hidden=!busy||!this.runningId;this.updateApply();
  }
  updateRegion(){
    this.q('canvas').classList.toggle('is-selecting',this.selecting&&!this.busy);
    this.q('[data-revision-region]').setAttribute('aria-pressed',String(this.selecting));
    this.q('[data-revision-region]').textContent=this.selecting?'正在框选区域':'框选修改区域';
    this.q('[data-revision-clear-region]').hidden=!this.region;
    this.q('[data-region-note]').textContent=this.region?'仅修改框选区域；框外内容会由本机合成保留。':'可拖动框选需要修改的区域，未框选时修改整张图片。';
  }
  drawRegion(){
    const canvas=this.q('canvas'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!this.region)return;const {x,y,width,height}=this.region;
    ctx.fillStyle='rgba(217,77,131,.16)';ctx.fillRect(x*canvas.width,y*canvas.height,width*canvas.width,height*canvas.height);
    ctx.strokeStyle='#d94d83';ctx.lineWidth=Math.max(2,canvas.width/250);ctx.strokeRect(x*canvas.width,y*canvas.height,width*canvas.width,height*canvas.height);
  }
  async start(action, adopt=false, extra={}){
    if(this.busy||!this.history)return;
    const instructions=this.q('[name=instructions]').value.trim();
    if(action==='ai'&&!instructions){this.status('先填写希望如何修改。',true);this.q('[name=instructions]').focus();return;}
    const body={kind:this.kind,copyIndex:this.copyIndex,baseRevision:this.expectedRevision,action,
      sourceRevision:this.candidateId||this.history.currentRevision,...(this.kind==='copy'?{sourceText:this.copyText()}:{}),
      ...(action==='ai'?{instructions,...(this.region?{region:this.region}:{})}:{}),...(action==='manual'?{text:this.copyText()}:{}),...extra};
    const signature=JSON.stringify(body);if(this.request?.signature!==signature)this.request={signature,id:crypto.randomUUID()};body.requestId=this.request.id;
    const token=this.token;this.setBusy(true);this.status(action==='ai'?'正在生成修改预览，可关闭面板后继续查看版本记录。':'正在保存修改预览…');
    try{
      const {revision}=await api(this.endpoint(),body);if(token!==this.token)return;
      this.runningId=revision.id;this.setBusy(true);await this.poll(revision.id,token,adopt);
    }catch(error){if(token===this.token){this.setBusy(false);this.status(error.message,true);}}
  }
  async poll(id,token,adopt=false){
    if(token!==this.token||!this.dialog.open)return;
    try{
      const {revision}=await api('/api/content-ops/revisions/'+id);if(token!==this.token)return;
      if(revision.status==='running'){this.status('正在处理当前修改…');this.timer=setTimeout(()=>void this.poll(id,token,adopt),1200);return;}
      this.runningId=null;this.request=null;this.setBusy(false);await this.refreshHistory(token);if(token!==this.token)return;
      if(revision.status!=='ready'){this.status(revision.error||'修改未完成，原稿保留。',true);return;}
      this.preview(revision.result,revision.id,'修改结果预览');this.status('修改已生成，检查预览后点击“采用此版”。');
      if(adopt)await this.apply();
    }catch(error){if(token===this.token){this.setBusy(false);this.status('读取修改结果失败；重新打开编辑器可恢复进度。'+error.message,true);}}
  }
  async refreshHistory(token=this.token){const history=await api(this.endpoint()+`?kind=${this.kind}&copyIndex=${this.copyIndex}`);if(token!==this.token)return;this.history=history;this.renderHistory();}
  renderHistory(){
    const current=this.history.currentRevision;
    this.q('[data-revision-history]').innerHTML=`<button type="button" data-version="original" aria-pressed="${current==='original'}"><span>最初原稿</span><small>${current==='original'?'当前采用':'可恢复'}</small></button>`+this.history.versions.map((v,i)=>`<button type="button" data-version="${esc(v.id)}" aria-pressed="${current===v.id}" ${['failed','cancelled'].includes(v.status)?'disabled':''}><span>${v.action==='ai'?'AI修改':v.action==='upload'?'上传替换':'手动修改'} · ${new Date(v.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}${v.instructions?`<em class="revision-version-note" title="${esc(v.instructions)}">${esc(v.instructions.slice(0,48))}</em>`:''}</span><small>${current===v.id?'当前采用':v.status==='running'?'处理中':v.status==='ready'?'预览':esc(v.error||'未完成')}</small></button>`).join('');
  }
  async apply(){
    if(this.busy||!this.candidateId)return;
    const token=this.token;this.setBusy(true);
    try{const {batch}=await api(this.endpoint('apply'),{kind:this.kind,copyIndex:this.copyIndex,baseRevision:this.expectedRevision,revisionId:this.candidateId});
      if(this.host.batch?.id===batch.id){this.host.batch=batch;this.host.render();}
      if(token!==this.token)return;
      this.dirty=false;this.expectedRevision=this.candidateId;await this.refreshHistory(token);if(token!==this.token)return;this.q('[data-preview-label]').textContent='当前采用版';this.status('已采用。工作台预览、复制和下载均使用此版。');
    }catch(error){if(token===this.token)this.status(error.message,true);}
    finally{if(token===this.token)this.setBusy(false);}
  }
  async cancel(){if(!this.runningId)return;try{await api('/api/content-ops/revisions/'+this.runningId+'/cancel',{});}catch(error){this.status(error.message,true);}}
}
