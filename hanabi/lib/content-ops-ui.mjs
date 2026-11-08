import { ContentOpsRevisionUI } from './content-ops-revision-ui.mjs';
const storedRequest=()=>{try{return JSON.parse(sessionStorage.getItem('hanabi.content-ops-request')||'null');}catch{return null;}};
const storedReferences=()=>{try{const value=JSON.parse(sessionStorage.getItem('content-ops-reference-selection')||'[]');return Array.isArray(value)?value.filter(ref=>ref&&['xhs','xianyu'].includes(ref.platform)&&ref.id!=null).map(ref=>({platform:ref.platform,id:String(ref.id)})):[];}catch{return[];}};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const styleLabels={bold_typo:'撞色大字报',code_ide:'极客代码屏',card_3d:'3D卡片流程',comparison:'痛点对比',promo:'促销活动感'};
const copyFormatLabels={all_variations:'全套多样化',format_1:'极简转化',format_2:'工具场景',format_3:'精准圈人'};
const TERMINAL_BATCH=new Set(['failed','partial','completed']);
/** Mint a fresh request when the current batch already finished; otherwise keep idempotent retries. */
export function nextGenerateRequest(stored,signature,batchStatus,createId=()=>crypto.randomUUID()){
  if(TERMINAL_BATCH.has(batchStatus)||!stored||stored.signature!==signature)return{signature,id:createId()};
  return stored;
}
export function generateSubmitLabel({busy=false,running=false,batchStatus=''}={}){
  if(busy)return'创建中…';
  if(running)return'生成中…';
  if(batchStatus==='failed'||batchStatus==='partial')return'重新生成';
  if(batchStatus==='completed')return'再生成一批';
  return'开始生成';
}
export const copiesForPost=post=>Array.isArray(post?.copies)&&post.copies.length?post.copies:(post?.text?[{index:1,text:post.text}]:[]);
export const selectedCopy=(post,position=0)=>copiesForPost(post)[position]||copiesForPost(post)[0]||{text:''};
const hydratedReferences=(references,liveReferences)=>Array.isArray(references)?references.map(ref=>liveReferences.find(item=>item.platform===ref.platform&&String(item.id)===String(ref.id))||ref):[];
const richText=text=>esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
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
  return `${title?`<h3 class="ops-post-title">${esc(title)}</h3>`:''}${body?`<div class="ops-post-body">${body.split(/\n\s*\n/).map(p=>`<p>${richText(p)}</p>`).join('')}</div>`:''}${tags.length?`<div class="ops-post-tags">${tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`:''}`;
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
    Object.assign(this,{refresh,openChat});this.panel=document.querySelector('#content-ops-panel')||document.querySelector('#view-peizhi')||document.querySelector('#view-generate');this.form=document.querySelector('#content-ops-form');this.result=document.querySelector('#content-ops-results');this.notice=document.querySelector('#content-ops-status');this.batch=null;this.selectedCopies=new Map();this.busy=false;this.timer=null;
    if(!this.panel||!this.form||!this.result)return;
    window.contentOpsUI=this;
    this.selectedRefs=document.querySelector('#content-ops-selected-refs');
    this.referenceHint=document.querySelector('#content-ops-reference-hint');
    this.liveReferences=[];
    this.referenceLoadVersion=0;
    window.addEventListener('content-ops:reference-selection',event=>{void this.loadReferenceCards(event.detail?.references||[]);});
    document.addEventListener('content-ops:view',()=>this.renderReferenceCards());
    this.form.addEventListener('submit',event=>{event.preventDefault();void this.submit();});
    this.form.addEventListener('input',()=>{this.formEdited=true;if(!this.batch&&!this.busy)this.render();});
    this.imageDialog=document.createElement('dialog');this.imageDialog.className='ops-image-dialog';this.imageDialog.setAttribute('aria-label','封面原图');
    this.imageDialog.innerHTML='<header><strong>封面原图</strong><button type="button" class="button button-outline" data-image-close>关闭</button></header><img alt=""><a class="button button-outline" download>保存原图</a>';
    this.panel.append(this.imageDialog);
    this.imageDialog.querySelector('[data-image-close]').onclick=()=>this.imageDialog.close();
    this.imageDialog.addEventListener('click',event=>{if(event.target===this.imageDialog){const r=this.imageDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.imageDialog.close();}});
    document.querySelector('#content-ops-style-mode')?.addEventListener('change',()=>this.syncStyleFields());
    document.querySelector('#content-ops-stop').onclick=()=>void this.stop();
    document.querySelector('#content-ops-resume')?.addEventListener('click',()=>void this.resume());
    document.querySelector('#content-ops-new').onclick=()=>{clearTimeout(this.timer);this.batch=null;document.querySelector('#content-ops-history').value='';sessionStorage.removeItem('hanabi.content-ops-request');sessionStorage.removeItem('hanabi.content-ops-review-batch');void this.loadReferenceCards(storedReferences());this.render();document.querySelector('#content-ops-model').focus();};
    document.querySelector('#content-ops-history').onchange=async event=>{if(!event.target.value||this.busy||this.batch?.status==='running')return;try{this.batch=(await api('/api/content-ops/batches/'+event.target.value)).batch;this.panel.open=true;this.applyBatchToForm(this.batch);await this.loadReferenceCards(storedReferences());this.render();document.querySelector('[data-view="generate"]')?.click();this.schedule();}catch(error){this.notice.textContent=error.message;}};
    this.result.addEventListener('click',async event=>{
      const tab=event.target.closest('[data-copy-version]'),copy=event.target.closest('[data-content-ops-copy]'),zoom=event.target.closest('[data-content-ops-zoom]'),chat=event.target.closest('[data-content-ops-chat]'),reference=event.target.closest('[data-content-ops-reference]');
      const downloadCopy=event.target.closest('[data-content-ops-download-copy]');
      if(downloadCopy){const post=this.batch.posts[Number(downloadCopy.dataset.contentOpsDownloadCopy)],url=URL.createObjectURL(new Blob([this.currentCopy(post).text],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`${this.batch.model}-${post.index}-文案${String.fromCharCode(65+(this.selectedCopies.get(`${this.batch.id}:${post.index}`)||0))}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
      const edit=event.target.closest('[data-edit-kind]');
      if(edit){void this.revisionEditor.open(Number(edit.dataset.editPost),edit.dataset.editKind);return;}
      try{if(tab){const post=this.batch.posts[Number(tab.dataset.copyPost)];this.selectedCopies.set(`${this.batch.id}:${post.index}`,Number(tab.dataset.copyVersion));this.render();}
      if(copy){await navigator.clipboard.writeText(this.currentCopy(this.batch.posts[Number(copy.dataset.contentOpsCopy)]).text);copy.textContent='已复制';}
      if(zoom){const post=this.batch.posts[Number(zoom.dataset.contentOpsZoom)],image=this.imageDialog.querySelector('img'),save=this.imageDialog.querySelector('a');image.src=post.image;image.alt=`${this.batch.model} 第 ${post.index} 篇封面原图`;save.href=post.image;save.download=`${this.batch.model}-${post.index}.png`;this.imageDialog.showModal();}
      if(chat)await this.openChat(this.batch.chatId);
      if(reference)window.dispatchEvent(new CustomEvent('content-ops:reference-focus',{detail:hydratedReferences(this.batch.references,this.liveReferences)[Number(reference.dataset.contentOpsReference)]}));}catch(error){this.notice.textContent=error.message;}
    });
    this.result.addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-copy-version]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const tabs=[...tab.parentElement.querySelectorAll('[data-copy-version]')],index=tabs.indexOf(tab);
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      event.preventDefault();tabs[next].click();this.result.querySelector(`[data-copy-post="${tab.dataset.copyPost}"][data-copy-version="${next}"]`)?.focus();
    });
    this.revisionEditor=new ContentOpsRevisionUI(this,{parsePostText,renderPostContent});
    this.syncStyleFields();this.render();
    const initial=storedReferences();void this.loadReferenceCards(initial);
    document.querySelector('#content-ops-ref-generate')?.addEventListener('click',()=>document.querySelector('[data-view="generate"]')?.click());
    void this.init();
  }
  currentCopy(post){return selectedCopy(post,this.selectedCopies.get(`${this.batch.id}:${post.index}`)||0);}
  async loadReferenceCards(references){
    const version=++this.referenceLoadVersion;
    const keys=new Map((Array.isArray(references)?references:[]).filter(ref=>ref?.platform&&ref?.id).map(ref=>[`${ref.platform}:${ref.id}`,ref]));
    const hydrated=[];
    for(const platform of ['xhs','xianyu']){
      const ids=[...keys.values()].filter(ref=>ref.platform===platform).map(ref=>String(ref.id));
      if(!ids.length)continue;
      try{const data=await api(`/api/content-ops/references?${new URLSearchParams({platform,ids:ids.join(','),limit:String(ids.length)})}`);hydrated.push(...data.posts);}
      catch{hydrated.push(...[...keys.values()].filter(ref=>ref.platform===platform));}
    }
    const byKey=new Map(hydrated.map(ref=>[`${ref.platform}:${ref.id}`,ref]));
    if(version!==this.referenceLoadVersion)return;
    this.liveReferences=[...keys.values()].map(ref=>byKey.get(`${ref.platform}:${ref.id}`)||ref);
    this.renderReferenceCards();
  }
  renderReferenceCards(){
    if(!this.selectedRefs)return;
    const references=this.liveReferences,visible=document.querySelector('#view-generate')?.classList.contains('active');
    this.selectedRefs.innerHTML=references.length?`<div class="selected-refs-heading"><strong>当前草稿引用素材 · ${references.length} 张</strong><button type="button" class="text-button" data-ref-clear>清空引用</button></div><div class="selected-refs-grid">${references.map((ref,index)=>`<article class="selected-ref-card"><button type="button" class="selected-ref-open" data-ref-open="${index}" aria-label="在素材库定位 ${esc(ref.title||ref.id)}">${ref.image?`<img src="${esc(ref.image)}" alt="">`:'<span class="selected-ref-no-image">暂无封面</span>'}<span class="ops-platform-badge">${ref.platform==='xianyu'?'闲鱼':'小红书'}</span><strong>${esc(ref.title||ref.id)}</strong></button><button type="button" class="selected-ref-remove" data-ref-remove="${index}">移除</button></article>`).join('')}</div><p class="selected-refs-note">AI 视觉模型将读取以上封面作为构图、配色与字形排版参考</p>`:`<p>未指定参考素材，系统将自动匹配同平台最佳参考 <button type="button" class="text-button" data-ref-pick>去素材库挑选 →</button></p>`;
    const count=references.length;
    if(this.referenceHint)this.referenceHint.textContent=count?`当前已就绪 ${count} 张参考封面图，多模态模型将深度分析其视觉特征。`:'未指定参考素材，系统将自动匹配同平台最佳参考。';
    if(!this.selectedRefs.dataset.bound){
      this.selectedRefs.dataset.bound='true';this.selectedRefs.addEventListener('click',event=>{
        if(event.target.closest('[data-ref-pick]'))document.querySelector('[data-view="references"]')?.click();
        const open=event.target.closest('[data-ref-open]');if(open){const ref=this.liveReferences[Number(open.dataset.refOpen)];if(ref)window.dispatchEvent(new CustomEvent('content-ops:reference-focus',{detail:ref}));}
        const remove=event.target.closest('[data-ref-remove]');if(remove){const index=Number(remove.dataset.refRemove);const target=this.liveReferences[index];this.liveReferences=this.liveReferences.filter((_,i)=>i!==index);if(target)window.contentOpsReferences?.removeSelection?.(target);this.renderReferenceCards();}
        if(event.target.closest('[data-ref-clear]')){this.liveReferences=[];window.contentOpsReferences?.clearSelectionNow?.();this.renderReferenceCards();}
      });
    }
    this.selectedRefs.hidden=!visible;
    if(this.referenceHint)this.referenceHint.hidden=!visible;
  }
  syncStyleFields(){
    const manual=document.querySelector('#content-ops-style-mode')?.value==='manual';
    const advanced=document.querySelector('#content-ops-style-advanced');
    const presetField=document.querySelector('#content-ops-style-preset-field');
    const promptField=document.querySelector('#content-ops-style-prompt-field');
    if(presetField)presetField.hidden=!manual;
    if(promptField)promptField.hidden=!manual;
    if(advanced){
      advanced.hidden=!manual;
      if(manual)advanced.open=true;
    }
  }
  applyBatchToForm(batch){
    if(!batch)return;
    document.querySelector('#content-ops-model').value=batch.model;
    document.querySelector('#content-ops-count').value=batch.count;
    document.querySelector('#content-ops-copy-format').value=batch.copyFormat||'all_variations';
    document.querySelector('#content-ops-copy-multiplier').value=batch.copyMultiplier??1;
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
    if(!this.formEdited){document.querySelector('#content-ops-copy-format').value=config.copyFormat||'all_variations';document.querySelector('#content-ops-copy-multiplier').value=config.copyMultiplier??3;}
    document.querySelector('#content-ops-background option[value="cached"]').disabled=!config.cachedAvailable;
    if(!config.cachedAvailable)document.querySelector('#content-ops-background').value='fresh';
    this.renderProductModels(config.productModels||[]);
    this.renderHistory(data.batches||[]);
    const request=storedRequest();
    const requested=request&&(data.batches||[]).find(batch=>batch.id===request.batchId);
    const reviewed=(data.batches||[]).find(batch=>batch.id===sessionStorage.getItem('hanabi.content-ops-review-batch'));
    this.batch=requested||(data.batches||[]).find(batch=>batch.status==='running')||reviewed||null;
    if(this.batch){this.panel.open=true;this.applyBatchToForm(this.batch);await this.loadReferenceCards(storedReferences());this.render();this.schedule();}
    else {this.render();if(!config.available||!config.configured)this.notice.textContent='本机生成脚本或公司网关未配置，请检查使用说明。';}
  }catch(error){this.notice.textContent=error.message;}}
  async refreshConfig(){
    const config=await api('/api/content-ops/config');
    this.config=config;renderProvider(config);
    document.querySelector('#content-ops-background option[value="cached"]').disabled=!config.cachedAvailable;
    if(!config.cachedAvailable)document.querySelector('#content-ops-background').value='fresh';
    this.renderProductModels(config.productModels||[]);
    if(!this.busy&&!this.batch)this.notice.textContent=config.configured?'接口配置已更新。':'请通过左下角接口接入完成配置。';
  }
  renderProductModels(models){
    const list=document.querySelector('#content-ops-model-list');
    const hint=document.querySelector('#content-ops-model-hint');
    if(list)list.innerHTML=models.map(model=>`<option value="${esc(model.id)}"></option>`).join('');
    if(hint)hint.textContent=models.length?`语料已接入：${models.map(model=>model.id).join('、')}。输入名会原样出现在封面/文案；命中别名时只借用语料事实，不改对外型号写法。`:'尚未读到 model-corpus 专节；仍可按输入名生成，封面短词走通用回落。';
  }
  renderHistory(batches){const history=document.querySelector('#content-ops-history');history.innerHTML='<option value="">查看已保存批次</option>'+batches.map(batch=>`<option value="${esc(batch.id)}">${esc(batch.model)} · ${batch.count} 张图 / ${batch.copyCount??batch.count} 篇 · ${esc(({running:'生成中',completed:'已完成',partial:'部分完成',failed:'失败'})[batch.status]||batch.status)}</option>`).join('');history.value=this.batch?.id||'';}
  async submit(){
    if(this.busy||this.batch?.status==='running')return;
    const references=storedReferences();
    const brief=document.querySelector('#content-ops-brief').value;
    if(Array.from(brief).length>1000){this.notice.textContent='需求不能超过1000字。';return;}
    const styleMode=document.querySelector('#content-ops-style-mode')?.value||'auto';
    const stylePreset=styleMode==='manual'?(document.querySelector('#content-ops-style-preset')?.value||''):'';
    const stylePrompt=styleMode==='manual'?(document.querySelector('#content-ops-style-prompt')?.value||'').trim():'';
    if(Array.from(stylePrompt).length>500){this.notice.textContent='自定义画面感觉不能超过500字。';return;}
    if(styleMode==='manual'&&!stylePreset&&!stylePrompt){this.notice.textContent='手动风格模式下，请至少选择一种预设风格或填写自定义画面感觉。';return;}
    const copyFormat=document.querySelector('#content-ops-copy-format').value,copyMultiplier=Number(document.querySelector('#content-ops-copy-multiplier').value);
    if(!Number.isInteger(copyMultiplier)||copyMultiplier<1||copyMultiplier>5){this.notice.textContent='每张封面文案数须为 1–5 的整数。';return;}
    const body={copyFormat,copyMultiplier,brief,model:document.querySelector('#content-ops-model').value.trim(),platform:document.querySelector('#content-ops-platform').value,count:Number(document.querySelector('#content-ops-count').value),backgroundMode:document.querySelector('#content-ops-background').value,styleMode,stylePreset,stylePrompt,references};
    const signature=JSON.stringify(body);
    // Idempotent while in-flight; failed/completed batches must mint a new id or the API silently returns the old row.
    const request=nextGenerateRequest(storedRequest(),signature,this.batch?.status);
    body.requestId=request.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));
    const redo=['failed','partial'].includes(this.batch?.status);
    let failure='';this.busy=true;this.render();this.notice.textContent=redo?'正在重新生成…':'正在创建图文任务…';
    try{const data=await api('/api/content-ops/generate',body);this.batch=data.batch;request.batchId=this.batch.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));this.render();await this.refresh();this.schedule();}
    catch(error){failure=error.message;}
    finally{this.busy=false;this.render();if(failure)this.notice.textContent=failure;}
  }
  schedule(){clearTimeout(this.timer);if(this.batch?.status==='running')this.timer=setTimeout(()=>void this.poll(),1800);}
  async poll(){try{const before=this.batch.status;this.batch=(await api('/api/content-ops/batches/'+this.batch.id)).batch;this.render();if(this.batch.status!==before){await this.refresh();const data=await api('/api/content-ops/batches');this.renderHistory(data.batches||[]);}}catch(error){this.notice.textContent='读取进度失败，可刷新恢复：'+error.message;}this.schedule();}
  async resume(){
    if(!this.batch||this.busy||this.batch.status==='running')return;
    this.busy=true;this.render();this.notice.textContent='正在复用已有文案和视觉响应，仅继续未完成阶段…';let failure='';
    try{const data=await api('/api/content-ops/batches/'+this.batch.id+'/resume',{});this.batch=data.batch;this.render();this.schedule();}
    catch(error){failure=error.message;}
    finally{this.busy=false;this.render();if(failure)this.notice.textContent=failure;}
  }
  async stop(){if(!this.batch)return;try{await api('/api/content-ops/batches/'+this.batch.id+'/stop',{});this.notice.textContent='正在停止，已有结果保留。';this.schedule();}catch(error){this.notice.textContent=error.message;}}
  render(){
    const references=this.batch?.references||[];
    const running=this.batch?.status==='running',locked=Boolean(this.busy||running);
    const submit=document.querySelector('#content-ops-submit');
    submit.disabled=locked;
    submit.textContent=generateSubmitLabel({busy:this.busy,running,batchStatus:this.batch?.status||''});
    document.querySelector('#content-ops-stop').hidden=!running;document.querySelector('#content-ops-new').hidden=!this.batch||locked;
    const resume=document.querySelector('#content-ops-resume');if(resume)resume.hidden=locked||!this.batch?.resumable;
    document.querySelector('#content-ops-history').disabled=locked;
    for(const control of this.form.querySelectorAll('input,select,textarea'))control.disabled=locked;
    this.result.setAttribute('aria-busy',String(locked));
    const completed=this.batch?.posts.filter(post=>post.status==='completed').length||0;
    const state=document.querySelector('#content-ops-batch-state');
    if(state){state.textContent=this.busy?'创建中':running?`生成中 · ${completed}/${this.batch.count}`:this.batch?({completed:`已完成 · ${completed} 张图 / ${this.batch.copyCount??completed} 篇文案`,partial:'部分完成',failed:'未完成'}[this.batch.status]||this.batch.status):'待生成';state.dataset.state=locked?'running':this.batch?.status||'empty';}
    if(!this.batch)this.notice.textContent=this.busy?'正在创建图文任务…':'填写需求后开始生成，或打开历史批次继续审阅。';
    else{
      this.notice.textContent=running?`正在生成 ${this.batch.count} 张图 / ${this.batch.copyCount??this.batch.count} 篇文案，已完成 ${completed} 张封面组…`:this.batch.status==='completed'?`已完成 ${completed} 张图 / ${this.batch.copyCount??completed} 篇文案。${this.batch.backgroundMode==='cached'?'本次复用已有背景，文案重新生成。':''}`:this.batch.error||'生成未完成，已有结果保留。';
      const request=storedRequest();if(request){request.batchId=this.batch.id;sessionStorage.setItem('hanabi.content-ops-request',JSON.stringify(request));}
      document.querySelector('#content-ops-history').value=this.batch.id;sessionStorage.setItem('hanabi.content-ops-review-batch',this.batch.id);
    }
    const platform=this.batch?.platform||document.querySelector('#content-ops-platform').value;
    const manual=(this.batch?.styleMode||document.querySelector('#content-ops-style-mode').value)==='manual';
    const preset=this.batch?this.batch.stylePreset:document.querySelector('#content-ops-style-preset').value;
    const prompt=this.batch?this.batch.stylePrompt:document.querySelector('#content-ops-style-prompt').value;
    const style=manual?['手动',styleLabels[preset]||preset,prompt].filter(Boolean).join(' · '):'自动匹配参考图';
    const brief=this.batch?esc(this.batch.brief):esc(document.querySelector('#content-ops-brief').value);
    const multiplier=this.batch?.copyMultiplier??Number(document.querySelector('#content-ops-copy-multiplier').value);
    const imageCount=this.batch?.count??Number(document.querySelector('#content-ops-count').value);
    const copyFormat=this.batch?.copyFormat||document.querySelector('#content-ops-copy-format').value;
    document.querySelector('#content-ops-copy-hint').textContent=`输入 ${imageCount} 张图时，自动生成 ${imageCount*multiplier} 套不同切入角度的文案供挑选`;
    const summary=`<div class="ops-batch-summary"><div class="ops-batch-spec"><strong>${platform==='xianyu'?'闲鱼 · 宝贝':'小红书 · 图文笔记'}</strong><span>${platform==='xianyu'?'1:1 · 1080 × 1080':'3:4 · 1080 × 1440'}</span></div><p><strong>文案配比</strong><span>${imageCount} 张图 × ${multiplier} = ${imageCount*multiplier} 篇 · ${esc(copyFormatLabels[copyFormat]||copyFormat)}</span></p><p><strong>封面风格</strong><span>${esc(style)}</span></p><p><strong>${this.batch?'本批需求':'当前需求'}</strong><span>${brief||'未填写额外需求，按模型与参考帖生成。'}</span></p></div>`;
    const referenceLinks=references.length?`<section class="content-ops-reference-links"><strong>本批参考素材</strong><div class="content-ops-preview-refs">${references.map((ref,index)=>`<button type="button" class="content-ops-preview-ref" data-content-ops-reference="${index}">${ref.image?`<img src="${esc(ref.image)}" alt="">`:''}<span class="ops-platform-badge">${ref.platform==='xianyu'?'闲鱼':'小红书'}</span><span>${esc(ref.title||ref.id)}</span></button>`).join('')}</div></section>`:'';
    const cards=this.batch?`<div class="content-ops-post-grid">${this.batch.posts.map((post,index)=>{
      const xianyu=platform==='xianyu',versions=copiesForPost(post),current=this.currentCopy(post);
      const tabs=versions.length>1?`<div class="ops-copy-tabs" role="tablist" aria-label="第 ${post.index} 张封面的文案版本">${versions.map((version,i)=>`<button type="button" role="tab" id="ops-copy-tab-${post.index}-${i}" aria-selected="${version===current}" aria-controls="ops-copy-panel-${post.index}" tabindex="${version===current?0:-1}" data-copy-post="${index}" data-copy-version="${i}" title="${esc(copyFormatLabels[version.copyFormat]||'文案版本')}">文案 ${String.fromCharCode(65+i)}</button>`).join('')}</div>`:'';
      // Highlight only prices already present in the saved copy; no invented engagement.
      const price=current.text?.match(/(?:[¥￥]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*元)(?:\s*[/／]\s*[月年天日次])?/u)?.[0];
      return `<article class="content-ops-post content-ops-post--${xianyu?'xianyu':'xhs'}" aria-label="第 ${post.index} 篇${xianyu?'宝贝':'笔记'}"><header class="ops-post-header"><span class="ops-platform-badge">${xianyu?'闲鱼':'小红书'}</span><span>${xianyu?'宝贝详情':'图文笔记'} · ${post.index}</span><span class="ops-post-status" data-state="${esc(post.status)}">${esc(({analyzing:'生成中',completed:'已完成',failed:'未完成',queued:'等待中'})[post.status]||post.status)}</span></header>${post.image?`<button type="button" class="ops-post-cover" data-content-ops-zoom="${index}" aria-label="放大第 ${post.index} 篇封面"><img src="${esc(post.image)}" alt="${esc(this.batch.model)} 第 ${post.index} 篇封面"></button>`:`<div class="content-ops-image-pending" role="status"><strong>${post.status==='failed'?'封面未完成':'封面生成中'}</strong><span>${esc(post.error||post.progressMessage||'文案与封面将在这里依次出现')}</span></div>`}${xianyu?`<div class="ops-product-highlight"><strong>${price?esc(price):'价格见宝贝描述'}</strong><span>想要人数 · 待发布</span></div>`:''}<div class="ops-edit-actions"><button type="button" class="button button-outline" data-edit-kind="image" data-edit-post="${index}" ${locked?'disabled':''}>图片与提示词</button>${current.text?`<button type="button" class="button button-outline" data-edit-kind="copy" data-edit-post="${index}" ${locked?'disabled':''}>修改文案</button>`:''}</div>${post.imageRevisionId&&post.imageRevisionId!=='original'||current.revisionId&&current.revisionId!=='original'?'<p class="ops-revision-label">已采用修改版 · 可在编辑器查看原稿</p>':''}${tabs}<div class="ops-post-content" id="ops-copy-panel-${post.index}"${tabs?` role="tabpanel" aria-labelledby="ops-copy-tab-${post.index}-${versions.indexOf(current)}"`:""}>${current.text?renderPostContent(current.text):`<p class="ops-post-progress">${esc(post.progressMessage||post.error||'正在准备文案…')}</p>`}${post.error&&current.text?`<p class="ops-post-error">${esc(post.error)}</p>`:''}</div><footer class="ops-post-footer">${xianyu?'':interactions}<div class="content-ops-actions">${current.text?`<button type="button" class="button button-outline" data-content-ops-copy="${index}">${xianyu?'复制宝贝描述':'复制文案'}</button><button type="button" class="button button-outline" data-content-ops-download-copy="${index}">保存文案</button>`:''}${post.image?`<a class="button button-outline" href="${esc(post.image)}" download="${esc(this.batch.model)}-${post.index}.png">${xianyu?'保存主图':'保存海报'}</a>`:''}</div></footer></article>`;
    }).join('')}</div>`:`<div class="ops-board-empty"><div class="ops-empty-sheet" aria-hidden="true"><span>封面</span><i></i><i></i></div><h3>${this.busy?'正在创建本批图文':'下一篇内容，从这里开始'}</h3><p>设置左侧参数并生成，或选择历史批次。<br>成稿会按平台样式出现在这里。</p></div>`;
    const html=summary+referenceLinks+(this.openChat&&this.batch?'<div class="content-ops-batch-links"><button type="button" class="text-button" data-content-ops-chat>查看本批对话与任务</button></div>':'')+cards;
    if(html!==this.renderedResult){
      const active=document.activeElement,action=active?.closest('[data-content-ops-copy],[data-content-ops-zoom],[data-copy-version]');
      const isTab=action?.hasAttribute('data-copy-version');
      const attribute=action?.hasAttribute('data-content-ops-copy')?'data-content-ops-copy':'data-content-ops-zoom';
      const value=action?.getAttribute(attribute);
      this.result.innerHTML=html;this.renderedResult=html;
      if(action)this.result.querySelector(isTab?`[data-copy-post="${action.dataset.copyPost}"][data-copy-version="${action.dataset.copyVersion}"]`:`[${attribute}="${value}"]`)?.focus({preventScroll:true});
    }
  }
}

if(typeof document!=='undefined'&&document.querySelector('#view-generate')&&!window.contentOpsUI)new ContentOpsUI();
