// Offline integration regressions; schema is read from the real server, not copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { cp, copyFile, readFile, readdir, writeFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContentOpsProduction, validateContentOpsInput } from './content-ops-production.mjs';
import { parsePostText, renderPostContent } from './content-ops-ui.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const input = {model:'Kimi K3.1 Pro',platform:'xhs',count:1,backgroundMode:'fresh',requestId:'offline-test-123'};

test('brief and cover style validate type, length, controls; old input stays compatible', () => {
  const defaulted = validateContentOpsInput(input);
  assert.equal(defaulted.brief, '');
  assert.equal(defaulted.styleMode, 'auto');
  assert.equal(defaulted.stylePreset, '');
  assert.equal(defaulted.stylePrompt, '');
  for (const brief of [42, {}, '长'.repeat(1001), 'bad\u0000brief']) assert.throws(() => validateContentOpsInput({...input,brief}), {statusCode:400});
  const brief = '中文\n多行 Agent $(touch never-run)';
  assert.equal(validateContentOpsInput({...input,brief}).brief, brief);
  assert.equal(validateContentOpsInput({...input,brief:'长'.repeat(1000)}).brief.length, 1000);
  const manual = validateContentOpsInput({...input,styleMode:'manual',stylePreset:'code_ide',stylePrompt:' 暗黑极客风、蓝紫霓虹光 '});
  assert.equal(manual.styleMode, 'manual');
  assert.equal(manual.stylePreset, 'code_ide');
  assert.equal(manual.stylePrompt, '暗黑极客风、蓝紫霓虹光');
  const autoIgnored = validateContentOpsInput({...input,styleMode:'auto',stylePreset:'code_ide',stylePrompt:'将被忽略'});
  assert.equal(autoIgnored.stylePreset, '');
  assert.equal(autoIgnored.stylePrompt, '');
  for (const bad of [
    {styleMode:'unknown'},
    {styleMode:'manual',stylePreset:'',stylePrompt:'   '},
    {styleMode:'manual',stylePreset:'invalid_preset'},
    {styleMode:'manual',stylePrompt:'长'.repeat(501)},
    {styleMode:'manual',stylePrompt:'bad\u0000style'}
  ]) assert.throws(() => validateContentOpsInput({...input,...bad}), {statusCode:400});
});

test('existing DB migrates, brief and manual style persist, single argv is safe, idempotency includes style, history escapes client-side', async () => {
  const dir = await mkdtemp(join(root,'scratch/t37-node-')), db = new DatabaseSync(':memory:');
  try {
    const server = await readFile(join(root,'hanabi/server.mjs'),'utf8');
    db.exec(server.match(/db\.exec\(`([\s\S]*?)`\);/)[1]);
    assert.equal(db.prepare('PRAGMA table_info(content_ops_batches)').all().some(c=>c.name==='brief'),false);
    await mkdir(join(dir,'scripts'),{recursive:true});await mkdir(join(dir,'scratch'),{recursive:true});
    await writeFile(join(dir,'scripts/generate.py'),'# offline marker, never executed');
    await mkdir(join(dir,'scratch/.venv/bin'),{recursive:true});await writeFile(join(dir,'scratch/.venv/bin/python'),'offline marker');
    await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_API_KEY=offline-placeholder\nCONTENT_OPS_BASE_URL=https://offline.invalid/v1\n');
    const captured=[];
    const spawnProcess=(command,args,options)=>{
      captured.push({command,args,options});const child=new EventEmitter();
      child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};return child;
    };
    const production=new ContentOpsProduction({db,root:dir,uploadDir:join(dir,'uploads'),spawnProcess});
    const brief='编程升级\n100 万上下文；便宜量大 <img src=x onerror=alert(1)> $(touch never-run)';
    const stylePayload={styleMode:'manual',stylePreset:'code_ide',stylePrompt:'暗黑极客风、蓝紫霓虹光'};
    const {batch}=await production.create({...input,brief,...stylePayload});
    assert.equal(batch.brief,brief);assert.equal(batch.styleMode,'manual');assert.equal(batch.stylePreset,'code_ide');assert.equal(batch.stylePrompt,'暗黑极客风、蓝紫霓虹光');
    assert.equal(captured.length,1);assert.equal(captured[0].command,join(dir,'scratch/.venv/bin/python'));
    assert.equal(captured[0].args[captured[0].args.indexOf('--brief')+1],brief);
    assert.equal(captured[0].args[captured[0].args.indexOf('--style-mode')+1],'manual');
    assert.equal(captured[0].args[captured[0].args.indexOf('--style-preset')+1],'code_ide');
    assert.equal(captured[0].args[captured[0].args.indexOf('--style-prompt')+1],'暗黑极客风、蓝紫霓虹光');
    assert.equal(captured[0].options.shell,false);assert.equal(captured[0].args.includes('--references'),false);
    assert.equal((await production.create({...input,brief,...stylePayload})).reused,true);assert.equal(captured.length,1);
    await assert.rejects(()=>production.create({...input,brief:brief+'变更',...stylePayload}),{statusCode:409});
    await assert.rejects(()=>production.create({...input,brief,...stylePayload,stylePreset:'promo'}),{statusCode:409});
    const restored=new ContentOpsProduction({db,root:dir,uploadDir:join(dir,'uploads'),spawnProcess});
    assert.equal(restored.list()[0].brief,brief);assert.equal(restored.list()[0].stylePreset,'code_ide');
    await restored.recover();assert.equal(restored.get(batch.id).status,'failed');assert.equal(captured.length,1);
    const old=await restored.create({...input,requestId:'offline-old-123'});assert.equal(old.batch.brief,'');assert.equal(old.batch.styleMode,'auto');
    const ui=await readFile(join(root,'hanabi/lib/content-ops-ui.mjs'),'utf8');
    assert.match(ui,/esc\(this\.batch\.brief\)/);
  } finally {db.close();await rm(dir,{recursive:true,force:true});}
});

// Configuration tests use fake keys, isolated files and mocked upstream responses.
import { ContentOpsConnections, loadGatewaySettings } from './content-ops-connections.mjs';
import { ContentOpsEditor, editorCommand } from './content-ops-editor.mjs';
import { execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
const connectionInput = { baseUrl:'https://offline.invalid/v1/', apiKey:'', textModel:'text-test', visionModel:'vision-test', imageModel:'image-test', analysisModel:'analysis-test' };
async function connectionFixture(t, fetchRequest) {
  const dir = await mkdtemp(join(root,'scratch/t38-config-'));
  await mkdir(join(dir,'scratch'));
  const path=join(dir,'scratch/gateway.env');
  await writeFile(path,'# keep comment\nCONTENT_OPS_API_KEY=old-test-key\nCONTENT_OPS_BASE_URL=https://old.invalid/v1\nOTHER=keep\nCONTENT_OPS_API_KEY=last-test-key\n');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return {dir,path,service:new ContentOpsConnections({root:dir,environment:{},fetchRequest})};
}
const modelsOK = () => Promise.resolve(Response.json({data:[{id:'text-test'}]}));

test('connections masks keys, atomically saves, preserves unrelated env, reads manual edits, and reports tests', async t=>{
  const {service,path,dir}=await connectionFixture(t,modelsOK);
  const before=await service.get();assert.equal(before.connection.state,'untested');assert.equal(before.apiKey,'••••••••');
  assert.equal(before.textModel,'gemini-3.8-flash');
  assert.equal(before.visionModel,'gpt-6.1-terra');
  assert.equal(before.imageModel,'gpt-image-2.6-sunburst');
  assert.equal(before.analysisModel,'deepseek-v4.1-flash-1017');
  const saved=await service.save(connectionInput);
  assert.equal(saved.ok,true);assert.equal(saved.connection.state,'ok');assert.equal((await service.get()).connection.state,'ok');
  assert.equal(JSON.stringify(saved).includes('last-test-key'),false);
  const raw=await readFile(path,'utf8');assert.match(raw,/# keep comment/);assert.match(raw,/OTHER=keep/);
  assert.match(raw,/CONTENT_OPS_VISION_MODEL=vision-test/);
  assert.match(raw,/CONTENT_OPS_ANALYSIS_MODEL=analysis-test/);
  assert.equal(raw.match(/CONTENT_OPS_API_KEY=/g).length,1);assert.match(raw,/CONTENT_OPS_API_KEY=last-test-key/);
  assert.equal((await stat(path)).mode&0o777,0o600);
  assert.equal((await loadGatewaySettings(dir,{CONTENT_OPS_BASE_URL:'https://inherited.invalid',OTHER:'override'})).CONTENT_OPS_BASE_URL,'https://offline.invalid/v1');
  assert.equal((await loadGatewaySettings(dir,{OTHER:'override'})).OTHER,'override');
  await service.save({...connectionInput,apiKey:'new-test-key'});
  assert.match(await readFile(path,'utf8'),/CONTENT_OPS_API_KEY=new-test-key/);
  await writeFile(path,(await readFile(path,'utf8')).replace('text-test','edited-model'));
  assert.equal((await service.get()).textModel,'edited-model');assert.equal((await service.get()).connection.state,'untested');
});

test('connections rejects malformed/injected config before file mutation or upstream calls',async t=>{
  let calls=0;const {service,path}=await connectionFixture(t,()=>{calls++;return modelsOK();});
  const before=await readFile(path,'utf8');
  for(const extra of [{baseUrl:'http://unsafe.invalid'}, {baseUrl:'https://user:secret@offline.invalid'},
    {baseUrl:'https://offline.invalid?key=hidden'}, {apiKey:'bad\nEXTRA=evil'}, {textModel:'bad\nOTHER=evil'},
    {imageModel:42}, {extra:'unknown'}, {apiKey:'"bad"'}]){
    await assert.rejects(()=>service.save({...connectionInput,...extra}),{statusCode:400});
    assert.equal(await readFile(path,'utf8'),before);
  }
  assert.equal(calls,0);
});

test('spec analysis uses the configured analysis model and carries source, prior draft, and user feedback across rounds', async t => {
  const dir=await mkdtemp(join(root,'scratch/spec-analysis-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  execFileSync('git',['clone','--quiet','--shared',root,dir]);
  await mkdir(join(dir,'scratch'),{recursive:true});
  await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_BASE_URL=https://analysis.invalid/v1\nCONTENT_OPS_API_KEY=fake-key-only\nCONTENT_OPS_ANALYSIS_MODEL=analysis-test\n');
  const spec=await readFile(join(dir,'rules/content-spec.md'),'utf8');
  const calls=[];
  const editor=new ContentOpsEditor({root:dir,fetchRequest:async(url,init)=>{
    calls.push({url,init});
    const request=JSON.parse(init.body), prompt=request.messages[0].content;
    return Response.json({choices:[{message:{content:JSON.stringify({summary:`round-${calls.length}`,updatedContent:spec})}}]});
  }});
  const first=await editor.analyzeSpecSync({trigger:'persona_add',addedItem:{id:'Q999',text:'示例新增偏好'}});
  assert.equal(first.summary,'round-1');assert.equal(first.before,spec);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://analysis.invalid/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].init.body).model,'analysis-test');
  assert.match(JSON.parse(calls[0].init.body).messages[0].content,/示例新增偏好/u);
  const second=await editor.analyzeSpecSync({trigger:'manual',previousDraft:first.updatedContent,feedback:'保留原有章节，语气更简洁'});
  assert.equal(second.summary,'round-2');assert.equal(calls.length,2);
  const secondPrompt=JSON.parse(calls[1].init.body).messages[0].content;
  assert.match(secondPrompt,/上一版草案/u);assert.match(secondPrompt,/保留原有章节，语气更简洁/u);
  assert.match(secondPrompt,/风险词原料/u);assert.match(secondPrompt,/当前内容生产规范/u);
});

test('spec sync apply rebuilds the bundle and commits only the canonical spec and derived bundle', async t => {
  const dir=await mkdtemp(join(root,'scratch/spec-apply-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  execFileSync('git',['clone','--quiet','--shared',root,dir]);
  execFileSync('git',['-C',dir,'config','user.name','Hanabi Test']);
  execFileSync('git',['-C',dir,'config','user.email','hanabi-test@localhost']);
  execFileSync('git',['-C',dir,'config','core.hooksPath','/dev/null']);
  await copyFile(join(root,'rules/content-spec.md'),join(dir,'rules/content-spec.md'));
  await copyFile(join(root,'scripts/lib/preferences.py'),join(dir,'scripts/lib/preferences.py'));
  await copyFile(join(root,'config/preference-build.json'),join(dir,'config/preference-build.json'));
  await copyFile(join(root,'data/distilled-preferences.json'),join(dir,'data/distilled-preferences.json'));
  await writeFile(join(dir,'rules/content-spec.md'),`${await readFile(join(dir,'rules/content-spec.md'),'utf8')}\n`);
  execFileSync('git',['-C',dir,'add','rules/content-spec.md','scripts/lib/preferences.py','config/preference-build.json','data/distilled-preferences.json']);
  execFileSync('git',['-C',dir,'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--quiet','-m','测试夹具同步规范构建源']);
  const original=await readFile(join(dir,'rules/content-spec.md'),'utf8');
  const updated=original.replace('先确认任务事实、目标平台和账号身份，再开始写稿。', '先确认任务事实、目标平台和账号身份，再开始写稿。同步写入测试标记。');
  const editor=new ContentOpsEditor({root:dir,run:(command,args,options)=>editorCommand(command,args,{
    ...options,env:{...process.env,PYTHONPATH:join(root,'scratch/.venv/lib/python3.11/site-packages')}
  })});
  const result=await editor.applySpecSync({updatedContent:updated,revision:createHash('sha256').update(original).digest('hex'),summary:'测试确认写入'});
  assert.equal(result.ok,true);
  assert.match(result.content,/最近更新时间：/u);
  assert.equal(execFileSync('git',['-C',dir,'status','--porcelain'],{encoding:'utf8'}),'');
  const committed=execFileSync('git',['-C',dir,'show','--pretty=format:','--name-only','HEAD'],{encoding:'utf8'}).trim().split('\n').sort();
  assert.deepEqual(committed,['data/distilled-preferences.json','rules/content-spec.md']);
  const bundle=JSON.parse(await readFile(join(dir,'data/distilled-preferences.json'),'utf8'));
  assert.equal(bundle.sources.includes('content-spec'),true);
});

test('failed probes remain failed on GET and never expose upstream body or credentials',async t=>{
  for(const fetchRequest of [()=>Promise.resolve(Response.json({error:'private upstream diagnostic'},{status:401})),
    ()=>Promise.resolve(new Response('<html>login page</html>')),
    ()=>Promise.reject(new Error('secret upstream detail'))]){
    const {service}=await connectionFixture(t,fetchRequest);
    const saved=await service.save(connectionInput);
    assert.equal(saved.saved,true);assert.equal(saved.ok,false);assert.equal((await service.get()).connection.state,'error');
    assert.doesNotMatch(JSON.stringify(saved),/private upstream|secret upstream|last-test-key/);
  }
});

test('models unsupported falls back to one-token selected text model; auth errors never do',async t=>{
  const calls=[];
  const {service}=await connectionFixture(t,(url,init)=>{calls.push({url,init});return Promise.resolve(calls.length===1?new Response('',{status:404}):Response.json({choices:[{message:{content:'x'}}]}));});
  const saved=await service.save(connectionInput);assert.equal(saved.test.method,'chat');assert.equal(saved.ok,true);
  assert.equal(calls.length,2);assert.equal(JSON.parse(calls[1].init.body).model,'text-test');assert.equal(JSON.parse(calls[1].init.body).max_tokens,1);
  assert.ok(calls.every(call=>call.init.redirect==='error'));
  let count=0;const unauthorized=await connectionFixture(t,()=>{count++;return Promise.resolve(new Response('',{status:401}));});
  await unauthorized.service.save(connectionInput);assert.equal(count,1);
});

test('concurrent saves preserve last successful key when the next key is blank',async t=>{
  const {service,path}=await connectionFixture(t,modelsOK);
  await Promise.all([service.save({...connectionInput,apiKey:'concurrent-test-key'}), service.save({...connectionInput,textModel:'second-model'})]);
  const config=await service.settings();assert.equal(config.CONTENT_OPS_API_KEY,'concurrent-test-key');assert.equal(config.CONTENT_OPS_TEXT_MODEL,'second-model');
  assert.match(await readFile(path,'utf8'),/CONTENT_OPS_TEXT_MODEL=second-model/);
});

import {classifyReference, parseReferenceQuery, ContentOpsReferenceStore} from './content-ops-reference-store.mjs';

test('cover classification distinguishes content topics from layout evidence', () => {
  assert.equal(classifyReference({title:'Kimi 编程工具',body:'代码、IDE 和终端使用教程',cover_ocr:'我去！白菜价\nKimi K3\n便宜量大\n跑深度推理'}).layout_style,'bold_typo');
  for(const [cover_ocr,expected] of [['终端窗口\n$ npm install','code_ide'],['GLM vs Kimi 对比表','comparison'],['3D 悬浮卡片\n输入→输出','card_3d'],['','other']]) {
    assert.equal(classifyReference({cover_ocr}).layout_style,expected);
  }
  assert.equal(classifyReference({title:'GLM5.3'}).model_category,'GLM');
  assert.equal(classifyReference({tags:['Seedance2']}).model_category,'Seedance/视频');
  assert.equal(classifyReference({title:'其他工具'}).model_category,'其他');
});

test('combined filters operate before pagination and preserve selection IDs', async () => {
  const store = new ContentOpsReferenceStore({root});
  const all = [];
  for(let offset=0;;offset+=100){
    const result=await store.list(new URLSearchParams({platform:'xhs',limit:'100',offset:String(offset)}));
    all.push(...result.posts);if(all.length>=result.total)break;
  }
  for(const model of ['GLM','Kimi','Seedance/视频','其他'])for(const layout of ['code_ide','bold_typo','card_3d','comparison','other']){
    const expected=all.filter(post=>post.model_category===model&&post.layout_style===layout);
    const q=new URLSearchParams({platform:'xhs',model_category:model,layout_style:layout,limit:'2',offset:'1'});
    const result=await store.list(q);
    assert.equal(result.total,expected.length);
    assert.deepEqual(result.posts.map(p=>p.id),expected.slice(1,3).map(p=>p.id));
  }
  const target=all.find(p=>p.model_category==='Kimi'&&p.layout_style==='bold_typo');assert.ok(target);
  const selected=await store.list(new URLSearchParams({platform:'xhs',ids:target.id}));assert.equal(selected.posts[0].id,target.id);
  for(const q of ['layout_style=unknown','model_category=unknown','model_category=GLM&model_category=Kimi','layout_style=../'])assert.throws(()=>parseReferenceQuery(new URLSearchParams(q)),{statusCode:400});
});


// Exercise the real HTTP boundary: source parity, no cache, and a closed whitelist.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('documents HTTP serves canonical Markdown and rejects arbitrary file names', {timeout:15000}, async () => {
  const dir=await mkdtemp(join(root,'scratch/documents-http-'));
  const child=spawn(process.execPath,[join(root,'hanabi/server.mjs')],{env:{...process.env,CONTENT_ALCHEMY_PORT:'0',CONTENT_OPS_DB_PATH:join(dir,'test.sqlite'),CONTENT_ALCHEMY_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let timer;
  try {
    const url=await new Promise((resolve,reject)=>{
      let text='';timer=setTimeout(()=>reject(new Error('Local HTTP server did not start')),8000);
      child.once('error',reject);child.once('exit',code=>reject(new Error(`Local HTTP server exited ${code}`)));
      child.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/u);if(match){clearTimeout(timer);resolve(match[1]);}});
    });
    const sources={'content-spec':'rules/content-spec.md',guide:'docs/GUIDE.md',corpus:'data/model-corpus.md'};
    for(const [name,path] of Object.entries(sources)){
      const response=await fetch(`${url}/api/content-ops/documents?doc=${name}`);
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      const result=await response.json();assert.equal(result.path,path);assert.equal(result.content,await readFile(join(root,path),'utf8'));
    }
    for(const query of ['','doc=../../scratch/gateway.env','doc=toString','doc=__proto__','doc=guide&doc=corpus','doc=guide&extra=1']) {
      const response=await fetch(`${url}/api/content-ops/documents?${query}`);assert.equal(response.status,400,query);
      assert.doesNotMatch(await response.text(),/CONTENT_OPS_API_KEY|Bearer/u);
    }
  } finally {clearTimeout(timer);const exited=once(child,'exit');child.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true});}
});

// All CRUD tests use disposable JSONL/image roots; production posts are read-only.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGO0TZzHwMDAxAAGAA6ZAUBbllYWAAAAAElFTkSuQmCC','base64');
const webp = Buffer.from('UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoCAAIAAUAmJaACdLoAA5gA/u+9V/43j0Q95W3n+N8QXtSYAAA=','base64');
async function referenceFixture(t) {
  const dir=await mkdtemp(join(root,'scratch/references-crud-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const name of ['data','config'])await mkdir(join(dir,name));
  for(const name of ['config/data-cleaning.json','data/distilled-preferences.json'])await cp(join(root,name),join(dir,name));
  return {dir,store:new ContentOpsReferenceStore({root:dir})};
}

test('references CRUD accepts image+text, image-only, text-only and preserves manual labels', async t => {
  const {dir,store}=await referenceFixture(t);
  const post=await store.addReference({title:'GLM 标题',body:'正文',cover_ocr:'OCR',model:'用户型号',image:`data:image/png;base64,${png.toString('base64')}`,model_category:'Kimi',layout_style:'comparison',label:{good:true}});
  assert.match(post.id,/^[0-9a-f]{24}$/u);assert.equal(post.source,'user_added');assert.ok(Date.parse(post.fetched_at));
  assert.deepEqual(post.images,[`data/images/xhs/${post.id}/1.png`]);assert.deepEqual(await readFile(join(dir,post.images[0])),png);
  await assert.rejects(()=>store.addReference({image:png.subarray(0,-12)}),{statusCode:415});
  const pureImage=await store.addReference({platform:'xianyu',image:new Uint8Array(webp)});
  await assert.rejects(()=>store.updateReference(pureImage.id,{image:null}),{statusCode:400});
  assert.equal(pureImage.title,'');assert.match(pureImage.images[0],/xianyu\/[0-9a-f]{24}\/1.webp$/u);
  const pureText=await store.addReference({body:'只有正文'});
  const selected=await store.list(new URLSearchParams({model_category:'Kimi',layout_style:'comparison'}));
  assert.deepEqual(selected.posts.map(item=>item.id),[post.id]);assert.equal(selected.posts[0].classification_method,'manual');
  const noCover=await store.list(new URLSearchParams({ids:pureText.id}));assert.equal(noCover.posts[0].image,null);assert.deepEqual(noCover.posts[0].images,[]);
  await store.updateReference(post.id,{body:'修改正文',cover_ocr:'新 OCR',model:'新型号',label:{good:false},image:{data:webp.toString('base64'),mimeType:'image/webp'}});
  await assert.rejects(()=>readFile(join(dir,post.images[0])),{code:'ENOENT'});
  assert.deepEqual(await readFile(join(dir,`data/images/xhs/${post.id}/1.webp`)),webp);
  let changed=await store.updateReference(post.id,{platform:'xianyu'});
  assert.deepEqual(changed.images,[`data/images/xianyu/${post.id}/1.webp`]);
  await assert.rejects(()=>stat(join(dir,`data/images/xhs/${post.id}`)),{code:'ENOENT'});
  changed=await store.updateReference(post.id,{image:null});assert.deepEqual(changed.images,[]);
  await assert.rejects(()=>stat(join(dir,`data/images/xianyu/${post.id}`)),{code:'ENOENT'});
  const readback=(await store.records()).find(item=>item.id===post.id);assert.equal(readback.body,'修改正文');assert.equal(readback.cover_ocr,'新 OCR');assert.equal(readback.model,'新型号');assert.equal(readback.label.good,false);
  await store.deleteReference(pureImage.id);await assert.rejects(()=>stat(join(dir,`data/images/xianyu/${pureImage.id}`)),{code:'ENOENT'});
  assert.equal((await store.records()).length,2);
});

test('references reject invalid payloads, IDs, formats and oversized images without changing the source', async t => {
  const {dir,store}=await referenceFixture(t),post=await store.addReference({title:'保留'}),source=await readFile(join(dir,'data/posts.jsonl'),'utf8');
  for(const value of [null,[],{}, {cover_ocr:'只有 OCR'},{title:'  ',body:'\n'},{platform:'../',title:'x'},{title:3},{title:'x',model_category:'bad'},{title:'x',layout_style:'bad'},{title:'x',label:{good:1}},{title:'x',id:'ff'},{image:'!!!!'},{image:'data:image/jpeg;base64,'+png.toString('base64')},{image:Buffer.from('GIF89a')},{image:png.subarray(0,24)}])await assert.rejects(()=>store.addReference(value));
  await assert.rejects(()=>store.addReference({image:Buffer.alloc(15*1024*1024+1)}),{statusCode:413});
  await assert.rejects(()=>store.addReference({image:'A'.repeat(20*1024*1024+4)}),{statusCode:413});
  for(const id of ['../data','invalid!', ''])await assert.rejects(()=>store.deleteReference(id),{statusCode:400});
  await assert.rejects(()=>store.updateReference('ff',{title:'x'}),{statusCode:404});
  await assert.rejects(()=>store.deleteReference('ff'),{statusCode:404});
  await assert.rejects(()=>store.updateReference(post.id,{title:'',image:null}),{statusCode:400});
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),source);
  assert.deepEqual((await readdir(join(dir,'data'))).sort(),['distilled-preferences.json','posts.jsonl']);
  await writeFile(join(dir,'data/posts.jsonl'),'broken JSON\n');
  await assert.rejects(()=>store.addReference({title:'不能覆盖损坏的源'}),{statusCode:500});
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),'broken JSON\n');
});

test('references serialize simultaneous adds/edits/deletes across instances without lost records', async t => {
  const {dir,store}=await referenceFixture(t),second=new ContentOpsReferenceStore({root:dir});
  const posts=await Promise.all(Array.from({length:12},(_,index)=>(index%2?store:second).addReference({title:`素材 ${index}`})));
  assert.equal(new Set(posts.map(post=>post.id)).size,12);
  await Promise.all([store.updateReference(posts[0].id,{body:'新正文'}),second.updateReference(posts[0].id,{title:'新标题'}),store.deleteReference(posts[1].id),second.addReference({body:'补充'})]);
  const saved=await store.records();assert.equal(saved.length,12);assert.equal(saved.find(p=>p.id===posts[0].id).body,'新正文');assert.equal(saved.find(p=>p.id===posts[0].id).title,'新标题');
  assert.equal((await readdir(join(dir,'data'))).some(name=>name.includes('.tmp')||name.includes('.lock')),false);
});

test('references roll back image replacement, platform movement and deletion if JSONL commit fails', async t => {
  const {dir,store}=await referenceFixture(t),post=await store.addReference({image:png}),source=await readFile(join(dir,'data/posts.jsonl'),'utf8');
  const write=store.writeRecords;store.writeRecords=async()=>{throw new Error('simulated disk failure');};
  for(const operation of [()=>store.updateReference(post.id,{image:webp}),()=>store.updateReference(post.id,{platform:'xianyu'}),()=>store.updateReference(post.id,{image:null,title:'text'}),()=>store.deleteReference(post.id),()=>store.addReference({image:webp})]){
    await assert.rejects(operation,/simulated disk failure/u);
    assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),source);assert.deepEqual(await readFile(join(dir,post.images[0])),png);
  }
  assert.deepEqual(await readdir(join(dir,'data/images/xhs')),[post.id]);assert.deepEqual(await readdir(join(dir,'data/images/xianyu')),[]);
  store.writeRecords=write;await store.deleteReference(post.id);assert.deepEqual(await store.records(),[]);
});

test('references preserve carousel images and reject directory symlink escapes', async t => {
  const {dir,store}=await referenceFixture(t),post=await store.addReference({image:png});
  await writeFile(join(dir,`data/images/xhs/${post.id}/2.png`),png);
  post.images.push(`data/images/xhs/${post.id}/2.png`);await store.writeRecords([post]);
  const changed=await store.updateReference(post.id,{image:webp});assert.equal(changed.images.length,2);assert.deepEqual(await readFile(join(dir,changed.images[1])),png);
  const outside=join(dir,'outside');await mkdir(outside);await writeFile(join(outside,'keep'),'retained');
  await rm(join(dir,`data/images/xhs/${post.id}`),{recursive:true});await symlink(outside,join(dir,`data/images/xhs/${post.id}`));
  await assert.rejects(()=>store.updateReference(post.id,{image:png}),{statusCode:400});
  await store.deleteReference(post.id);assert.equal(await readFile(join(outside,'keep'),'utf8'),'retained');
});

test('references HTTP roundtrip uses real routes, image headers, errors and isolated canonical files', {timeout:15000}, async t => {
  const {dir}=await referenceFixture(t);
  await mkdir(join(dir,'hanabi'));await cp(join(root,'hanabi/lib'),join(dir,'hanabi/lib'),{recursive:true});await cp(join(root,'hanabi/server.mjs'),join(dir,'hanabi/server.mjs'));
  const child=spawn(process.execPath,[join(dir,'hanabi/server.mjs')],{env:{...process.env,CONTENT_ALCHEMY_PORT:'0',CONTENT_OPS_DB_PATH:join(dir,'test.sqlite'),CONTENT_ALCHEMY_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let timer;
  try {
    const url=await new Promise((resolve,reject)=>{let output='';timer=setTimeout(()=>reject(new Error('HTTP server did not start')),8000);child.once('error',reject);child.once('exit',code=>reject(new Error(`HTTP server exited ${code}`)));child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/u);if(match){clearTimeout(timer);resolve(match[1]);}});});
    const request=(path,payload,method='POST')=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const path='/api/content-ops/references';
    let response=await request(path,{image:png.toString('base64'),title:'HTTP 标题'});assert.equal(response.status,201);const {reference}=await response.json();
    response=await fetch(url+path);assert.equal(response.headers.get('cache-control'),'no-store');let data=await response.json();assert.equal(data.total,1);
    response=await fetch(url+data.posts[0].image);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    response=await request(`${path}/${reference.id}/edit`,{title:'新标题',image:webp.toString('base64')});assert.equal(response.status,200);
    response=await request(`${path}/${reference.id}`,{body:'PUT 正文'},'PUT');assert.equal(response.status,200);
    response=await fetch(url+path);data=await response.json();assert.equal(data.posts[0].title,'新标题');assert.equal(data.posts[0].body_full,'PUT 正文');assert.match(data.posts[0].image,/1.webp$/u);
    response=await fetch(`${url}/api/content-ops/image/xhs/${reference.id}/1.png`);assert.equal(response.status,404);
    response=await fetch(url+path,{method:'POST',headers:{origin:'https://unrelated.invalid','content-type':'application/json'},body:'{"title":"blocked"}'});assert.equal(response.status,403);
    response=await fetch(url+path,{method:'POST',body:'{}'});assert.equal(response.status,415);
    response=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(response.status,400);
    response=await request(path,{});assert.equal(response.status,400);
    response=await request(path,{title:'A'.repeat(21*1024*1024)});assert.equal(response.status,413);
    response=await request(`${path}/%zz/edit`,{title:'x'});assert.equal(response.status,400);
    response=await request(`${path}/${reference.id}/delete`,{});assert.equal(response.status,200);
    response=await request(path,{body:'纯文'});const other=(await response.json()).reference;
    response=await fetch(`${url}${path}/${other.id}`,{method:'DELETE'});assert.equal(response.status,200);
    response=await request(`${path}/${other.id}/edit`,{title:'不存在'});assert.equal(response.status,404);
    response=await fetch(url+path);assert.equal((await response.json()).total,0);
    await assert.rejects(()=>stat(join(dir,`data/images/xhs/${reference.id}`)),{code:'ENOENT'});
  } finally {clearTimeout(timer);const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
});

test('references accept JPEG uploads and exact 15MB Base64 payloads without parser overflow', async t => {
  const {dir,store}=await referenceFixture(t);
  // Minimal JPEG fixture with a SOF and EOI; binary payload is passed directly.
  const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnKKKK+hPLP//Z','base64');
  const post=await store.addReference({image:jpeg});assert.match(post.images[0],/1.jpg$/u);
  assert.equal((await store.image({platform:'xhs',id:post.id,filename:'1.jpg'})).mimeType,'image/jpeg');
  const large=Buffer.alloc(15*1024*1024);png.copy(large);png.subarray(-12).copy(large,large.length-12);
  const max=await store.addReference({image:large.toString('base64')});assert.equal((await stat(join(dir,max.images[0]))).size,large.length);
});

test('references block another live process lock and recover a lock left by an exited process', async t => {
  const {dir,store}=await referenceFixture(t),path=join(dir,'data/.posts.lock');
  await writeFile(path,JSON.stringify({pid:process.pid,token:'other-writer'}));
  await assert.rejects(()=>store.addReference({title:'等待'}),{statusCode:409});
  const child=spawn(process.execPath,['-e',''],{stdio:'ignore'});await once(child,'exit');
  await writeFile(path,JSON.stringify({pid:child.pid,token:'stale-writer'}));
  assert.equal((await store.addReference({title:'恢复'})).title,'恢复');
  await assert.rejects(()=>stat(path),{code:'ENOENT'});
});


test('platform card presentation preserves Markdown paragraphs, tags and legacy plain copy',()=>{
  const source='# 标题 · 型号\r\n\r\n第一段\r\n短行\r\n\r\n第二段 #正文话题\r\n\r\n#标签一 #GLM5.3\r\n#标签二\r\n';
  assert.deepEqual(parsePostText(source),{title:'标题 · 型号',body:'第一段\n短行\n\n第二段 #正文话题',tags:['#标签一','#GLM5.3','#标签二']});
  assert.deepEqual(parsePostText('旧版标题\n\n正文'),{title:'旧版标题',body:'正文',tags:[]});
  assert.deepEqual(parsePostText(),{title:'',body:'',tags:[]});
  const html=renderPostContent(source);
  assert.match(html,/<h3[^>]*>标题 · 型号<\/h3>/);
  assert.match(html,/<p>第一段\n短行<\/p><p>第二段 #正文话题<\/p>/);
  assert.match(html,/<span>#GLM5.3<\/span>/);
});

test('platform card content escapes untrusted title, copy and tags without losing literal text',()=>{
  const html=renderPostContent('# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script> & 原文\n\n#<svg/onload=alert(1)>');
  assert.doesNotMatch(html,/<img|<script|<svg/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; 原文/);
  assert.match(html,/#&lt;svg\/onload=alert\(1\)&gt;/);
});

test('copy format and multiplier validate enums, integers, aliases and defaults',()=>{
  assert.equal(validateContentOpsInput(input).copyFormat,'all_variations');
  assert.equal(validateContentOpsInput(input).copyMultiplier,3);
  for(const copyFormat of ['all_variations','format_1','format_2','format_3'])
    for(const copyMultiplier of [1,3,5]) assert.equal(validateContentOpsInput({...input,copyFormat,copyMultiplier}).copyMultiplier,copyMultiplier);
  assert.equal(validateContentOpsInput({...input,copy_format:'format_2',copy_multiplier:5}).copyFormat,'format_2');
  for(const copyMultiplier of [0,6,1.5,true,'3',{},[]])assert.throws(()=>validateContentOpsInput({...input,copyMultiplier}),{statusCode:400});
  for(const copyFormat of ['', 'bad', 3, {}, []])assert.throws(()=>validateContentOpsInput({...input,copyFormat}),{statusCode:400});
});

async function productionFixture(t){
  const dir=await mkdtemp(join(root,'scratch/copy-options-node-')),db=new DatabaseSync(':memory:');
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  // Remove only the new columns to exercise an actual pre-feature database upgrade.
  const schema=(await readFile(join(root,'hanabi/server.mjs'),'utf8')).match(/db\.exec\(`([\s\S]*?)`\);/)[1];
  db.exec(schema.replace(", copy_format TEXT NOT NULL DEFAULT 'all_variations', copy_multiplier INTEGER NOT NULL DEFAULT 1",'').replace(" copies TEXT NOT NULL DEFAULT '[]',",''));
  db.prepare('INSERT INTO content_ops_batches(id,request_id,model,platform,count,background_mode,status,job_ids,output_dir,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('legacy','legacy-request','旧型号','xhs',1,'fresh','completed','["legacy-job"]',join(dir,'legacy'),'2026-11-01','2026-11-01');
  db.prepare('INSERT INTO analysis_jobs(id,batch_id,position,status,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('legacy-job','legacy',1,'completed','# 旧文案\n\n旧正文','2026-11-01','2026-11-01');
  await mkdir(join(dir,'scripts'));await mkdir(join(dir,'scratch'));
  await writeFile(join(dir,'scripts/generate.py'),'# never run');
  await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_API_KEY=test-placeholder\nCONTENT_OPS_BASE_URL=https://offline.invalid/v1\n');
  const captured=[];
  const spawnProcess=(command,args,options)=>{captured.push({command,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};return child;};
  const production=new ContentOpsProduction({db,root:dir,uploadDir:join(dir,'uploads'),spawnProcess});
  return {dir,db,production,captured,spawnProcess};
}

test('legacy migration retains one copy; new batches persist all versions, safe args and request identity',async t=>{
  const {dir,db,production,captured,spawnProcess}=await productionFixture(t);
  const legacy=production.public(production.get('legacy'));
  assert.equal(legacy.copyMultiplier,1);assert.equal(legacy.copyCount,1);assert.equal(legacy.posts[0].copies[0].text,'# 旧文案\n\n旧正文');
  const {batch}=await production.create(input),row=production.get(batch.id);
  assert.equal(batch.posts.length,1);assert.equal(batch.copyCount,3);assert.equal(batch.copyFormat,'all_variations');
  assert.equal(captured.length,1);assert.equal(captured[0].args[captured[0].args.indexOf('--copy-multiplier')+1],'3');
  assert.equal(captured[0].args[captured[0].args.indexOf('--copy-format')+1],'all_variations');
  assert.equal(captured[0].options.shell,false);
  for(const change of [{copyMultiplier:2},{copyFormat:'format_1'},{platform:'xianyu'}])await assert.rejects(()=>production.create({...input,...change}),{statusCode:409});
  await mkdir(row.output_dir,{recursive:true});
  const copies=[1,2,3].map(index=>({index,copy_format:`format_${index}`,markdown:`post-1-copy-${index}.md`}));
  const texts=copies.map(c=>`# 文案${c.index}\n\n**卖点${c.index}**\n\n#标签${c.index}`);
  for(const [i,version] of copies.entries())await writeFile(join(row.output_dir,version.markdown),texts[i]);
  await writeFile(join(row.output_dir,'post-1.png'),png);
  await writeFile(join(row.output_dir,'manifest.json'),JSON.stringify({posts:[{index:1,status:'completed',image:'post-1.png',copies}]}));
  await production.finish(batch.id,0);
  const restored=new ContentOpsProduction({db,root:dir,uploadDir:join(dir,'uploads'),spawnProcess});
  const saved=restored.public(restored.get(batch.id));
  assert.equal(saved.status,'completed');assert.equal(saved.posts.length,1);assert.equal(saved.posts[0].text,texts[0]);
  assert.deepEqual(saved.posts[0].copies.map(c=>c.text),texts);assert.deepEqual(saved.posts[0].copies.map(c=>c.copyFormat),['format_1','format_2','format_3']);
  assert.ok(saved.posts[0].image);assert.equal((await readdir(join(dir,'uploads'))).length,1);
  assert.equal((await restored.create(input)).reused,true);assert.equal(captured.length,1);
});

test('missing or unsafe copy versions cannot mark a poster group completed; configured defaults reach argv',async t=>{
  const {dir,production,captured}=await productionFixture(t);
  await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_API_KEY=test\nCONTENT_OPS_BASE_URL=https://offline.invalid/v1\nCONTENT_OPS_COPY_FORMAT=format_3\nCONTENT_OPS_COPY_MULTIPLIER=2\n');
  const config=await production.config();assert.equal(config.copyMultiplier,2);assert.equal(config.copyFormat,'format_3');
  const {batch}=await production.create(input),row=production.get(batch.id);
  assert.equal(batch.copyMultiplier,2);assert.equal(batch.copyCount,2);
  assert.equal(captured[0].args[captured[0].args.indexOf('--copy-multiplier')+1],'2');
  assert.equal(captured[0].args[captured[0].args.indexOf('--copy-format')+1],'format_3');
  await mkdir(row.output_dir,{recursive:true});await writeFile(join(row.output_dir,'post-1-copy-1.md'),'# 已保留的首篇');
  const post={index:1,status:'completed',image:'post-1.png',copies:[{index:1,markdown:'post-1-copy-1.md'},{index:2,markdown:'post-1-copy-2.md'}]};
  await writeFile(join(row.output_dir,'manifest.json'),JSON.stringify({posts:[post]}));
  await production.finish(batch.id,0);let saved=production.public(production.get(batch.id));
  assert.equal(saved.status,'failed');assert.equal(saved.posts[0].copies.length,1);assert.match(saved.posts[0].error,/缺失/);
  post.copies[1].markdown='../secret.md';await writeFile(join(row.output_dir,'manifest.json'),JSON.stringify({posts:[post]}));
  await production.finish(batch.id,0);saved=production.public(production.get(batch.id));
  assert.match(saved.posts[0].error,/路径或序号/);assert.equal(saved.posts[0].image,null);
  await assert.rejects(()=>production.create({...input,requestId:'invalid-count-123',copyMultiplier:6}),{statusCode:400});assert.equal(captured.length,1);
});

test('selected copy switches body and tags, falls back for legacy posts, renders safe bold',async()=>{
  const {copiesForPost,selectedCopy}=await import('./content-ops-ui.mjs');
  const post={text:'# 兼容首篇',copies:[{text:'# A\n\n**卖点A**\n\n#标签A'},{text:'# B\n\n**卖点B**\n\n#标签B'}]};
  assert.equal(selectedCopy(post,1).text,post.copies[1].text);
  assert.deepEqual(parsePostText(selectedCopy(post,1).text),{title:'B',body:'**卖点B**',tags:['#标签B']});
  assert.equal(selectedCopy(post,9).text,post.copies[0].text);
  assert.equal(copiesForPost({text:'旧文案'})[0].text,'旧文案');assert.equal(selectedCopy({}).text,'');
  assert.match(renderPostContent(post.copies[1].text),/<strong>卖点B<\/strong>/);
  assert.match(renderPostContent('# 标题\n\n**长卖点\n自动换行**'),/<strong>长卖点\n自动换行<\/strong>/);
  assert.doesNotMatch(renderPostContent('# 标题\n\n**<img src=x onerror=alert(1)>**'),/<img/);
});
