const storedRequest=()=>{try{return JSON.parse(sessionStorage.getItem('hanabi.content-ops-request')||'null');}catch{return null;}};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data;}
function renderProvider(config){
  const preferences=config.preferencesReady&&config.preferencesVersion?`偏好 v${config.preferencesVersion.version}（${config.preferencesVersion.distilledAt}）`:'偏好：⚠️ distilled-preferences.json 未就绪，请先跑 T13';
  const provider=document.querySelector('#content-ops-provider');
  if(provider)provider.textContent=`文案：网关 ${config.textModel||'默认模型'} · 新背景：${config.imageModel||'Qwen'} · ${preferences}`;
}
// 三栏页面与旧工作台都使用这行状态；不依赖旧工作台完成初始化。
const configRequest=document.querySelector('#content-ops-provider')?api('/api/content-ops/config'):null;
configRequest?.then(renderProvider).catch(error=>{const provider=document.querySelector('#content-ops-provider');if(provider)provider.textContent='偏好状态读取失败：'+error.message;});
export class ContentOpsUI {
  constructor({navigate,refresh=async()=>{},openChat}={}){
    if(window.contentOpsUI){Object.assign(window.contentOpsUI,{...(navigate?{navigate}:{}),refresh,...(openChat?{openChat}:{})});return window.contentOpsUI;}
    Object.assign(this,{navigate,refresh,openChat});this.panel=document.querySelector('#content-ops-panel')||document.querySelector('#view-peizhi')||document.querySelector('#view-generate');this.form=document.querySelector('#content-ops-form');this.result=document.querySelector('#content-ops-results');this.notice=document.querySelector('#content-ops-status');this.batch=null;this.busy=false;this.timer=null;
    if(!this.panel||!this.form||!this.result)return;
    window.contentOpsUI=this;
    this.form.addEventListener('submit',event=>{event.preventDefault();void this.submit();});
    document.querySelector('#content-ops-stop').onclick=()=>void this.stop();
    document.querySelector('#content-ops-new').onclick=()=>{this.batch=null;sessionStorage.removeItem('hanabi.content-ops-request');this.render();document.querySelector('#content-ops-model').focus();};
    document.querySelector('#content-ops-history').onchange=async event=>{if(!event.target.value)return;try{this.batch=(await api('/api/content-ops/batches/'+event.target.value)).batch;this.panel.open=true;this.render();document.querySelector('[data-view="generate"]')?.click();this.schedule();}catch(error){this.notice.textContent=error.message;}};
    this.result.addEventListener('click',async event=>{
      const copy=event.target.closest('[data-content-ops-copy]'),preview=event.target.closest('[data-content-ops-preview]'),chat=event.target.closest('[data-content-ops-chat]'),reference=event.target.closest('[data-content-ops-reference]');
      try{if(copy){await navigator.clipboard.writeText(this.batch.posts[Number(copy.dataset.contentOpsCopy)].text);copy.textContent='已复制';}
      if(preview){await this.refresh();this.navigate('preview',{jobId:preview.dataset.contentOpsPreview});}
      if(chat)await this.openChat(this.batch.chatId);
      if(reference)window.dispatchEvent(new CustomEvent('content-ops:reference-focus',{detail:this.batch.references[Number(reference.dataset.contentOpsReference)]}));}catch(error){this.notice.textContent=error.message;}
    });
    void this.init();
  }
  async init(){try{
    const [config,data]=await Promise.all([configRequest||api('/api/content-ops/config'),api('/api/content-ops/batches')]);
    renderProvider(config);
    this.config=config;
    document.querySelector('#content-ops-background option[value="cached"]').disabled=!config.cachedAvailable;
    if(!config.cachedAvailable)document.querySelector('#content-ops-background').value='fresh';
    this.renderHistory(data.batches||[]);
    const request=storedRequest();
    const requested=request&&(data.batches||[]).find(batch=>batch.id===request.batchId);
    this.batch=requested||(data.batches||[]).find(batch=>batch.status==='running')||null;
    if(this.batch){this.panel.open=true;document.querySelector('#content-ops-model').value=this.batch.model;document.querySelector('#content-ops-count').value=this.batch.count;document.querySelector('#content-ops-background').value=this.batch.backgroundMode;this.render();this.schedule();}
    else {this.render();if(!config.available||!config.configured)this.notice.textContent='本机生成脚本或公司网关未配置，请检查使用说明。';}
  }catch(error){this.notice.textContent=error.message;}}
  renderHistory(batches){document.querySelector('#content-ops-history').innerHTML='<option value="">查看已保存批次</option>'+batches.map(batch=>`<option value="${esc(batch.id)}">${esc(batch.model)} · ${batch.count} 篇 · ${esc(({running:'生成中',completed:'已完成',partial:'部分完成',failed:'失败'})[batch.status]||batch.status)}</option>`).join('');}
  async submit(){
    if(this.busy||this.batch?.status==='running')return;
    let request=storedRequest();
    const references=window.contentOpsReferences?.getSelection?.()||[];
    const body={model:document.querySelector('#content-ops-model').value.trim(),platform:document.querySelector('#content-ops-platform').value,count:Number(document.querySelector('#content-ops-count').value),backgroundMode:document.querySelector('#content-ops-background').value,references};
    const signature=JSON.stringify(body);
    // Keep the same id after an uncertain network response; never bill twice.
    if(!request||request.signature!==signature)request={signature,id:crypto.randomUUID()};
    body.requestId=request.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));
    this.busy=true;this.render();this.notice.textContent='正在创建图文任务…';
    try{const data=await api('/api/content-ops/generate',body);this.batch=data.batch;request.batchId=this.batch.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));this.render();await this.refresh();this.schedule();}
    catch(error){this.notice.textContent=error.message;}
    finally{this.busy=false;document.querySelector('#content-ops-submit').disabled=this.batch?.status==='running';}
  }
  schedule(){clearTimeout(this.timer);if(this.batch?.status==='running')this.timer=setTimeout(()=>void this.poll(),1800);}
  async poll(){try{const before=this.batch.status;this.batch=(await api('/api/content-ops/batches/'+this.batch.id)).batch;this.render();if(this.batch.status!==before){await this.refresh();const data=await api('/api/content-ops/batches');this.renderHistory(data.batches||[]);}}catch(error){this.notice.textContent='读取进度失败，可刷新恢复：'+error.message;}this.schedule();}
  async stop(){if(!this.batch)return;try{await api('/api/content-ops/batches/'+this.batch.id+'/stop',{});this.notice.textContent='正在停止，已有结果保留。';this.schedule();}catch(error){this.notice.textContent=error.message;}}
  render(){
    const references=Array.isArray(this.batch?.references)?this.batch.references:[];
    window.dispatchEvent(new CustomEvent('content-ops:references',{detail:{references}}));
    const running=this.batch?.status==='running';document.querySelector('#content-ops-submit').disabled=Boolean(this.busy||running);document.querySelector('#content-ops-stop').hidden=!running;document.querySelector('#content-ops-new').hidden=!this.batch||running;
    for(const control of this.form.querySelectorAll('input,select'))control.disabled=Boolean(running);
    if(!this.batch){this.result.innerHTML='';this.notice.textContent='先生成草稿，发布前请核对事实和图片。';return;}
    const completed=this.batch.posts.filter(post=>post.status==='completed').length;
    this.notice.textContent=running?`正在生成 ${this.batch.count} 篇，已完成 ${completed} 篇…`:this.batch.status==='completed'?`已完成 ${completed} 篇图文。${this.batch.backgroundMode==='cached'?'本次复用已有背景，文案重新生成。':''}`:this.batch.error||'生成未完成，已有结果保留。';
    const request=storedRequest();if(request){request.batchId=this.batch.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));}
    const referenceLinks=references.length?`<p class="content-ops-reference-links">本批参考了：${references.map((ref,index)=>`<button type="button" class="ref-text-button" data-content-ops-reference="${index}">${esc(ref.title||ref.id)}</button>`).join('')}</p>`:'';
    this.result.innerHTML=`${this.openChat?'<div class="content-ops-batch-links"><button type="button" class="text-button" data-content-ops-chat>查看本批对话与任务</button></div>':''}<div class="content-ops-post-grid">${this.batch.posts.map((post,index)=>`<article class="content-ops-post"><h3>第 ${post.index} 篇 · ${esc(({analyzing:'生成中',completed:'已完成',failed:'未完成'})[post.status]||post.status)}</h3>${post.image?`<a href="${esc(post.image)}" download="${esc(this.batch.model)}-${post.index}.png"><img src="${esc(post.image)}" alt="${esc(this.batch.model)} 第 ${post.index} 篇封面"></a>`:'<div class="content-ops-image-pending">'+esc(post.error||'正在准备封面')+'</div>'}<pre>${esc(post.text||post.progressMessage||'正在写稿')}</pre>${referenceLinks}<div class="content-ops-actions">${post.text?`<button type="button" class="button button-outline" data-content-ops-copy="${index}">复制文案</button>`:''}${post.image?`<a class="button button-outline" href="${esc(post.image)}" download="${esc(this.batch.model)}-${post.index}.png">保存图片</a>${this.navigate?`<button type="button" class="text-button" data-content-ops-preview="${esc(post.jobId)}">燃放预览</button>`:''}`:''}</div></article>`).join('')}</div>`;
  }
}

// The current three-view shell also works when the legacy workbench bootstrap fails.
if(document.querySelector('#view-generate')&&!window.contentOpsUI)new ContentOpsUI();
