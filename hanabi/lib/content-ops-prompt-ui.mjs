const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,body)=>{const response=await fetch(path,{cache:'no-store',method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'读取提示词失败');return data;};
export const promptBlock=(title,text,note='')=>`<section class="ops-prompt-block"><header><h3>${esc(title)}</h3><button type="button" class="button button-outline" data-prompt-copy>复制</button></header>${note?`<p>${esc(note)}</p>`:''}<pre>${esc(text)}</pre></section>`;
export function generationBlocks(data){
  const sections=data.requests.map((request,i)=>promptBlock(`实际生图提示词 · 第 ${i+1} 次`,request.prompt,
    [request.model,request.size,({prepared:'已准备，未确认完成',completed:'请求完成',failed:'请求失败'})[request.status]||request.status,request.mode==='layered_poster'?'仅生成无字背景，文字单独排版':'生成完整海报'].filter(Boolean).join(' · ')));
  if(!sections.length)sections.push('<p>未保存实际生图请求；可在上方填写新提示词。</p>');
  if(data.visionPrompt)sections.push(promptBlock('视觉模型方案',data.visionPrompt,data.visionModel));
  if(data.visionRaw)sections.push(`<details><summary>视觉模型原始返回</summary>${promptBlock('原始响应',data.visionRaw)}</details>`);
  if(data.coverTexts?.length)sections.push(promptBlock('原始封面准确文字',data.coverTexts.map(t=>t.text).join('\n')));
  return sections.join('');
}

export class ContentOpsPromptUI {
  constructor(){
    this.token=0;this.dialog=document.createElement('dialog');this.dialog.className='ops-prompt-dialog';this.dialog.setAttribute('aria-label','图片提示词');
    this.dialog.innerHTML='<header class="ops-prompt-header"><div><h2></h2><p data-prompt-note></p></div><button type="button" class="button button-outline" data-prompt-close>关闭</button></header><div class="ops-prompt-layout"><div class="ops-prompt-image"><img alt="当前查看的图片"></div><div class="ops-prompt-content"><p role="status"></p><button type="button" class="button button-primary" data-prompt-retry hidden>重试反推</button><div data-prompt-body></div></div></div>';
    document.body.append(this.dialog);
    this.q('[data-prompt-close]').onclick=()=>this.dialog.close();
    this.dialog.addEventListener('close',()=>{this.token++;clearTimeout(this.timer);});
    this.q('[data-prompt-retry]').onclick=()=>void this.start(this.token);
    this.dialog.addEventListener('click',async event=>{const button=event.target.closest('[data-prompt-copy]');if(!button)return;try{await navigator.clipboard.writeText(button.closest('section').querySelector('pre').textContent);button.textContent='已复制';}catch{this.status('复制失败，可选中提示词手动复制。');}});
  }
  q(selector){return this.dialog.querySelector(selector);}
  status(text){this.q('[role=status]').textContent=text;}
  open(title,image,note){
    clearTimeout(this.timer);const token=++this.token;this.starting=false;
    this.q('h2').textContent=title;this.q('[data-prompt-note]').textContent=note;
    this.q('[data-prompt-body]').replaceChildren();this.q('[data-prompt-retry]').hidden=true;
    const preview=this.q('img');preview.hidden=!image;if(image)preview.src=image;else preview.removeAttribute('src');
    this.q('.ops-prompt-image').hidden=!image;this.status('正在读取提示词…');if(!this.dialog.open)this.dialog.showModal();return token;
  }
  async reference(source,title='素材图片'){
    const token=this.open('反推图片提示词',source,`${title} · 根据图片重建，并非原始生成词。`);
    const match=source.match(/^\/api\/content-ops\/image\/(xhs|xianyu)\/([^/]+)\/([^/?#]+)$/u);if(!match){this.status('图片路径无效。');return;}
    this.path=`/api/content-ops/image-prompts/${match[1]}/${match[2]}/${match[3]}`;
    try{
      const data=await api(this.path);if(token!==this.token)return;
      this.imageSha256=data.imageSha256;
      if(data.run)this.showRun(data.run,token);else await this.start(token);
    }catch(error){if(token===this.token)this.status(error.message);}
  }
  async start(token){
    if(this.starting||token!==this.token)return;this.starting=true;this.q('[data-prompt-retry]').hidden=true;this.status('正在用视觉模型反推这张图片…');
    try{const data=await api(this.path,{requestId:crypto.randomUUID(),imageSha256:this.imageSha256});if(token!==this.token)return;this.showRun(data.run,token);}
    catch(error){if(token===this.token){this.status(error.message);this.q('[data-prompt-retry]').hidden=false;}}
    finally{if(token===this.token)this.starting=false;}
  }
  showRun(run,token){
    if(token!==this.token)return;
    if(run.status==='running'){
      this.status(`正在反推 · ${run.model}。可关闭面板，结果会保存在本机。`);
      this.timer=setTimeout(async()=>{try{const data=await api('/api/content-ops/prompt-runs/'+run.id);this.showRun(data.run,token);}catch(error){if(token===this.token){this.status(error.message);this.q('[data-prompt-retry]').hidden=false;}}},1400);return;
    }
    if(run.status==='failed'){this.status(run.error||'反推失败，可手动重试。');this.q('[data-prompt-retry]').hidden=false;return;}
    const result=run.result;this.status(`反推完成 · ${result.model||run.model} · ${result.width||''}×${result.height||''} · 已保存`);
    this.q('[data-prompt-body]').innerHTML=promptBlock('反推提示词',result.prompt)+(result.negativePrompt?promptBlock('排除项',result.negativePrompt):'')+(result.visibleText?.length?promptBlock('识别到的原图文字',result.visibleText.join('\n')):'');
    this.q('[data-prompt-retry]').hidden=true;
  }
}
let instance;
export const promptUI=()=>instance||(instance=new ContentOpsPromptUI());
