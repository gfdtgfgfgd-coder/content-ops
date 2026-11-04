const storedRequest=()=>{try{return JSON.parse(sessionStorage.getItem('hanabi.content-ops-request')||'null');}catch{return null;}};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const styleLabels={bold_typo:'撞色大字报',code_ide:'极客代码屏',card_3d:'3D卡片流程',comparison:'痛点对比',promo:'促销活动感'};
// Display is derived from the saved Markdown; copying always uses the untouched text.
export function parsePostText(text=''){
  const lines=String(text).replace(/\r\n?/g,'\n').trim().split('\n');
  const title=(lines.shift()||'').replace(/^#{1,6}\s+/,'');
  const tags=[];
  while(lines.length){
    const line=lines.at(-1).trim();
    if(!line){lines.pop();continue;}
    if(!/^(?:#[^\s#]+\s*)+$/.test(line))break;
    tags.unshift(...line.split(/\s+/));lines.pop();
  }
  return {title,body:lines.join('\n').trim(),tags};
}
export function renderPostContent(text){
  const {title,body,tags}=parsePostText(text);
  return `${title?`<h3 class="ops-post-title">${esc(title)}</h3>`:''}${body?`<div class="ops-post-body">${body.split(/\n\s*\n/).map(p=>`<p>${esc(p)}</p>`).join('')}</div>`:''}${tags.length?`<div class="ops-post-tags">${tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`:''}`;
}
const interactionIcon=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const interactions=`<div class="ops-post-interactions" aria-hidden="true"><span>${interactionIcon('M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z')}赞</span><span>${interactionIcon('m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z')}收藏</span><span>${interactionIcon('M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z')}评论</span></div>`;
async function api(path,body){const response=await fetch(path,{cache:'no-store',method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data;}
function renderProvider(config){
  const preferences=config.preferencesReady&&config.preferencesVersion?`偏好 v${config.preferencesVersion.version}（更新时间 ${config.preferencesVersion.distilledAt}）`:'偏好：实时规则已就绪';
  const provider=document.querySelector('#content-ops-provider');
  if(provider)provider.textContent=`文案：网关 ${config.textModel||'默认模型'} · 视觉：${config.visionModel||'未配置'} · 海报：${config.imageModel||'Qwen'} · ${preferences}`;
}
// Keep configuration independent of batch loading.
const configRequest=typeof document!=='undefined'&&document.querySelector('#content-ops-provider')?api('/api/content-ops/config'):null;
configRequest?.then(renderProvider).catch(error=>{const provider=document.querySelector('#content-ops-provider');if(provider)provider.textContent='偏好状态读取失败：'+error.message;});
export class ContentOpsUI {
  constructor({refresh=async()=>{},openChat}={}){
    if(window.contentOpsUI){Object.assign(window.contentOpsUI,{refresh,...(openChat?{openChat}:{})});return window.contentOpsUI;}
    Object.assign(this,{refresh,openChat});this.panel=document.querySelector('#content-ops-panel')||document.querySelector('#view-peizhi')||document.querySelector('#view-generate');this.form=document.querySelector('#content-ops-form');this.result=document.querySelector('#content-ops-results');this.notice=document.querySelector('#content-ops-status');this.batch=null;this.busy=false;this.timer=null;
    if(!this.panel||!this.form||!this.result)return;
    window.contentOpsUI=this;
    this.form.addEventListener('submit',event=>{event.preventDefault();void this.submit();});
    this.form.addEventListener('input',()=>{if(!this.batch&&!this.busy)this.render();});
    this.imageDialog=document.createElement('dialog');this.imageDialog.className='ops-image-dialog';this.imageDialog.setAttribute('aria-label','封面原图');
    this.imageDialog.innerHTML='<header><strong>封面原图</strong><button type="button" class="button button-outline" data-image-close>关闭</button></header><img alt=""><a class="button button-outline" download>保存原图</a>';
    this.panel.append(this.imageDialog);
    this.imageDialog.querySelector('[data-image-close]').onclick=()=>this.imageDialog.close();
    this.imageDialog.addEventListener('click',event=>{if(event.target===this.imageDialog){const r=this.imageDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.imageDialog.close();}});
    document.querySelector('#content-ops-style-mode')?.addEventListener('change',()=>this.syncStyleFields());
    document.querySelector('#content-ops-stop').onclick=()=>void this.stop();
    document.querySelector('#content-ops-new').onclick=()=>{clearTimeout(this.timer);this.batch=null;document.querySelector('#content-ops-history').value='';sessionStorage.removeItem('hanabi.content-ops-request');this.render();document.querySelector('#content-ops-model').focus();};
    document.querySelector('#content-ops-history').onchange=async event=>{if(!event.target.value||this.busy||this.batch?.status==='running')return;try{this.batch=(await api('/api/content-ops/batches/'+event.target.value)).batch;this.panel.open=true;this.applyBatchToForm(this.batch);this.render();document.querySelector('[data-view="generate"]')?.click();this.schedule();}catch(error){this.notice.textContent=error.message;}};
    this.result.addEventListener('click',async event=>{
      const copy=event.target.closest('[data-content-ops-copy]'),zoom=event.target.closest('[data-content-ops-zoom]'),chat=event.target.closest('[data-content-ops-chat]'),reference=event.target.closest('[data-content-ops-reference]');
      try{if(copy){await navigator.clipboard.writeText(this.batch.posts[Number(copy.dataset.contentOpsCopy)].text);copy.textContent='已复制';}
      if(zoom){const post=this.batch.posts[Number(zoom.dataset.contentOpsZoom)],image=this.imageDialog.querySelector('img'),save=this.imageDialog.querySelector('a');image.src=post.image;image.alt=`${this.batch.model} 第 ${post.index} 篇封面原图`;save.href=post.image;save.download=`${this.batch.model}-${post.index}.png`;this.imageDialog.showModal();}
      if(chat)await this.openChat(this.batch.chatId);
      if(reference)window.dispatchEvent(new CustomEvent('content-ops:reference-focus',{detail:this.batch.references[Number(reference.dataset.contentOpsReference)]}));}catch(error){this.notice.textContent=error.message;}
    });
    this.syncStyleFields();this.render();
    void this.init();
  }
  syncStyleFields(){
    const manual=document.querySelector('#content-ops-style-mode')?.value==='manual';
    const presetField=document.querySelector('#content-ops-style-preset-field');
    const promptField=document.querySelector('#content-ops-style-prompt-field');
    if(presetField)presetField.hidden=!manual;
    if(promptField)promptField.hidden=!manual;
  }
  applyBatchToForm(batch){
    if(!batch)return;
    document.querySelector('#content-ops-model').value=batch.model;
    document.querySelector('#content-ops-count').value=batch.count;
    if(batch.platform)document.querySelector('#content-ops-platform').value=batch.platform;
    document.querySelector('#content-ops-background').value=batch.backgroundMode;
    if(document.querySelector('#content-ops-style-mode'))document.querySelector('#content-ops-style-mode').value=batch.styleMode||'auto';
    if(document.querySelector('#content-ops-style-preset'))document.querySelector('#content-ops-style-preset').value=batch.stylePreset||'';
    if(document.querySelector('#content-ops-style-prompt'))document.querySelector('#content-ops-style-prompt').value=batch.stylePrompt||'';
    document.querySelector('#content-ops-brief').value=batch.brief||'';
    this.syncStyleFields();
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
    if(this.batch){this.panel.open=true;this.applyBatchToForm(this.batch);this.render();this.schedule();}
    else {this.render();if(!config.available||!config.configured)this.notice.textContent='本机生成脚本或公司网关未配置，请检查使用说明。';}
  }catch(error){this.notice.textContent=error.message;}}
  async refreshConfig(){
    const config=await api('/api/content-ops/config');
    this.config=config;renderProvider(config);
    document.querySelector('#content-ops-background option[value="cached"]').disabled=!config.cachedAvailable;
    if(!config.cachedAvailable)document.querySelector('#content-ops-background').value='fresh';
    if(!this.busy&&!this.batch)this.notice.textContent=config.configured?'接口配置已更新。':'请通过左下角接口接入完成配置。';
  }
  renderHistory(batches){const history=document.querySelector('#content-ops-history');history.innerHTML='<option value="">查看已保存批次</option>'+batches.map(batch=>`<option value="${esc(batch.id)}">${esc(batch.model)} · ${batch.count} 篇 · ${esc(({running:'生成中',completed:'已完成',partial:'部分完成',failed:'失败'})[batch.status]||batch.status)}</option>`).join('');history.value=this.batch?.id||'';}
  async submit(){
    if(this.busy||this.batch?.status==='running')return;
    let request=storedRequest();
    const references=window.contentOpsReferences?.getSelection?.()||[];
    const brief=document.querySelector('#content-ops-brief').value;
    if(Array.from(brief).length>1000){this.notice.textContent='需求不能超过1000字。';return;}
    const styleMode=document.querySelector('#content-ops-style-mode')?.value||'auto';
    const stylePreset=styleMode==='manual'?(document.querySelector('#content-ops-style-preset')?.value||''):'';
    const stylePrompt=styleMode==='manual'?(document.querySelector('#content-ops-style-prompt')?.value||'').trim():'';
    if(Array.from(stylePrompt).length>500){this.notice.textContent='自定义画面感觉不能超过500字。';return;}
    if(styleMode==='manual'&&!stylePreset&&!stylePrompt){this.notice.textContent='手动风格模式下，请至少选择一种预设风格或填写自定义画面感觉。';return;}
    const body={brief,model:document.querySelector('#content-ops-model').value.trim(),platform:document.querySelector('#content-ops-platform').value,count:Number(document.querySelector('#content-ops-count').value),backgroundMode:document.querySelector('#content-ops-background').value,styleMode,stylePreset,stylePrompt,references};
    const signature=JSON.stringify(body);
    // Keep the same id after an uncertain network response; never bill twice.
    if(!request||request.signature!==signature)request={signature,id:crypto.randomUUID()};
    body.requestId=request.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));
    let failure='';this.busy=true;this.render();this.notice.textContent='正在创建图文任务…';
    try{const data=await api('/api/content-ops/generate',body);this.batch=data.batch;request.batchId=this.batch.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));this.render();await this.refresh();this.schedule();}
    catch(error){failure=error.message;}
    finally{this.busy=false;this.render();if(failure)this.notice.textContent=failure;}
  }
  schedule(){clearTimeout(this.timer);if(this.batch?.status==='running')this.timer=setTimeout(()=>void this.poll(),1800);}
  async poll(){try{const before=this.batch.status;this.batch=(await api('/api/content-ops/batches/'+this.batch.id)).batch;this.render();if(this.batch.status!==before){await this.refresh();const data=await api('/api/content-ops/batches');this.renderHistory(data.batches||[]);}}catch(error){this.notice.textContent='读取进度失败，可刷新恢复：'+error.message;}this.schedule();}
  async stop(){if(!this.batch)return;try{await api('/api/content-ops/batches/'+this.batch.id+'/stop',{});this.notice.textContent='正在停止，已有结果保留。';this.schedule();}catch(error){this.notice.textContent=error.message;}}
  render(){
    const references=Array.isArray(this.batch?.references)?this.batch.references:[];
    window.dispatchEvent(new CustomEvent('content-ops:references',{detail:{references}}));
    const running=this.batch?.status==='running',locked=Boolean(this.busy||running);
    document.querySelector('#content-ops-submit').disabled=locked;document.querySelector('#content-ops-stop').hidden=!running;document.querySelector('#content-ops-new').hidden=!this.batch||locked;
    document.querySelector('#content-ops-history').disabled=locked;
    for(const control of this.form.querySelectorAll('input,select,textarea'))control.disabled=locked;
    this.result.setAttribute('aria-busy',String(locked));
    const completed=this.batch?.posts.filter(post=>post.status==='completed').length||0;
    const state=document.querySelector('#content-ops-batch-state');
    if(state){state.textContent=this.busy?'创建中':running?`生成中 · ${completed}/${this.batch.count}`:this.batch?({completed:`已完成 · ${completed} 篇`,partial:'部分完成',failed:'未完成'}[this.batch.status]||this.batch.status):'待生成';state.dataset.state=locked?'running':this.batch?.status||'empty';}
    if(!this.batch)this.notice.textContent=this.busy?'正在创建图文任务…':'填写需求后开始生成，或打开历史批次继续审阅。';
    else{
      this.notice.textContent=running?`正在生成 ${this.batch.count} 篇，已完成 ${completed} 篇…`:this.batch.status==='completed'?`已完成 ${completed} 篇图文。${this.batch.backgroundMode==='cached'?'本次复用已有背景，文案重新生成。':''}`:this.batch.error||'生成未完成，已有结果保留。';
      const request=storedRequest();if(request){request.batchId=this.batch.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));}
      document.querySelector('#content-ops-history').value=this.batch.id;
    }
    const platform=this.batch?.platform||document.querySelector('#content-ops-platform').value;
    const manual=(this.batch?.styleMode||document.querySelector('#content-ops-style-mode').value)==='manual';
    const preset=this.batch?this.batch.stylePreset:document.querySelector('#content-ops-style-preset').value;
    const prompt=this.batch?this.batch.stylePrompt:document.querySelector('#content-ops-style-prompt').value;
    const style=manual?['手动',styleLabels[preset]||preset,prompt].filter(Boolean).join(' · '):'自动匹配参考图';
    const brief=this.batch?esc(this.batch.brief):esc(document.querySelector('#content-ops-brief').value);
    const summary=`<div class="ops-batch-summary"><div class="ops-batch-spec"><strong>${platform==='xianyu'?'闲鱼 · 宝贝':'小红书 · 图文笔记'}</strong><span>${platform==='xianyu'?'1:1 · 1080 × 1080':'3:4 · 1080 × 1440'}</span></div><p><strong>封面风格</strong><span>${esc(style)}</span></p><p><strong>${this.batch?'本批需求':'当前需求'}</strong><span>${brief||'未填写额外需求，按模型与参考帖生成。'}</span></p></div>`;
    const referenceLinks=references.length?`<p class="content-ops-reference-links">本批参考：${references.map((ref,index)=>`<button type="button" class="ref-text-button" data-content-ops-reference="${index}">${esc(ref.title||ref.id)}</button>`).join('')}</p>`:'';
    const cards=this.batch?`<div class="content-ops-post-grid">${this.batch.posts.map((post,index)=>{
      const xianyu=platform==='xianyu';
      // Highlight only prices already present in the saved copy; no invented engagement.
      const price=post.text?.match(/(?:[¥￥]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*元)(?:\s*[/／]\s*[月年天日次])?/u)?.[0];
      return `<article class="content-ops-post content-ops-post--${xianyu?'xianyu':'xhs'}" aria-label="第 ${post.index} 篇${xianyu?'宝贝':'笔记'}"><header class="ops-post-header"><span class="ops-platform-badge">${xianyu?'闲鱼':'小红书'}</span><span>${xianyu?'宝贝详情':'图文笔记'} · ${post.index}</span><span class="ops-post-status" data-state="${esc(post.status)}">${esc(({analyzing:'生成中',completed:'已完成',failed:'未完成',queued:'等待中'})[post.status]||post.status)}</span></header>${post.image?`<button type="button" class="ops-post-cover" data-content-ops-zoom="${index}" aria-label="放大第 ${post.index} 篇封面"><img src="${esc(post.image)}" alt="${esc(this.batch.model)} 第 ${post.index} 篇封面"></button>`:`<div class="content-ops-image-pending" role="status"><strong>${post.status==='failed'?'封面未完成':'封面生成中'}</strong><span>${esc(post.error||post.progressMessage||'文案与封面将在这里依次出现')}</span></div>`}${xianyu?`<div class="ops-product-highlight"><strong>${price?esc(price):'价格见宝贝描述'}</strong><span>想要人数 · 待发布</span></div>`:''}<div class="ops-post-content">${post.text?renderPostContent(post.text):`<p class="ops-post-progress">${esc(post.progressMessage||post.error||'正在准备文案…')}</p>`}${post.error&&post.text?`<p class="ops-post-error">${esc(post.error)}</p>`:''}</div><footer class="ops-post-footer">${xianyu?'':interactions}<div class="content-ops-actions">${post.text?`<button type="button" class="button button-outline" data-content-ops-copy="${index}">${xianyu?'复制宝贝描述':'复制文案'}</button>`:''}${post.image?`<a class="button button-outline" href="${esc(post.image)}" download="${esc(this.batch.model)}-${post.index}.png">${xianyu?'保存主图':'保存海报'}</a>`:''}</div></footer></article>`;
    }).join('')}</div>`:`<div class="ops-board-empty"><div class="ops-empty-sheet" aria-hidden="true"><span>封面</span><i></i><i></i></div><h3>${this.busy?'正在创建本批图文':'下一篇内容，从这里开始'}</h3><p>设置左侧参数并生成，或选择历史批次。<br>成稿会按平台样式出现在这里。</p></div>`;
    const html=summary+referenceLinks+(this.openChat&&this.batch?'<div class="content-ops-batch-links"><button type="button" class="text-button" data-content-ops-chat>查看本批对话与任务</button></div>':'')+cards;
    if(html!==this.renderedResult){
      const active=document.activeElement,action=active?.closest('[data-content-ops-copy],[data-content-ops-zoom]');
      const attribute=action?.hasAttribute('data-content-ops-copy')?'data-content-ops-copy':'data-content-ops-zoom';
      const value=action?.getAttribute(attribute);
      this.result.innerHTML=html;this.renderedResult=html;
      if(action)this.result.querySelector(`[${attribute}="${value}"]`)?.focus({preventScroll:true});
    }
  }
}

if(typeof document!=='undefined'&&document.querySelector('#view-generate')&&!window.contentOpsUI)new ContentOpsUI();
