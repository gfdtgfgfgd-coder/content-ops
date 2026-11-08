import { generationBlocks } from './content-ops-prompt-ui.mjs';
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
      <div class="revision-media" hidden><img alt="待修改的海报"><canvas aria-label="拖动框选需要修改的图片区域"></canvas></div><p class="revision-empty-image" hidden>尚无封面，编辑提示词后可直接生成。</p><article class="revision-copy-preview"></article>
      <p class="revision-preview-note" data-region-note hidden>可拖动框选需要修改的区域，未框选时修改整张图片。</p></section>
      <section class="revision-controls" aria-label="修改工具"><div class="revision-copy-fields"><label>标题 <span data-title-count></span><input name="title" maxlength="160"></label><label>正文<textarea name="body" rows="10" maxlength="17000"></textarea></label><label>标签<input name="tags" maxlength="1000" placeholder="#标签一 #标签二"></label><button type="button" class="button button-primary" data-revision-save>保存文案并采用</button></div>
      <section class="revision-prompt-fields" hidden><h3 data-revision-prompt-title>生图提示词</h3><p class="revision-help" data-revision-prompt-note></p><label>编辑提示词<textarea name="imagePrompt" rows="8" maxlength="16000" placeholder="填写希望生成的画面、配色、布局与文字"></textarea></label><div class="revision-cover-fields" hidden><h3>封面文字</h3><div class="revision-palette"><label>字号比例（%）<input name="fontScale" type="number" min="60" max="150" step="5" value="100"></label><label>文字对齐<select name="textAlign"><option value="center">居中</option><option value="left">左对齐</option></select></label></div><p class="revision-help">例如设为120%并选左对齐。放大时文字区同步加宽；点击下方生成按钮会重新生成背景并应用排版。</p><div data-cover-texts></div><div class="revision-palette"><label>文字色<input name="ink" placeholder="#171B1B" maxlength="7"></label><label>高亮色<input name="accent" placeholder="#85D6C5" maxlength="7"></label></div></div><div class="revision-prompt-actions"><button type="button" class="button button-outline" data-revision-copy-prompt>复制提示词</button><button type="button" class="button button-primary" data-revision-regenerate>按提示词生成新图</button></div><details class="revision-prompt-history"><summary>原始提示词与调用记录</summary><div data-generation-prompts></div></details></section><details class="revision-image-tools" hidden><summary>基于当前图片修改或上传替换</summary><h3>局部改图与上传</h3><div class="revision-tool-row"><button type="button" class="button button-outline" data-revision-region aria-pressed="false">框选修改区域</button><button type="button" class="text-button" data-revision-clear-region hidden>清除选区</button></div><label class="revision-upload">上传图片替换<input type="file" accept="image/png,image/jpeg,image/webp" data-revision-upload></label><p class="revision-help">支持 PNG / JPEG / WebP，最多15MB。按原画幅适配，上传后可先预览。</p></details>
      <div class="revision-ai"><label><span data-ai-label>告诉 AI 怎么修改</span><textarea name="instructions" rows="3" maxlength="2000" placeholder="例如：标题更口语，保留卖点和价格；或把背景改浅、文字留白加大"></textarea></label><button type="button" class="button button-primary" data-revision-ai></button><p class="revision-help" data-ai-help></p></div>
      <section class="revision-history"><h3>版本记录 <small>原稿始终保留</small></h3><div data-revision-history></div></section></section></div>
      <footer class="revision-footer"><div class="revision-footer-note"><p class="revision-status" role="status" aria-live="polite"></p><p data-revision-footer>预览满意后采用，其他图文保持不变。</p></div><div><button type="button" class="text-button" data-revision-cancel hidden>取消本次修改</button><a class="button button-outline" data-revision-download download hidden>下载预览图</a><button type="button" class="button button-primary" data-revision-apply disabled>采用此版</button></div></footer>`;
    document.body.append(this.dialog);
    this.q = selector => this.dialog.querySelector(selector);
    this.q('.revision-footer>div:last-child').insertBefore(this.q('[data-revision-regenerate]'),this.q('[data-revision-apply]'));
    this.q('.revision-prompt-fields').insertBefore(this.q('.revision-prompt-actions'),this.q('.revision-cover-fields'));
    this.status = (message, error = false) => { this.q('.revision-status').textContent = message; this.q('.revision-status').dataset.error = String(error); };
    this.q('[data-revision-close]').onclick = () => this.close();
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { this.token++; clearTimeout(this.timer); });
    this.q('[data-revision-current]').onclick = () => {
      if(!this.history || this.dirty&&!confirm('放弃当前未保存的修改，查看当前采用版？'))return;
      this.preview(this.history.current, this.history.currentRevision, '当前采用版');
    };
    this.q('[data-revision-save]').onclick = () => void this.start('manual', true);
    this.q('[data-revision-regenerate]').onclick=()=>void this.start('regenerate');
    this.q('[data-revision-copy-prompt]').onclick=async()=>{try{await navigator.clipboard.writeText(this.q('[name=imagePrompt]').value);this.status('提示词已复制。');}catch{this.status('复制失败，可选中提示词手动复制。',true);}};
    this.dialog.addEventListener('click',async event=>{const button=event.target.closest('[data-prompt-copy]');if(button){try{await navigator.clipboard.writeText(button.closest('section').querySelector('pre').textContent);button.textContent='已复制';}catch{this.status('复制失败，可手动选中复制。',true);}}});
    this.q('.revision-prompt-fields').addEventListener('input',()=>{this.dirty=true;this.adoptable=false;this.q('[data-preview-label]').textContent='提示词或排版已修改，图片尚未重新生成';this.updateApply();});
    this.q('.revision-image-tools').addEventListener('toggle',()=>this.updateRegion());
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
      if (this.dirty && !confirm('放弃当前未保存的修改，查看这个版本？')) return;
      const version = button.dataset.version === 'original' ? {result:this.history.original,id:'original'} : this.history.versions.find(v=>v.id===button.dataset.version);
      if(['failed','cancelled'].includes(version?.status)&&version.result?.prompt){this.loadPrompt({...this.baseImageContext,...version.result});this.dirty=false;this.adoptable=false;this.q('[data-preview-label]').textContent='已载入未完成的提示词，图片仍为上次预览';this.updateApply();this.status(version.error||'可编辑后重新生成。',true);return;}
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
      platform:batch.platform, dirty:false,adoptable:false,region:null, selecting:false, candidateId:null, candidate:null,baseImageContext:null,runningId:null, request:null, busy:false, history:null });
    this.q('#revision-title').textContent = `${kind==='image'?'图片与提示词 · 第':'修改第'} ${post.index} 张${kind==='image'?'封面':`图的文案 ${String.fromCharCode(64+this.copyIndex)}`}`;
    this.q('[data-revision-subtitle]').textContent = `${batch.model} · ${batch.platform==='xianyu'?'闲鱼':'小红书'} · 只修改当前${kind==='image'?'图片':'文案版本'}`;
    this.q('.revision-copy-fields').hidden = kind!=='copy'; this.q('.revision-copy-preview').hidden = kind!=='copy';
    this.q('.revision-image-tools').hidden = kind!=='image'; this.q('.revision-media').hidden = kind!=='image'; this.q('[data-region-note]').hidden = kind!=='image';
    this.q('.revision-prompt-fields').hidden=kind!=='image';this.q('.revision-empty-image').hidden=true;
    this.q('[data-revision-regenerate]').hidden=kind!=='image';
    this.q('.revision-image-tools').open=false;
    const ai=this.q('.revision-ai');if(kind==='image')this.q('.revision-image-tools').append(ai);else this.q('.revision-controls').insertBefore(ai,this.q('.revision-history'));
    this.q('[data-revision-ai]').textContent = kind==='image'?'生成改图预览':'生成改写预览';
    this.q('[data-ai-help]').textContent = kind==='image'?'AI 会读取当前预览图。仅本次改图调用图像模型，结果先预览。':'AI 只改写当前预览文案，保留未要求修改的事实，结果先预览。';
    this.q('[name=instructions]').value=''; this.q('[data-revision-apply]').disabled=true;
    this.q('[data-revision-history]').innerHTML=''; this.q('.revision-copy-preview').innerHTML='';
    this.q('.revision-media img').removeAttribute('src');this.q('[data-revision-download]').hidden=true;
    this.q('[name=imagePrompt]').value='';this.q('[data-cover-texts]').innerHTML='';this.q('[data-generation-prompts]').innerHTML='';
    this.setBusy(true); this.dialog.showModal(); this.status('正在读取成稿与版本记录…');
    try {
      const [history,prompts] = await Promise.all([api(this.endpoint()+`?kind=${kind}&copyIndex=${this.copyIndex}`),kind==='image'?api(this.endpoint('prompts')).catch(error=>({error:error.message})):null]); if(token!==this.token)return;
      this.history=history;this.baseImageContext=history.original;this.expectedRevision=history.currentRevision;
      this.q('[data-generation-prompts]').innerHTML=prompts?.error?`<p>${esc(prompts.error)}</p>`:prompts?generationBlocks(prompts):'';
      this.preview(history.current,history.currentRevision,'当前采用版');this.renderHistory();this.setBusy(false);this.status('修改会保存为独立版本，原稿始终保留。');
      const running=history.versions.find(v=>v.status==='running');
      if(running){if(running.result?.prompt)this.loadPrompt({...this.baseImageContext,...running.result});this.runningId=running.id;this.setBusy(true);void this.poll(running.id,token);}
    } catch(error){if(token===this.token){this.setBusy(false);this.status(error.message,true);}}
  }
  close() { if(this.dirty&&!confirm('修改尚未保存，确定关闭？'))return; this.dialog.close(); }
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
    this.candidateId=id;this.candidate=result;this.dirty=false;this.adoptable=true;this.region=null;
    this.q('[data-preview-label]').textContent=label;
    if(this.kind==='copy'){
      const copy=this.parsePostText(result.text||'');for(const key of ['title','body','tags'])this.q(`[name=${key}]`).value=key==='tags'?copy.tags.join(' '):copy[key];this.renderCopy();
    }else{
      const image=this.q('.revision-media img');if(result.image)image.src=result.image;else image.removeAttribute('src');
      this.q('.revision-media').hidden=!result.image;this.q('.revision-empty-image').hidden=Boolean(result.image);
      this.loadPrompt(result);
      this.q('[data-revision-download]').href=result.image||'';
      this.q('[data-revision-download]').download=`${this.host.batch.model}-修改预览.png`;
      this.q('[data-revision-download]').hidden=!result.image;this.drawRegion();this.updateRegion();
    }
    this.updateApply();
  }
  loadPrompt(result){
    const own=typeof result.prompt==='string'&&['layered_poster','direct_poster'].includes(result.renderMode);
    const context=own?result:this.baseImageContext||{};this.renderMode=context.renderMode||'direct_poster';this.imageSettings={...(context.backgroundStyle||{})};
    this.q('[name=imagePrompt]').value=context.prompt||'';
    const layered=this.renderMode==='layered_poster';this.q('[data-revision-prompt-title]').textContent=layered?'背景提示词':'完整海报提示词';
    this.q('[data-revision-prompt-note]').textContent=(context.promptOrigin==='original_fallback'||!own&&result.image!==this.history.original.image?'当前图片是修改版，以下从本批原始生成方案开始。':'')+(layered?'修改背景词会重绘背景，下方封面文字保持清晰排版；背景颜色按新提示词生成。':'修改后按完整提示词重绘整张海报，不会重新调用写稿或提示词模型。文字放大或左对齐等要求请直接写入完整海报提示词。');
    this.q('.revision-cover-fields').hidden=!layered;
    this.q('[name=fontScale]').value=Math.round((context.typography?.scale??1)*100);this.q('[name=textAlign]').value=context.typography?.align||'center';
    this.coverTexts=(context.coverTexts||[]).map(t=>({...t}));
    const roles={hook:'开场句',benefit:'利益句',model:'型号（当前批次）',payoff:'爽点'};
    this.q('[data-cover-texts]').innerHTML=this.coverTexts.map((text,i)=>`<div class="revision-cover-line"><label>${esc(roles[text.role]||'封面字')}<input data-cover-index="${i}" value="${esc(text.text)}" maxlength="80" ${text.role==='model'?'readonly':''}></label><label class="revision-cover-highlight"><input type="checkbox" data-highlight-index="${i}" ${this.imageSettings.highlight_roles?.includes(text.role)?'checked':''}>高亮</label></div>`).join('');
    this.q('[name=ink]').value=this.imageSettings.ink||'';this.q('[name=accent]').value=this.imageSettings.accent||'';
  }
  updateApply(){this.q('[data-revision-apply]').disabled=this.busy||this.dirty||!this.adoptable||!this.candidateId||this.candidateId===this.history?.currentRevision;}
  setBusy(busy){
    this.busy=busy;
    for(const control of this.dialog.querySelectorAll('.revision-controls input,.revision-controls textarea,.revision-controls select,.revision-controls button'))control.disabled=busy&&!control.hasAttribute('data-prompt-copy')&&!control.hasAttribute('data-revision-copy-prompt');
    if(this.kind==='image')for(const selector of ['[data-revision-ai]','[data-revision-region]','[data-revision-upload]'])this.q(selector).disabled=busy||!this.candidate?.image;
    this.q('[data-revision-current]').disabled=busy;this.q('[data-revision-cancel]').disabled=false;
    this.q('[data-revision-regenerate]').disabled=busy;
    this.q('[data-revision-cancel]').hidden=!busy||!this.runningId;this.updateApply();
  }
  updateRegion(){
    this.q('canvas').classList.toggle('is-selecting',this.selecting&&!this.busy);
    this.q('[data-revision-region]').setAttribute('aria-pressed',String(this.selecting));
    this.q('[data-revision-region]').textContent=this.selecting?'正在框选区域':'框选修改区域';
    this.q('[data-revision-clear-region]').hidden=!this.region;
    this.q('[data-region-note]').hidden=this.kind!=='image'||!this.q('.revision-image-tools').open;
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
    if(action==='regenerate'){
      this.region=null;this.selecting=false;this.drawRegion();this.updateRegion();
      body.prompt=this.q('[name=imagePrompt]').value;body.renderMode=this.renderMode;
      if(!body.prompt.trim()){this.status('先填写生图提示词。',true);this.q('[name=imagePrompt]').focus();return;}
      if(this.renderMode==='layered_poster'){
        body.typography={scale:Number(this.q('[name=fontScale]').value)/100,align:this.q('[name=textAlign]').value};
        if(!Number.isFinite(body.typography.scale)||body.typography.scale<.6||body.typography.scale>1.5){this.status('字号比例须为60%～150%。',true);return;}
        body.coverTexts=this.coverTexts.map((t,i)=>({...t,text:this.q(`[data-cover-index="${i}"]`).value.trim()}));
        body.backgroundStyle={...this.imageSettings,highlight_roles:this.coverTexts.filter((_,i)=>this.q(`[data-highlight-index="${i}"]`).checked).map(t=>t.role)};
        for(const key of ['ink','accent']){const value=this.q(`[name=${key}]`).value.trim();if(value)body.backgroundStyle[key]=value;else delete body.backgroundStyle[key];}
        if(body.backgroundStyle.highlight_roles.length>3){this.status('最多高亮3行封面字。',true);return;}
      }
    }
    const signature=JSON.stringify(body);if(this.request?.signature!==signature)this.request={signature,id:crypto.randomUUID()};body.requestId=this.request.id;
    const token=this.token;this.setBusy(true);this.status(['ai','regenerate'].includes(action)?'正在生成修改预览，可关闭面板后继续查看版本记录。':'正在保存修改预览…');
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
      if(revision.status!=='ready'){if(revision.action==='regenerate'){this.dirty=false;this.adoptable=false;this.updateApply();}this.status(revision.error||'修改未完成，原稿保留。',true);return;}
      this.preview(revision.result,revision.id,'修改结果预览');this.status('修改已生成，检查预览后点击“采用此版”。');
      if(adopt)await this.apply();
    }catch(error){if(token===this.token){this.setBusy(false);this.status('读取修改结果失败；重新打开编辑器可恢复进度。'+error.message,true);}}
  }
  async refreshHistory(token=this.token){const history=await api(this.endpoint()+`?kind=${this.kind}&copyIndex=${this.copyIndex}`);if(token!==this.token)return;this.history=history;this.renderHistory();}
  renderHistory(){
    const current=this.history.currentRevision;
    this.q('[data-revision-history]').innerHTML=`<button type="button" data-version="original" aria-pressed="${current==='original'}"><span>最初原稿</span><small>${current==='original'?'当前采用':'可恢复'}</small></button>`+this.history.versions.map((v,i)=>`<button type="button" data-version="${esc(v.id)}" aria-pressed="${current===v.id}" ${['failed','cancelled'].includes(v.status)&&!v.result?.prompt?'disabled':''}><span>${v.action==='regenerate'?'按提示词生成':v.action==='ai'?'AI修改':v.action==='upload'?'上传替换':'手动修改'} · ${new Date(v.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}${(v.result?.prompt||v.instructions)?`<em class="revision-version-note" title="${esc(v.result?.prompt||v.instructions)}">${esc((v.result?.prompt||v.instructions).slice(0,48))}</em>`:''}</span><small>${current===v.id?'当前采用':v.status==='running'?'处理中':v.status==='ready'?'预览':esc(v.error||'未完成')}</small></button>`).join('');
  }
  async apply(){
    if(this.busy||!this.candidateId)return;
    const token=this.token;this.setBusy(true);
    try{const {batch}=await api(this.endpoint('apply'),{kind:this.kind,copyIndex:this.copyIndex,baseRevision:this.expectedRevision,revisionId:this.candidateId});
      if(this.host.batch?.id===batch.id){const before=this.host.batch.status;this.host.batch=batch;this.host.render();if(before!==batch.status){const history=await api('/api/content-ops/batches').catch(()=>null);if(history)this.host.renderHistory?.(history.batches||[]);}}
      if(token!==this.token)return;
      this.dirty=false;this.expectedRevision=this.candidateId;await this.refreshHistory(token);if(token!==this.token)return;this.q('[data-preview-label]').textContent='当前采用版';this.status('已采用。工作台预览、复制和下载均使用此版。');
    }catch(error){if(token===this.token)this.status(error.message,true);}
    finally{if(token===this.token)this.setBusy(false);}
  }
  async cancel(){if(!this.runningId)return;try{await api('/api/content-ops/revisions/'+this.runningId+'/cancel',{});}catch(error){this.status(error.message,true);}}
}
