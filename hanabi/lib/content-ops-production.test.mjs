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
import { listProductModels, resolveProductModel } from './content-ops-models.mjs';
import { parsePostText, renderPostContent, nextGenerateRequest, generateSubmitLabel } from './content-ops-ui.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const input = {model:'Kimi K3.1 Pro',platform:'xhs',count:1,backgroundMode:'fresh',requestId:'offline-test-123'};

test('product models resolve informal aliases and reject unknown families before generation', () => {
  const models = listProductModels(root);
  assert.deepEqual(models.map(item => item.id).sort(), ['DeepSeek V4.1', 'GLM-5.3', 'Kimi K3.1 Pro']);
  assert.equal(resolveProductModel('kimi k3.1', models, { requireCover: true }), 'Kimi K3.1 Pro');
  assert.equal(resolveProductModel('GLM5.3', models, { requireCover: true }), 'GLM-5.3');
  const aliased = validateContentOpsInput({ ...input, model: 'kimi k3.1' }, { productModels: models });
  assert.equal(aliased.model, 'kimi k3.1');
  assert.equal(aliased.corpusModel, 'Kimi K3.1 Pro');
  assert.throws(() => resolveProductModel('Kimi K3.2 Pro', models, { requireCover: true }), /未匹配语料库/);
  const freeform = validateContentOpsInput({ ...input, model: 'Unknown Model' }, { productModels: models });
  assert.equal(freeform.model, 'Unknown Model');
  assert.equal(freeform.corpusModel, 'Unknown Model');
});

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

test('four collection presets and legacy IDs validate and appear in the UI', async () => {
  const canonical = ['bold_typo','top_middle_bottom','left_right_bottom','surround'];
  const names = ['大字报','上中下','左右下','环绕'];
  const html = await readFile(join(root,'hanabi/index.html'),'utf8');
  for (const preset of [...canonical,...names,'code_ide','card_3d','comparison','promo']) {
    const validated = validateContentOpsInput({...input,styleMode:'manual',stylePreset:preset});
    assert.equal(validated.stylePreset,preset);
  }
  for (let i=0;i<canonical.length;i++) assert.ok(html.includes(`value="${canonical[i]}">${names[i]}`));
});

test('existing DB migrates, brief and manual style persist, single argv is safe, idempotency includes style, history escapes client-side', async () => {
  const dir = await mkdtemp(join(root,'scratch/t37-node-')), db = new DatabaseSync(':memory:');
  try {
    const server = await readFile(join(root,'hanabi/server.mjs'),'utf8');
    db.exec(server.match(/db\.exec\(`([\s\S]*?)`\);/)[1]);
    assert.equal(db.prepare('PRAGMA table_info(content_ops_batches)').all().some(c=>c.name==='brief'),false);
    await mkdir(join(dir,'scripts'),{recursive:true});await mkdir(join(dir,'scratch'),{recursive:true});await mkdir(join(dir,'data'),{recursive:true});
    await writeFile(join(dir,'scripts/generate.py'),'# offline marker, never executed');
    await mkdir(join(dir,'scratch/.venv/bin'),{recursive:true});await writeFile(join(dir,'scratch/.venv/bin/python'),'offline marker');
    await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_API_KEY=offline-placeholder\nCONTENT_OPS_BASE_URL=https://offline.invalid/v1\n');
    await copyFile(join(root,'data/model-corpus.md'),join(dir,'data/model-corpus.md'));
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
    assert.equal(captured[0].args[captured[0].args.indexOf('--model')+1],'Kimi K3.1 Pro');
    assert.equal(captured[0].args[captured[0].args.indexOf('--corpus-model')+1],'Kimi K3.1 Pro');
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
    const aliased=await restored.create({...input,requestId:'alias-display-123',model:'kimi k3.1',brief,...stylePayload});
    assert.equal(aliased.batch.model,'kimi k3.1');assert.equal(aliased.batch.corpusModel,'Kimi K3.1 Pro');
    assert.equal(captured.at(-1).args[captured.at(-1).args.indexOf('--model')+1],'kimi k3.1');
    assert.equal(captured.at(-1).args[captured.at(-1).args.indexOf('--corpus-model')+1],'Kimi K3.1 Pro');
    await restored.recover();
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

test('banned words support add, edit, and delete with bundle rebuild and git commits', async t => {
  const dir=await mkdtemp(join(root,'scratch/banned-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  execFileSync('git',['clone','--quiet','--shared',root,dir]);
  execFileSync('git',['-C',dir,'config','user.name','Hanabi Test']);
  execFileSync('git',['-C',dir,'config','user.email','hanabi-test@localhost']);
  execFileSync('git',['-C',dir,'config','core.hooksPath','/dev/null']);

  await copyFile(join(root,'scripts/lib/preferences.py'),join(dir,'scripts/lib/preferences.py'));
  execFileSync('git',['-C',dir,'add','scripts/lib/preferences.py']);
  execFileSync('git',['-C',dir,'-c','commit.gpgsign=false','commit','--quiet','--allow-empty','-m','测试夹具同步偏好构建逻辑']);

  const editor=new ContentOpsEditor({
    root:dir,
    run:(command,args,options)=>editorCommand(command,args,{
      ...options,
      env:{...process.env,PYTHONPATH:join(root,'scratch/.venv/lib/python3.11/site-packages')}
    })
  });

  const addRes=await editor.mutate('words',{
    action:'add',word:'单元测试词A',level:'warn',platform:['xhs'],replace:'替换A',reason:'测试添加'
  });
  assert.equal(addRes.ok,true);
  assert.ok(addRes.words.words.some(w=>w.word==='单元测试词A'));

  const editRes=await editor.mutate('words',{
    action:'edit',target_word:'单元测试词A',word:'单元测试词B',regex:false,level:'ban',platform:['xhs','xianyu'],replace:'替换B',reason:'测试更新'
  });
  assert.equal(editRes.ok,true);
  const updated=editRes.words.words.find(w=>w.word==='单元测试词B');
  assert.ok(updated);
  assert.equal(updated.level,'ban');
  assert.equal(updated.replace,'替换B');
  assert.ok(!editRes.words.words.some(w=>w.word==='单元测试词A'));

  const delRes=await editor.mutate('words',{
    action:'delete',target_word:'单元测试词B'
  });
  assert.equal(delRes.ok,true);
  assert.ok(!delRes.words.words.some(w=>w.word==='单元测试词B'));

  await assert.rejects(
    async()=>editor.mutate('words',{action:'delete',target_word:'API'}),
    /受审稿证据保护，不可删除/
  );
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

import {ContentOpsReferences} from './content-ops-references.mjs';

test('reference arrows toggle in both view modes and toolbar resets all card overrides', () => {
  const classes = () => {
    const values = new Set();
    return {toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); }, contains(name) { return values.has(name); }};
  };
  const makeCard = id => {
    const card = {dataset:{platform:'xhs',id}, classList:classes()};
    card.button = {setAttribute(name,value) { this[name]=value; }, closest:() => card};
    card.querySelector = () => card.button;
    return card;
  };
  const card = makeCard('aa'), other = makeCard('bb'), pinned = makeCard('aa');
  const grid = items => ({classList:classes(), querySelectorAll:() => items});
  const browser = Object.create(ContentOpsReferences.prototype);
  Object.assign(browser, {grid:grid([card,other]), pinnedGrid:grid([pinned]), viewMode:'expanded',
    expandedOutlineKeys:new Set(), collapsedCardKeys:new Set(), posts:[{platform:'xhs',id:'aa'},{platform:'xhs',id:'bb'}],
    viewModeButton:{setAttribute(name,value) { this[name]=value; }}});
  const clickArrow = () => browser.handleClick({target:{closest:selector => selector === '[data-ref-outline-expand]' ? card.button : null}});
  browser.applyViewMode();
  assert.equal(card.button['aria-expanded'], 'true');
  assert.equal(card.button.title, '收起图文');
  clickArrow();
  assert.equal(card.classList.contains('ref-card--collapsed'), true);
  assert.equal(pinned.classList.contains('ref-card--collapsed'), true);
  assert.equal(other.classList.contains('ref-card--collapsed'), false);
  assert.equal(card.button['aria-expanded'], 'false');
  clickArrow();
  assert.equal(card.classList.contains('ref-card--collapsed'), false);
  clickArrow();
  browser.toggleViewMode();
  assert.equal(browser.collapsedCardKeys.size, 0);
  assert.equal(browser.grid.classList.contains('ref-grid--collapsed'), true);
  assert.equal(other.classList.contains('ref-card--collapsed'), true);
  assert.equal(browser.viewModeButton.textContent, '📖 展开图文');
  clickArrow();
  assert.equal(card.classList.contains('ref-card--collapsed'), false);
  assert.equal(card.classList.contains('ref-card--outline-open'), true);
  assert.equal(pinned.button['aria-expanded'], 'true');
  clickArrow();
  assert.equal(card.classList.contains('ref-card--collapsed'), true);
  clickArrow();
  browser.toggleViewMode();
  assert.equal(browser.expandedOutlineKeys.size, 0);
  assert.equal(card.classList.contains('ref-card--outline-open'), false);
  assert.equal(card.classList.contains('ref-card--collapsed'), false);
  assert.equal(other.classList.contains('ref-card--collapsed'), false);
  assert.equal(browser.viewModeButton['aria-pressed'], 'false');
});

test('reference deletion keeps surviving cards and viewport, updates counts, and leaves failures untouched', async t => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  });
  const cards = [], requests = [], focusCalls = [];
  let y = 80, confirmed = true, fail = false;
  globalThis.window = {innerHeight:100, confirm:() => confirmed, scrollBy:({top}) => { y += top; }};
  globalThis.document = {activeElement:{}};
  for (const id of ['aa','bb','cc']) cards.push({
    dataset:{platform:'xhs',id},
    getBoundingClientRect() { const top = cards.indexOf(this) * 80 - y; return {top,bottom:top+80}; },
    contains:() => false, focus:options => focusCalls.push(options),
    remove() { cards.splice(cards.indexOf(this), 1); }
  });
  cards[1].contains = () => true;
  const survivor = cards[2];
  const browser = Object.create(ContentOpsReferences.prototype);
  Object.assign(browser, {root:{querySelectorAll:() => cards}, pinnedGrid:{}, totalLabel:{}, status:{}, total:3,
    posts:cards.map(card => ({...card.dataset})), pinned:{platform:'xhs',id:'bb'},
    collections:[{reference_ids:['xhs:aa','xhs:bb','xhs:cc']}],
    expandedOutlineKeys:new Set(['xhs:bb']), collapsedCardKeys:new Set(['xhs:bb']),
    selectedReferences:[{platform:'xhs',id:'bb'}],
    saveSelection:() => {}, refreshBadges:() => {}, renderCollectionList:() => {},
    mutationRequest:async path => { requests.push(path); if (fail) throw new Error('offline'); },
    load:() => assert.fail('deletion must not clear or reload the list')});
  const target = browser.posts[1];
  confirmed = false;
  await browser.deletePost(target);
  assert.equal(requests.length, 0);
  assert.equal(cards.length, 3);
  confirmed = true; fail = true;
  await browser.deletePost(target);
  assert.equal(browser.total, 3);
  assert.equal(y, 80);
  assert.equal(cards.length, 3);
  assert.match(browser.status.textContent, /offline/);
  fail = false;
  await browser.deletePost(target);
  assert.equal(requests.at(-1), '/api/content-ops/references/bb/delete');
  assert.equal(cards.length, 2);
  assert.equal(cards[1], survivor);
  assert.equal(y, 0);
  assert.equal(survivor.getBoundingClientRect().top, 80);
  assert.deepEqual(focusCalls, [{preventScroll:true}]);
  assert.equal(browser.pinned, null);
  assert.equal(browser.pinnedGrid.hidden, true);
  assert.equal(browser.totalLabel.textContent, '共 2 条');
  assert.deepEqual(browser.collections[0].reference_ids, ['xhs:aa','xhs:cc']);
  assert.deepEqual(browser.selectedReferences, []);
  assert.equal(browser.expandedOutlineKeys.size, 0);
  assert.equal(browser.collapsedCardKeys.size, 0);
  assert.equal(browser.mutating, false);
  await browser.deletePost(browser.posts[1]);
  await browser.deletePost(browser.posts[0]);
  assert.equal(browser.total, 0);
  assert.equal(cards.length, 0);
  assert.match(browser.status.textContent, /当前筛选下没有素材/);
});

test('collection assignment updates existing cards, preserves viewport and selection, and filters only the affected row', async t => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  });
  const cards = [], requests = [];
  let y = 80, fail = false;
  globalThis.window = {innerHeight:100, scrollBy:({top}) => { y += top; }};
  globalThis.document = {activeElement:{}};
  for (const id of ['aa','bb','cc']) cards.push({
    dataset:{platform:'xhs',id}, badges:{}, menu:{},
    querySelector(selector) { return selector === '.ref-outline-badges' ? this.badges : this.menu; },
    getBoundingClientRect() { const top = cards.indexOf(this) * 80 - y; return {top,bottom:top+80}; },
    contains:() => false, focus() {}, remove() { cards.splice(cards.indexOf(this), 1); }
  });
  const original = [...cards], target = {platform:'xhs', id:'bb'};
  let stored = [{id:'one',name:'合集一',reference_ids:[]}, {id:'two',name:'合集二',reference_ids:[]}];
  const browser = Object.create(ContentOpsReferences.prototype);
  Object.assign(browser, {root:{querySelectorAll:() => cards}, grid:{children:cards}, pinnedGrid:{contains:() => false},
    posts:cards.map(card => ({...card.dataset})), collection:{value:'all'}, collections:structuredClone(stored),
    total:3, totalLabel:{}, status:{}, selectedReferences:[target], selectedKeys:new Set(['xhs:bb']), citedKeys:new Set(),
    expandedOutlineKeys:new Set(['xhs:bb']), collapsedCardKeys:new Set(),
    showSavedStatus:message => { browser.status.textContent = message; },
    collectionRequest:async (path, method, payload) => {
      if (fail) throw new Error('offline');
      requests.push(path);
      stored.find(item => path.endsWith('/' + item.id)).reference_ids = payload.reference_ids;
    },
    loadCollections:async () => { browser.collections = structuredClone(stored); },
    load:() => assert.fail('collection assignment must not clear or reload references')});
  await browser.assignCollection(target, 'one');
  assert.deepEqual(cards, original);
  assert.equal(y, 80);
  assert.match(cards[1].badges.innerHTML, /合集：合集一/);
  assert.match(cards[1].menu.innerHTML, /移出：合集一/);
  assert.equal(browser.total, 3);
  assert.deepEqual(browser.posts[1].collection_ids, ['one']);
  fail = true;
  await browser.assignCollection(target, 'two');
  assert.deepEqual(browser.posts[1].collection_ids, ['one']);
  assert.equal(y, 80);
  assert.match(browser.status.textContent, /offline/);
  fail = false;
  await browser.assignCollection(target, 'two');
  stored[0].reference_ids = ['xhs:aa','xhs:bb','xhs:cc'];
  browser.collection.value = 'one';
  await browser.loadCollections();
  await browser.assignCollection(target, 'one');
  assert.equal(cards[1], original[2]);
  assert.deepEqual(browser.posts.map(post => post.id), ['aa','cc']);
  assert.equal(y, 0);
  assert.equal(browser.totalLabel.textContent, '共 2 条');
  assert.deepEqual(stored[1].reference_ids, ['xhs:bb']);
  assert.deepEqual(browser.selectedReferences, [target]);
  assert.equal(browser.expandedOutlineKeys.has('xhs:bb'), true);
  assert.equal(browser.mutating, false);
  assert.equal(requests.length, 3);
});

test('editing a reference updates only its card, keeps viewport and state, and removes only filter mismatches', async t => {
  const previousWindow=globalThis.window, previousDocument=globalThis.document;
  t.after(() => {
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  });
  let y=80;
  const cards=[];
  globalThis.window={innerHeight:100,scrollBy:({top})=>{y+=top;}};
  globalThis.document={activeElement:{},createElement:tag=>{
    assert.equal(tag,'template');
    return {set innerHTML(value){this.content={firstElementChild:{className:'ref-card',dataset:{cited:'false'},childNodes:[value]}};}};
  }};
  for(const id of ['aa','bb','cc'])cards.push({
    dataset:{platform:'xhs',id},rendered:'original',
    getBoundingClientRect(){const top=cards.indexOf(this)*80-y;return {top,bottom:top+80};},
    contains:()=>false,focus(){},replaceChildren(...nodes){this.rendered=nodes.join('');},
    remove(){cards.splice(cards.indexOf(this),1);}
  });
  const original=[...cards], browser=Object.create(ContentOpsReferences.prototype),requests=[];
  let next={platform:'xhs',id:'bb',title:'改好的标题',body_full:'新的正文',images:['/api/content-ops/image/xhs/bb/new.jpg'],collection_ids:['one'],collection_names:['合集一']};
  Object.assign(browser,{root:{querySelectorAll:()=>cards},pinnedGrid:{contains:()=>false},platform:{value:'all'},collection:{value:'all'},
    posts:cards.map(card=>({...card.dataset})),collections:[{id:'one',reference_ids:['xhs:bb']}],requestVersion:0,total:3,totalLabel:{},status:{},
    selectedKeys:new Set(['xhs:bb']),citedKeys:new Set(),expandedOutlineKeys:new Set(['xhs:bb']),collapsedCardKeys:new Set(['xhs:cc']),
    isCardCollapsed:()=>false,applyViewMode(){},load:()=>assert.fail('editing must never clear or reload the list'),
    fetcher:async url=>{requests.push(new URL(url,'http://localhost'));return {ok:true,json:async()=>({posts:[next]})};}});
  const old=browser.posts[1];
  await browser.refreshAfterMutation('已保存',old,next);
  assert.deepEqual(cards,original);assert.equal(y,80);assert.equal(browser.total,3);
  assert.equal(requests[0].searchParams.get('ids'),'bb');assert.equal(requests[0].searchParams.has('collection_id'),false);
  assert.match(cards[1].rendered,/改好的标题/u);assert.match(cards[1].rendered,/新的正文/u);assert.match(cards[1].rendered,/bb\/new.jpg/u);
  assert.equal(cards[0].rendered,'original');assert.equal(cards[2].rendered,'original');
  assert.equal(browser.posts[1],next);assert.equal(browser.expandedOutlineKeys.has('xhs:bb'),true);assert.equal(browser.collapsedCardKeys.has('xhs:cc'),true);
  assert.equal(browser.selectedKeys.has('xhs:bb'),true);
  // Platform changes under a platform filter remove just that row and retain a nearby anchor.
  browser.platform.value='xhs';next={...next,platform:'xianyu'};
  await browser.refreshAfterMutation('已保存',old,next);
  assert.deepEqual(cards,[original[0],original[2]]);assert.equal(y,0);assert.equal(browser.totalLabel.textContent,'共 2 条');
  assert.deepEqual(browser.collections[0].reference_ids,['xianyu:bb']);assert.equal(browser.expandedOutlineKeys.has('xianyu:bb'),true);
  // A focused reference outside the current filter remains pinned and is updated in place.
  browser.pinned=next;original[1].dataset.platform='xianyu';cards.push(original[1]);browser.pinnedGrid.contains=card=>card===original[1];
  browser.updateEditedPost(next,{...next,title:'置顶编辑'});
  assert.match(original[1].rendered,/置顶编辑/u);assert.equal(browser.pinned.title,'置顶编辑');assert.equal(browser.total,2);
});

test('editor saving preserves modal scroll, reports refresh failures, and ignores stale targeted responses', async t => {
  const previousWindow=globalThis.window;
  t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;});
  const viewport={scrollX:0,scrollY:1800,scrollTo({top}){this.scrollY=top;}};
  globalThis.window=viewport;
  const browser=Object.create(ContentOpsReferences.prototype),old={platform:'xhs',id:'aa'},next={...old,title:'新标题'};
  const elements=Object.fromEntries(['platform','title','body','cover_ocr','model'].map(name=>[name,{value:name==='platform'?'xhs':name==='title'?'新标题':''}]));
  elements.good={checked:false};let updated=0,fail=false;
  Object.assign(browser,{form:{elements,querySelectorAll:()=>[]},editing:old,hasImage:false,editorImages:[],editorStatus:{},status:{},requestVersion:0,
    dialog:{close(){viewport.scrollY=0;}},reconcileSelection(){},mutationRequest:async()=>({reference:next}),
    updateEditedPost(a,b){assert.equal(a,old);assert.equal(b,next);assert.equal(viewport.scrollY,1800);updated++;},
    fetcher:async()=>{if(fail)throw new Error('offline');return {ok:true,json:async()=>({posts:[next]})};},
    load:()=>assert.fail('saving existing references must not call load')});
  await browser.saveEditor();assert.equal(updated,1);assert.equal(viewport.scrollY,1800);assert.equal(browser.mutating,false);
  fail=true;await browser.saveEditor();assert.equal(updated,1);assert.match(browser.status.textContent,/素材已保存，卡片更新失败：offline/u);
  browser.fetcher=async()=>{browser.requestVersion++;return {ok:true,json:async()=>({posts:[next]})};};
  await browser.refreshAfterMutation('不应覆盖',old,next);assert.equal(updated,1);assert.doesNotMatch(browser.status.textContent,/不应覆盖/u);
  browser.mutationRequest=async()=>{throw new Error('save failed');};
  browser.dialog.close=()=>assert.fail('failed saves must leave the editor open');
  await browser.saveEditor();assert.match(browser.editorStatus.textContent,/save failed/u);assert.equal(viewport.scrollY,1800);
});

test('reference order debounces quick moves and preserves the captured collection scope', async () => {
  const browser = Object.create(ContentOpsReferences.prototype), calls = [];
  Object.assign(browser, {platform:{value:'xhs'}, collection:{value:'c1'}, requestVersion:1,
    posts:[{platform:'xhs',id:'aa'},{platform:'xhs',id:'bb'}],
    collections:[{id:'c1',reference_ids:['xhs:aa','xianyu:cc','xhs:bb']}],
    collectionRequest:async (...args) => calls.push(args), showSavedStatus:() => {}});
  browser.scheduleOrderSave();
  browser.posts.reverse();
  browser.scheduleOrderSave();
  browser.platform.value='all'; browser.collection.value='all';
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'/api/content-ops/collections/c1');
  assert.deepEqual(calls[0][2].reference_ids,['xhs:bb','xianyu:cc','xhs:aa']);
  assert.deepEqual(browser.collections[0].reference_ids,calls[0][2].reference_ids);
  assert.equal(browser.savingOrder,false);
  assert.equal(browser.pendingOrder,null);
});

test('reference filters use platform and collections, support full load, and default to newest input', async t => {
  const {store}=await referenceFixture(t);
  const first=await store.addReference({title:'第一条'});
  const second=await store.addReference({title:'第二条'});
  const third=await store.addReference({platform:'xianyu',title:'第三条'});
  const fourth=await store.addReference({title:'第四条'});
  const collection=await store.createCollection({name:'重点素材'});
  await store.updateCollection(collection.id,{reference_ids:[`xhs:${first.id}`,`xhs:${second.id}`,`xianyu:${third.id}`]});

  const all=await store.list(new URLSearchParams({platform:'all',limit:'5000'}));
  assert.deepEqual(all.posts.map(post=>post.id),[fourth.id,third.id,second.id,first.id]);
  assert.equal(all.total,4);assert.equal(all.limit,5000);assert.equal(all.dataset_total,4);
  const allAlias=await store.list(new URLSearchParams({platform:'all',limit:'all'}));
  assert.deepEqual(allAlias.posts.map(post=>post.id),all.posts.map(post=>post.id));assert.equal(allAlias.limit,5000);
  const xhs=await store.list(new URLSearchParams({platform:'xhs',limit:'100'}));
  assert.deepEqual(xhs.posts.map(post=>post.id),[fourth.id,second.id,first.id]);
  const grouped=await store.list(new URLSearchParams({platform:'all',collection_id:collection.id,limit:'2',offset:'1'}));
  assert.equal(grouped.total,3);assert.deepEqual(grouped.posts.map(post=>post.id),[second.id,third.id]);
  const uncategorized=await store.list(new URLSearchParams({platform:'xhs',collection_id:'uncategorized',limit:'100'}));
  assert.deepEqual(uncategorized.posts.map(post=>post.id),[fourth.id]);
  const selected=await store.list(new URLSearchParams({platform:'all',ids:third.id}));
  assert.deepEqual(selected.posts.map(post=>post.id),[third.id]);
  for(const q of ['sort=newest','model_category=GLM','layout_style=code_ide','collection_id=unknown','collection_id=../','limit=5001'])assert.throws(()=>parseReferenceQuery(new URLSearchParams(q)),{statusCode:400});
});

test('collections support CRUD, atomic persistence, relation filtering, and deletion without deleting references', async t => {
  const {dir,store}=await referenceFixture(t);
  const post=await store.addReference({title:'保留素材'});
  const created=await store.createCollection({name:'待整理'});
  assert.match(created.id,/^[0-9a-f]{24}$/u);assert.ok(Date.parse(created.created_at));assert.deepEqual(created.reference_ids,[]);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'data/collections.json'))).collections,[created]);
  const renamed=await store.updateCollection(created.id,{name:'已整理',reference_ids:[`xhs:${post.id}`]});
  assert.equal(renamed.name,'已整理');
  assert.deepEqual((await store.list(new URLSearchParams({collection_id:created.id}))).posts.map(item=>item.id),[post.id]);
  const source=await readFile(join(dir,'data/collections.json'),'utf8');
  const write=store.writeCollections;store.writeCollections=async()=>{throw new Error('simulated collection disk failure');};
  await assert.rejects(()=>store.updateCollection(created.id,{name:'不会写入'}),/simulated collection disk failure/u);
  assert.equal(await readFile(join(dir,'data/collections.json'),'utf8'),source);
  store.writeCollections=write;
  await store.deleteCollection(created.id);
  assert.deepEqual(await store.readCollections(),[]);
  assert.equal((await store.records()).some(item=>item.id===post.id),true);
  assert.deepEqual((await store.list(new URLSearchParams({collection_id:'uncategorized'}))).posts.map(item=>item.id),[post.id]);
  assert.equal((await readdir(join(dir,'data'))).some(name=>name.includes('.tmp')||name.includes('.lock')),false);
});

test('reference platform edits preserve collection membership and roll back on relation write failure', async t => {
  const {dir,store}=await referenceFixture(t);
  const post=await store.addReference({title:'跨平台素材'}), collection=await store.createCollection({name:'保留顺序'});
  await store.updateCollection(collection.id,{reference_ids:[`xhs:${post.id}`]});
  const source=await readFile(join(dir,'data/posts.jsonl'),'utf8');
  const write=store.writeCollections; store.writeCollections=async()=>{throw new Error('relation write failure');};
  await assert.rejects(()=>store.updateReference(post.id,{platform:'xianyu'}),/relation write failure/u);
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),source);
  assert.deepEqual((await store.readCollections())[0].reference_ids,[`xhs:${post.id}`]);
  store.writeCollections=write;
  await store.updateReference(post.id,{platform:'xianyu'});
  assert.deepEqual((await store.readCollections())[0].reference_ids,[`xianyu:${post.id}`]);
  assert.equal((await store.list(new URLSearchParams({platform:'xianyu',collection_id:collection.id}))).posts[0].id,post.id);
});

test('reference reorder validates IDs, preserves platform slots, and writes atomically', async t => {
  const {dir,store}=await referenceFixture(t);
  const first=await store.addReference({title:'第一条'});
  const second=await store.addReference({title:'第二条'});
  const third=await store.addReference({platform:'xianyu',title:'第三条'});
  const fourth=await store.addReference({title:'第四条'});
  const before=await store.list(new URLSearchParams({platform:'all',limit:'5000'}));
  assert.deepEqual(before.posts.map(post=>post.id),[fourth.id,third.id,second.id,first.id]);

  const reordered=await store.reorderReferences({platform:'xhs',ids:[first.id,fourth.id,second.id]});
  assert.deepEqual(reordered,{ok:true,count:3});
  const after=await store.list(new URLSearchParams({platform:'all',limit:'5000'}));
  assert.deepEqual(after.posts.map(post=>post.id),[first.id,third.id,fourth.id,second.id]);

  const source=await readFile(join(dir,'data/posts.jsonl'),'utf8');
  for(const payload of [
    {platform:'xhs',ids:[first.id,first.id]},
    {platform:'xhs',ids:['../data']},
    {platform:'xhs',ids:['does-not-exist']},
    {platform:'xhs',ids:[third.id]},
    {platform:'xhs',ids:[`${first.id};touch`]},
    {platform:'other',ids:[first.id]}
  ]) await assert.rejects(()=>store.reorderReferences(payload));
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),source);

  const write=store.writeRecords;store.writeRecords=async()=>{throw new Error('simulated reorder disk failure');};
  await assert.rejects(()=>store.reorderReferences({platform:'all',ids:[second.id,third.id,fourth.id,first.id]}),/simulated reorder disk failure/u);
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),source);
  store.writeRecords=write;
  assert.equal((await readdir(join(dir,'data'))).some(name=>name.includes('.tmp')),false);
});

test('collection reorder persists the requested order without changing reference records', async t => {
  const {dir,store}=await referenceFixture(t);
  const first=await store.addReference({title:'第一条'});
  const second=await store.addReference({title:'第二条'});
  const third=await store.addReference({title:'第三条'});
  const collection=await store.createCollection({name:'可排序合集'});
  const originalRecords=await readFile(join(dir,'data/posts.jsonl'),'utf8');
  await store.updateCollection(collection.id,{reference_ids:[`xhs:${first.id}`,`xhs:${second.id}`,`xhs:${third.id}`]});
  await store.updateCollection(collection.id,{reference_ids:[`xhs:${third.id}`,`xhs:${first.id}`,`xhs:${second.id}`]});
  assert.deepEqual((await store.list(new URLSearchParams({collection_id:collection.id,limit:'5000'}))).posts.map(post=>post.id),[third.id,first.id,second.id]);
  assert.deepEqual((await store.readCollections()).find(item=>item.id===collection.id).reference_ids,[`xhs:${third.id}`,`xhs:${first.id}`,`xhs:${second.id}`]);
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),originalRecords);
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
  await writeFile(join(dir,'data/posts.jsonl'),'');
  await writeFile(join(dir,'data/collections.json'),JSON.stringify({collections:[]},null,2)+'\n');
  const git=args=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
  git(['init','-q']);git(['config','user.name','Hanabi test']);git(['config','user.email','test@localhost']);
  git(['add','data/posts.jsonl','data/collections.json']);git(['-c','core.hooksPath=/dev/null','commit','-qm','测试素材初始版本']);
  return {dir,store:new ContentOpsReferenceStore({root:dir})};
}

test('reference mutations commit only their data, preserve staged work, and survive current-HEAD restores', async t => {
  const {dir,store}=await referenceFixture(t),git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:'pipe'});
  await writeFile(join(dir,'unfinished.txt'),'staged work');git(['add','unfinished.txt']);
  await writeFile(join(dir,'unfinished.txt'),'new unstaged work');
  git(['config','user.name','']);git(['config','user.email','']);git(['config','commit.gpgsign','true']);
  await writeFile(join(dir,'.git/hooks/pre-commit'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  const expectCommit=(message,paths)=>{
    assert.equal(git(['log','-1','--format=%s']).trim(),message);
    assert.deepEqual(git(['diff-tree','--no-commit-id','--name-only','-r','HEAD']).trim().split('\n').sort(),paths.sort());
    assert.equal(git(['show',':unfinished.txt']),'staged work');
    assert.equal(git(['status','--porcelain','--','unfinished.txt']).slice(0,2),'AM');
  };
  const first=await store.addReference({title:'第一篇',image:png});
  expectCommit(`素材库：录入素材 ${first.id}`,['data/posts.jsonl']);
  const second=await store.addReference({title:'保留纯文'});
  await store.updateReference(first.id,{title:'更新标题'});
  expectCommit(`素材库：更新素材 ${first.id}`,['data/posts.jsonl']);
  await store.reorderReferences({platform:'all',ids:[first.id,second.id]});
  expectCommit('素材库：重排全量素材顺序',['data/posts.jsonl']);
  const collection=await store.createCollection({name:'测试合集'});
  expectCommit(`素材库：更新素材合集 ${collection.id}`,['data/collections.json']);
  await store.updateCollection(collection.id,{name:'已改名',reference_ids:[`xhs:${first.id}`,`xhs:${second.id}`]});
  expectCommit(`素材库：更新素材合集 ${collection.id}`,['data/collections.json']);
  await store.deleteReference(first.id);
  expectCommit(`素材库：删除素材 ${first.id}`,['data/posts.jsonl','data/collections.json']);
  await assert.rejects(()=>stat(join(dir,`data/images/xhs/${first.id}`)),{code:'ENOENT'});
  assert.deepEqual(JSON.parse(git(['show','HEAD:data/posts.jsonl']).trim()).id,second.id);
  for(const args of [['restore','.'],['checkout','.']]){
    git(args);
    assert.deepEqual((await new ContentOpsReferenceStore({root:dir}).records()).map(post=>post.id),[second.id]);
    assert.deepEqual((await store.readCollections())[0].reference_ids,[`xhs:${second.id}`]);
  }
  await store.deleteCollection(collection.id);
  assert.equal(git(['log','-1','--format=%s']).trim(),`素材库：更新素材合集 ${collection.id}`);
  const head=git(['rev-parse','HEAD']);
  await store.reorderReferences({platform:'all',ids:[second.id]});
  assert.equal(git(['rev-parse','HEAD']),head);
});

test('Git commit failure restores reference records, collections, images and the existing index', async t => {
  const {dir,store}=await referenceFixture(t),git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:'pipe'});
  const first=await store.addReference({title:'图片素材',image:png}),second=await store.addReference({body:'纯文'});
  const collection=await store.createCollection({name:'保留合集'});
  await store.updateCollection(collection.id,{reference_ids:[`xhs:${first.id}`,`xhs:${second.id}`]});
  await writeFile(join(dir,'unfinished.txt'),'keep');git(['add','unfinished.txt']);
  const index=await readFile(join(dir,'.git/index')),head=git(['rev-parse','HEAD']);
  const records=await readFile(join(dir,'data/posts.jsonl'),'utf8'),collections=await readFile(join(dir,'data/collections.json'),'utf8');
  for(const operation of [
    ()=>store.addReference({image:webp}),()=>store.updateReference(first.id,{platform:'xianyu',image:webp}),
    ()=>store.deleteReference(first.id),()=>store.reorderReferences({platform:'all',ids:[first.id,second.id]}),
    ()=>store.createCollection({name:'失败'}),()=>store.updateCollection(collection.id,{name:'失败'}),()=>store.deleteCollection(collection.id)
  ]){
    await writeFile(join(dir,'.git/index.lock'),'test busy index');
    try{await assert.rejects(operation,{statusCode:503});}finally{await rm(join(dir,'.git/index.lock'));}
    assert.equal(git(['rev-parse','HEAD']),head);
    assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),records);
    assert.equal(await readFile(join(dir,'data/collections.json'),'utf8'),collections);
    assert.deepEqual(await readFile(join(dir,first.images[0])),png);
    assert.deepEqual(await readFile(join(dir,'.git/index')),index);
  }
  assert.deepEqual(await readdir(join(dir,'data/images/xhs')),[first.id]);
  assert.deepEqual(await readdir(join(dir,'data/images/xianyu')),[]);
  assert.equal((await readdir(join(dir,'data'))).some(name=>name.includes('.tmp')||name.includes('.lock')),false);
});

test('reference mutations refuse an inherited parent Git repository', async t => {
  const {dir}=await referenceFixture(t),nested=join(dir,'nested');await mkdir(nested);
  const store=new ContentOpsReferenceStore({root:nested});
  await assert.rejects(()=>store.addReference({title:'不应写入父仓库'}),{statusCode:503});
  await assert.rejects(()=>stat(join(nested,'data/posts.jsonl')),{code:'ENOENT'});
});

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
  const selected=await store.list(new URLSearchParams({platform:'xhs'}));
  assert.deepEqual(selected.posts.map(item=>item.id),[pureText.id,post.id]);assert.equal(selected.posts[1].classification_method,'manual');
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
  assert.deepEqual((await readdir(join(dir,'data'))).sort(),['collections.json','distilled-preferences.json','posts.jsonl']);
  await writeFile(join(dir,'data/posts.jsonl'),'broken JSON\n');
  await assert.rejects(()=>store.addReference({title:'不能覆盖损坏的源'}),{statusCode:500});
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),'broken JSON\n');
});

test('deleting a reference with missing local images removes canonical records and all collection links across reloads', async t => {
  const {dir,store}=await referenceFixture(t);
  const removed=await store.addReference({title:'已删图片的残留记录',image:png});
  const retained=await store.addReference({title:'保留纯文字素材'});
  const collections=await Promise.all(['合集一','合集二'].map(name=>store.createCollection({name})));
  for(const collection of collections)await store.updateCollection(collection.id,{reference_ids:[`xhs:${removed.id}`,`xhs:${retained.id}`]});
  await rm(join(dir,`data/images/xhs/${removed.id}`),{recursive:true});
  await store.deleteReference(removed.id);
  const reloaded=new ContentOpsReferenceStore({root:dir});
  assert.deepEqual((await reloaded.records()).map(post=>post.id),[retained.id]);
  assert.deepEqual((await readFile(join(dir,'data/posts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line).id),[retained.id]);
  for(const collection of await reloaded.readCollections()){
    assert.deepEqual(collection.reference_ids,[`xhs:${retained.id}`]);
    assert.deepEqual((await reloaded.list(new URLSearchParams({collection_id:collection.id}))).posts.map(post=>post.id),[retained.id]);
  }
  await assert.rejects(()=>reloaded.updateReference(removed.id,{title:'不应复活'}),{statusCode:404});
  await assert.rejects(()=>reloaded.deleteReference(removed.id),{statusCode:404});
  assert.equal((await reloaded.list(new URLSearchParams({platform:'all'}))).total,1);
  assert.equal((await readdir(join(dir,'data'))).some(name=>name.includes('.tmp')||name.includes('.lock')),false);
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
    response=await request(`${path}/${reference.id}/edit`,{retained_images:[`data/images/xhs/${reference.id}/1.webp`],new_images:[png.toString('base64'),webp.toString('base64')],cover_ocr:'首行\n\n末行'});assert.equal(response.status,200);
    let gallery=(await response.json()).reference;assert.equal(gallery.images.length,3);
    const removedImage=gallery.images[0];
    response=await request(`${path}/${reference.id}/edit`,{retained_images:[gallery.images[2]],new_images:[]});assert.equal(response.status,200);
    response=await fetch(url+path);data=await response.json();assert.equal(data.posts[0].images.length,1);assert.equal(data.posts[0].cover_ocr,'首行\n\n末行');
    response=await fetch(`${url}/api/content-ops/image/xhs/${reference.id}/${removedImage.split('/').at(-1)}`);assert.equal(response.status,404);
    response=await request(`${path}/${reference.id}/edit`,{retained_images:[],new_images:[]});assert.equal(response.status,200);
    response=await fetch(url+path);data=await response.json();assert.deepEqual(data.posts[0].images,[]);
    response=await fetch(url+path,{method:'POST',headers:{origin:'https://unrelated.invalid','content-type':'application/json'},body:'{"title":"blocked"}'});assert.equal(response.status,403);
    response=await fetch(url+path,{method:'POST',body:'{}'});assert.equal(response.status,415);
    response=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(response.status,400);
    response=await request(path,{});assert.equal(response.status,400);
    response=await request(path,{title:'A'.repeat(65*1024*1024)});assert.equal(response.status,413);
    response=await request(`${path}/%zz/edit`,{title:'x'});assert.equal(response.status,400);
    response=await request(`${path}/${reference.id}/delete`,{});assert.equal(response.status,200);
    response=await request(path,{body:'纯文'});const other=(await response.json()).reference;
    response=await fetch(`${url}${path}/${other.id}`,{method:'DELETE'});assert.equal(response.status,200);
    response=await request(`${path}/${other.id}/edit`,{title:'不存在'});assert.equal(response.status,404);
    response=await fetch(url+path);assert.equal((await response.json()).total,0);
    await assert.rejects(()=>stat(join(dir,`data/images/xhs/${reference.id}`)),{code:'ENOENT'});
  } finally {clearTimeout(timer);const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
});

test('references reorder HTTP endpoint supports full platform lists and rejects unsafe requests', {timeout:15000}, async t => {
  const {dir}=await referenceFixture(t);
  await mkdir(join(dir,'hanabi'));await cp(join(root,'hanabi/lib'),join(dir,'hanabi/lib'),{recursive:true});await cp(join(root,'hanabi/server.mjs'),join(dir,'hanabi/server.mjs'));
  const child=spawn(process.execPath,[join(dir,'hanabi/server.mjs')],{env:{...process.env,CONTENT_ALCHEMY_PORT:'0',CONTENT_OPS_DB_PATH:join(dir,'test.sqlite'),CONTENT_ALCHEMY_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let timer;
  try {
    const url=await new Promise((resolve,reject)=>{let output='';timer=setTimeout(()=>reject(new Error('HTTP server did not start')),8000);child.once('error',reject);child.once('exit',code=>reject(new Error(`HTTP server exited ${code}`)));child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/u);if(match){clearTimeout(timer);resolve(match[1]);}});});
    const request=(path,payload,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
    const created=[];
    for(const title of ['第一条','第二条','第三条']){
      const response=await request('/api/content-ops/references',{title});
      assert.equal(response.status,201);created.push((await response.json()).reference);
    }
    const reorder=await request('/api/content-ops/references/reorder',{platform:'xhs',ids:[created[0].id,created[2].id,created[1].id]});
    assert.equal(reorder.status,200);assert.deepEqual(await reorder.json(),{ok:true,count:3});
    const list=await fetch(`${url}/api/content-ops/references?platform=xhs&collection_id=all&limit=5000`);
    assert.equal(list.status,200);assert.deepEqual((await list.json()).posts.map(post=>post.id),[created[0].id,created[2].id,created[1].id]);
    const injection=await request('/api/content-ops/references/reorder',{platform:'xhs',ids:['../data']});
    assert.equal(injection.status,400);
    const crossSite=await request('/api/content-ops/references/reorder',{platform:'xhs',ids:[created[0].id]},{Origin:'https://unrelated.invalid'});
    assert.equal(crossSite.status,403);
    const nonJson=await fetch(url+'/api/content-ops/references/reorder',{method:'POST',body:'{}'});
    assert.equal(nonJson.status,403);
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


test('failed batches force a new generate request and rename the submit button', () => {
  const stored={signature:'same',id:'old-request-id'};
  assert.equal(nextGenerateRequest(stored,'same','running',()=>'fresh-id').id,'old-request-id');
  assert.equal(nextGenerateRequest(stored,'same',undefined,()=>'fresh-id').id,'old-request-id');
  assert.equal(nextGenerateRequest(stored,'same','failed',()=>'fresh-id').id,'fresh-id');
  assert.equal(nextGenerateRequest(stored,'same','partial',()=>'fresh-id').id,'fresh-id');
  assert.equal(nextGenerateRequest(stored,'same','completed',()=>'fresh-id').id,'fresh-id');
  assert.equal(nextGenerateRequest(stored,'changed','running',()=>'fresh-id').id,'fresh-id');
  assert.equal(generateSubmitLabel({}),'开始生成');
  assert.equal(generateSubmitLabel({batchStatus:'failed'}),'重新生成');
  assert.equal(generateSubmitLabel({batchStatus:'partial'}),'重新生成');
  assert.equal(generateSubmitLabel({batchStatus:'completed'}),'再生成一批');
  assert.equal(generateSubmitLabel({busy:true,batchStatus:'failed'}),'创建中…');
  assert.equal(generateSubmitLabel({running:true}),'生成中…');
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


test('multi-image edits keep order, remove files, append safely and relocate collections', async t => {
  const {dir,store}=await referenceFixture(t);
  const post=await store.addReference({title:'多图素材',cover_ocr:'第一行\n第二行\n\n第四行',new_images:[png,png,webp]});
  assert.equal(post.images.length,3);
  const [first,removed,last]=post.images;
  // An unreferenced crawler artifact must not survive a gallery rewrite.
  await writeFile(join(dir,`data/images/xhs/${post.id}/logo.png`),png);
  post.image_urls=['https://example.invalid/deleted-crawler.jpg'];await store.writeRecords([post]);
  const collection=await store.createCollection({name:'保留合集'});
  await store.updateCollection(collection.id,{reference_ids:[`xhs:${post.id}`]});
  let updated=await store.updateReference(post.id,{retained_images:[last,first],new_images:[webp],body:'多图正文'});
  assert.deepEqual(updated.images.slice(0,2),[last,first]);
  assert.equal(updated.images.length,3);assert.deepEqual(updated.image_urls,[]);
  await assert.rejects(()=>readFile(join(dir,removed)),{code:'ENOENT'});
  await assert.rejects(()=>readFile(join(dir,`data/images/xhs/${post.id}/logo.png`)),{code:'ENOENT'});
  assert.deepEqual(await readFile(join(dir,updated.images[0])),webp);
  assert.deepEqual(await readFile(join(dir,updated.images[2])),webp);
  assert.equal(updated.cover_ocr,'第一行\n第二行\n\n第四行');
  const listed=await store.list(new URLSearchParams({platform:'xhs',limit:'all'}));
  assert.equal(listed.posts[0].images.length,3);assert.equal(listed.posts[0].cover_ocr,updated.cover_ocr);
  updated=await store.updateReference(post.id,{platform:'xianyu',retained_images:[updated.images[2],last],new_images:[png]});
  assert.equal(updated.images.length,3);assert.ok(updated.images.every(path=>path.startsWith(`data/images/xianyu/${post.id}/`)));
  assert.deepEqual((await store.readCollections()).find(item=>item.id===collection.id).reference_ids,[`xianyu:${post.id}`]);
  assert.deepEqual(await readdir(join(dir,'data/images/xhs')),[]);
  const text=await store.updateReference(post.id,{retained_images:[],new_images:[]});assert.deepEqual(text.images,[]);
  await assert.rejects(()=>readFile(join(dir,updated.images[0])),{code:'ENOENT'});
  assert.deepEqual(await readdir(join(dir,'data/images/xianyu')),[]);
});

test('multi-image validation rejects forged paths, duplicates, incompatible fields and empty content', async t => {
  const {dir,store}=await referenceFixture(t),post=await store.addReference({new_images:[png,webp]});
  const other=await store.addReference({title:'其他素材',image:png}),before=await readFile(join(dir,'data/posts.jsonl'),'utf8');
  for(const payload of [
    {retained_images:'bad'}, {new_images:null}, {retained_images:[post.images[0],post.images[0]]},
    {retained_images:[other.images[0]]}, {retained_images:[`data/images/xhs/${post.id}/../1.png`]},
    {retained_images:['/etc/passwd']}, {new_images:['!!!!']}, {new_images:[png.subarray(0,-12)]},
    {retained_images:[],cover_ocr:'OCR 不是标题正文'}, {new_images:[],image:png},
    {new_images:Array(51).fill(png)}
  ])await assert.rejects(()=>store.updateReference(post.id,payload));
  await assert.rejects(()=>store.addReference({retained_images:[post.images[0]],title:'伪造'}));
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),before);
  assert.deepEqual(await readFile(join(dir,post.images[0])),png);
  assert.deepEqual(await readdir(join(dir,`data/images/xhs/${post.id}`)),post.images.map(path=>path.split('/').at(-1)).sort());
  const same=await store.updateReference(post.id,{retained_images:post.images,new_images:[]});assert.deepEqual(same.images,post.images);
});

test('multi-image transaction restores original records and files on commit or disk failure', async t => {
  const {dir,store}=await referenceFixture(t),post=await store.addReference({title:'原图',new_images:[png,webp]});
  const before=await readFile(join(dir,'data/posts.jsonl'),'utf8'),write=store.writeRecords.bind(store);
  await writeFile(join(dir,'.git/index.lock'),'busy');
  await assert.rejects(()=>store.updateReference(post.id,{retained_images:[post.images[1]],new_images:[png]}),{statusCode:503});
  await rm(join(dir,'.git/index.lock'));
  store.writeRecords=async()=>{throw new Error('simulated gallery disk failure');};
  await assert.rejects(()=>store.updateReference(post.id,{retained_images:[],new_images:[png]}),/gallery disk failure/u);
  store.writeRecords=write;
  assert.equal(await readFile(join(dir,'data/posts.jsonl'),'utf8'),before);
  assert.deepEqual(await readFile(join(dir,post.images[0])),png);assert.deepEqual(await readFile(join(dir,post.images[1])),webp);
  assert.deepEqual(await readdir(join(dir,'data/images/xhs')),[post.id]);
});

test('multi-image retention rejects symlinks and missing files without touching outside files', async t => {
  const {dir,store}=await referenceFixture(t),post=await store.addReference({title:'图片',new_images:[png,webp]});
  const outside=join(dir,'outside.png');await writeFile(outside,png);
  await rm(join(dir,post.images[0]));await symlink(outside,join(dir,post.images[0]));
  await assert.rejects(()=>store.updateReference(post.id,{retained_images:post.images,new_images:[png]}),{statusCode:400});
  assert.deepEqual(await readFile(outside),png);
  await rm(join(dir,post.images[0]));
  await assert.rejects(()=>store.updateReference(post.id,{retained_images:post.images,new_images:[png]}),{statusCode:400});
  const fixed=await store.updateReference(post.id,{retained_images:[post.images[1]],new_images:[]});assert.equal(fixed.images.length,1);
  assert.deepEqual(await readFile(outside),png);
});

test('multi-image editor submits retained and appended queues and guards empty/reading state', async t => {
  const previousWindow=globalThis.window;
  t.after(() => { if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow; });
  globalThis.window={scrollX:0,scrollY:800,scrollTo:options=>assert.equal(options.top,800)};
  const editor=Object.create(ContentOpsReferences.prototype),requests=[];
  const elements=Object.fromEntries(['platform','title','body','cover_ocr','model'].map(name=>[name,{value:name==='platform'?'xhs':name==='cover_ocr'?'一\n二':''}]));
  elements.good={checked:false};
  Object.assign(editor,{form:{elements,querySelectorAll:()=>[]},editorStatus:{textContent:''},editing:{id:'aa',platform:'xhs'},editorImages:[],hasImage:false,
    dialog:{close(){}},reconcileSelection(){},async refreshAfterMutation(){},async mutationRequest(path,payload){requests.push({path,payload});return {reference:{id:'aa',platform:'xhs'}};}});
  await editor.saveEditor();assert.equal(requests.length,0);assert.match(editor.editorStatus.textContent,/请至少保留/u);
  editor.editorImages=[{path:'data/images/xhs/aa/3.jpg',source:'/api/content-ops/image/xhs/aa/3.jpg'},{upload:'new-base64',source:'new-base64'}];editor.hasImage=true;
  await editor.saveEditor();assert.deepEqual(requests[0].payload.retained_images,['data/images/xhs/aa/3.jpg']);assert.deepEqual(requests[0].payload.new_images,['new-base64']);assert.equal(requests[0].payload.cover_ocr,'一\n二');
  editor.readingImage=true;await editor.saveEditor();assert.equal(requests.length,1);
  const source=await readFile(join(root,'hanabi/lib/content-ops-references.mjs'),'utf8'),css=await readFile(join(root,'hanabi/lib/content-ops-references.css'),'utf8');
  assert.match(source,/name="cover_ocr" rows="6"/u);assert.match(source,/name="upload"[^>]+multiple/u);
  assert.match(css,/resize:vertical/u);assert.match(css,/min-height:120px/u);
});

// Revision tests use isolated batches, original artifacts and fake upstreams.
import { ContentOpsRevisions } from './content-ops-revisions.mjs';
async function revisionFixture(t, mode='fake') {
  const dir=await mkdtemp(join(root,'scratch/revision-test-')), db=new DatabaseSync(':memory:');
  const server=await readFile(join(root,'hanabi/server.mjs'),'utf8');db.exec(server.match(/db\.exec\(`([\s\S]*?)`\);/)[1]);
  await mkdir(join(dir,'uploads'));await mkdir(join(dir,'scratch'));await mkdir(join(dir,'original'));
  await writeFile(join(dir,'original/manifest.json'),JSON.stringify({facts:{model:'GLM5.3',verified_claims:[]},posts:[]}));
  await writeFile(join(dir,'original/post-1.md'),'unchanged export');
  const sourceName='11111111-1111-4111-8111-111111111111.png';await writeFile(join(dir,'uploads',sourceName),png);
  const production=new ContentOpsProduction({db,root:dir,uploadDir:join(dir,'uploads')});
  db.prepare("INSERT INTO content_ops_batches(id,request_id,model,platform,count,background_mode,reference_ids,status,job_ids,output_dir,created_at,updated_at,copy_multiplier) VALUES('batch-123','request-123','GLM5.3','xhs',1,'fresh','[]','completed','[\"job-12345\"]',?,'now','now',2)").run(join(dir,'original'));
  db.prepare("INSERT INTO analysis_jobs(id,batch_id,position,status,result,copies,attachments,created_at,updated_at) VALUES('job-12345','batch-123',1,'completed',?,?,?,'now','now')").run('# 原稿A\n\n正文A',JSON.stringify([{index:1,text:'# 原稿A\n\n正文A'},{index:2,text:'# 原稿B\n\n正文B'}]),JSON.stringify([{mimeType:'image/png',url:'/api/uploads/'+sourceName}]));
  const calls=[];
  const spawnProcess=(command,args,options)=>{
    const child=new EventEmitter();child.kill=()=>queueMicrotask(()=>child.emit('close',1));calls.push({command,args,options});
    if(mode==='hold')return child;
    void (async()=>{
      const data=JSON.parse(await readFile(args[args.indexOf('--input')+1],'utf8'));calls.at(-1).input=data;
      const output=args[args.indexOf('--output')+1];
      if(mode==='error')await writeFile(output,JSON.stringify({error:'offline failure'}));
      else if(data.kind==='image'){
        await writeFile(args[args.indexOf('--image-output')+1],png);
        await writeFile(output,JSON.stringify({model:'offline-image'}));
      }else await writeFile(output,JSON.stringify({text:data.text||'# AI改写\n\n改写正文',model:'offline-writer'}));
      child.emit('close',0);
    })().catch(error=>child.emit('error',error));
    return child;
  };
  if(mode==='real'){
    await symlink(join(root,'scripts'),join(dir,'scripts'));
    await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_BASE_URL=https://offline.invalid/v1\nCONTENT_OPS_API_KEY=fake-only\n');
  }
  const revisions=new ContentOpsRevisions({db,production,root:dir,uploadDir:join(dir,'uploads'),...(mode==='real'?{}:{spawnProcess})});
  t.after(async()=>{revisions.shutdown();db.close();await rm(dir,{recursive:true,force:true});});
  return {dir,db,production,revisions,calls,sourceName};
}
async function revisionDone(revisions,id){
  for(let attempt=0;attempt<400;attempt++){
    const result=revisions.public(revisions.get(id));if(result.status!=='running')return result;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('revision did not complete');
}
const revisionInput={kind:'copy',copyIndex:1,action:'manual',baseRevision:'original',text:'# 新标题\n\n新的正文',requestId:'revision-request-123'};

test('revisions preserve original artifacts, isolate copy variants, require adoption and restore across restart',async t=>{
  const {revisions,production,db,dir,calls}=await revisionFixture(t);
  const original=production.original(production.get('batch-123'));
  const row=await revisions.create('batch-123','job-12345',revisionInput);
  const ready=await revisionDone(revisions,row.id);assert.equal(ready.status,'ready');
  assert.equal(production.public(production.get('batch-123')).posts[0].copies[0].text,original.posts[0].copies[0].text);
  const adopted=revisions.apply('batch-123','job-12345',{kind:'copy',copyIndex:1,baseRevision:'original',revisionId:ready.id}).batch;
  assert.equal(adopted.posts[0].text,revisionInput.text);assert.equal(adopted.posts[0].copies[1].text,'# 原稿B\n\n正文B');
  assert.equal(adopted.posts[0].image,original.posts[0].image);
  assert.deepEqual(production.original(production.get('batch-123')),original);
  assert.equal(await readFile(join(dir,'original/post-1.md'),'utf8'),'unchanged export');
  assert.equal(calls[0].options.shell,false);
  const restored=new ContentOpsRevisions({db,production,root:dir,uploadDir:join(dir,'uploads')});
  assert.equal(restored.history('batch-123','job-12345','copy',1).current.text,revisionInput.text);
  const reverted=restored.apply('batch-123','job-12345',{kind:'copy',copyIndex:1,baseRevision:ready.id,revisionId:'original'}).batch;
  assert.equal(reverted.posts[0].copies[0].text,original.posts[0].copies[0].text);
  assert.equal(restored.history('batch-123','job-12345','copy',1).versions.length,1);
});

test('revision request retries are idempotent, stale edits and cross-target adoption are rejected',async t=>{
  const {revisions,calls}=await revisionFixture(t);
  const first=await revisions.create('batch-123','job-12345',revisionInput);
  assert.equal((await revisions.create('batch-123','job-12345',revisionInput)).id,first.id);
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{...revisionInput,text:'changed'}),{statusCode:409});
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{...revisionInput,requestId:'second-request-123'}),{statusCode:409});
  await revisionDone(revisions,first.id);assert.equal(calls.length,1);
  revisions.apply('batch-123','job-12345',{kind:'copy',copyIndex:1,baseRevision:'original',revisionId:first.id});
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{...revisionInput,requestId:'stale-request-123'}),{statusCode:409});
  assert.throws(()=>revisions.apply('batch-123','job-12345',{kind:'copy',copyIndex:2,baseRevision:'original',revisionId:first.id}),{statusCode:400});
  assert.equal(revisions.head('job-12345','copy',2),'original');
});

test('image revision uses current upload as input, never alters original and adoption updates download URLs',async t=>{
  const {revisions,production,dir,sourceName,calls}=await revisionFixture(t);
  const before=await readFile(join(dir,'uploads',sourceName));
  const first=await revisions.create('batch-123','job-12345',{kind:'image',copyIndex:0,action:'ai',baseRevision:'original',instructions:'只修改背景颜色',region:{x:.1,y:.1,width:.3,height:.3},requestId:'image-request-123'});
  const ready=await revisionDone(revisions,first.id);assert.equal(ready.status,'ready');
  assert.notEqual(ready.result.image,'/api/uploads/'+sourceName);
  const adopted=revisions.apply('batch-123','job-12345',{kind:'image',copyIndex:0,baseRevision:'original',revisionId:ready.id}).batch;
  assert.equal(adopted.posts[0].image,ready.result.image);
  assert.equal(adopted.posts[0].copies[0].text,'# 原稿A\n\n正文A');
  assert.deepEqual(await readFile(join(dir,'uploads',sourceName)),before);
  assert.equal(calls[0].args[calls[0].args.indexOf('--image-output')+1],join(dir,'uploads',first.id+'.png'));
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{kind:'image',copyIndex:0,action:'ai',baseRevision:first.id,region:{x:.8,y:.1,width:.5,height:.1},instructions:'修改',requestId:'invalid-region-123'}),{statusCode:400});
});

test('failed, cancelled and interrupted revisions retain current content and do not auto-retry',async t=>{
  const {revisions,production}=await revisionFixture(t,'error');
  const first=await revisions.create('batch-123','job-12345',revisionInput);
  const result=await revisionDone(revisions,first.id);assert.equal(result.status,'failed');assert.equal(result.error,'offline failure');
  assert.equal(production.public(production.get('batch-123')).posts[0].text,'# 原稿A\n\n正文A');
  const held=await revisionFixture(t,'hold');
  const pending=await held.revisions.create('batch-123','job-12345',revisionInput);
  assert.equal(held.revisions.cancel(pending.id).status,'cancelled');
  for(let i=0;i<100&&held.revisions.children.size;i++)await new Promise(resolve=>setTimeout(resolve,5));
  const another=await held.revisions.create('batch-123','job-12345',{...revisionInput,requestId:'other-request-123'});
  held.revisions.recover();assert.equal(held.revisions.get(another.id).status,'failed');
  for(let i=0;i<100&&held.revisions.children.size;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(held.revisions.head('job-12345','copy',1),'original');
});

test('manual copy and uploaded image revisions complete through the real file CLI without upstream access',async t=>{
  const {revisions,dir}=await revisionFixture(t,'real');
  const manual=await revisions.create('batch-123','job-12345',revisionInput);
  const ready=await revisionDone(revisions,manual.id);assert.equal(ready.status,'ready',ready.error);assert.equal(ready.result.text,revisionInput.text);
  const upload=await revisions.create('batch-123','job-12345',{kind:'image',copyIndex:0,action:'upload',baseRevision:'original',imageData:'data:image/png;base64,'+png.toString('base64'),requestId:'upload-request-123'});
  const image=await revisionDone(revisions,upload.id);assert.equal(image.status,'ready',image.error);
  assert.equal(image.result.model,'manual-upload');assert.deepEqual(await readFile(join(dir,'uploads',upload.id+'.png')),png);
});

test('revision HTTP routes enforce local mutations and preserve adopted copy on refresh', {timeout:15000}, async t=>{
  const {dir,db}=await revisionFixture(t,'real');
  db.exec(`VACUUM INTO '${join(dir,'http.sqlite').replace(/'/gu,"''")}'`);
  await mkdir(join(dir,'hanabi'));await copyFile(join(root,'hanabi/server.mjs'),join(dir,'hanabi/server.mjs'));await symlink(join(root,'hanabi/lib'),join(dir,'hanabi/lib'));
  const child=spawn(process.execPath,[join(dir,'hanabi/server.mjs')],{env:{...process.env,CONTENT_ALCHEMY_PORT:'0',CONTENT_OPS_DB_PATH:join(dir,'http.sqlite'),CONTENT_ALCHEMY_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolvePromise,reject)=>{let log='';const timeout=setTimeout(()=>reject(new Error('revision HTTP did not start')),5000);child.once('error',reject);child.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/u);if(match){clearTimeout(timeout);resolvePromise(match[1]);}});});
  t.after(async()=>{const done=once(child,'exit');child.kill('SIGTERM');await done;});
  const path='/api/content-ops/batches/batch-123/posts/job-12345/revisions';
  const send=(path,input,extra={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(input)});
  let response=await send(path,revisionInput,{Origin:'https://unrelated.invalid'});assert.equal(response.status,403);
  response=await send(path.replace('/revisions','/preview'),{}, {Origin:'https://unrelated.invalid'});assert.equal(response.status,403);
  response=await send(path.replace('/revisions','/preview'),null);assert.equal(response.status,400);
  response=await send(path,{...revisionInput,copyIndex:9});assert.equal(response.status,400);
  response=await send(path,revisionInput);assert.equal(response.status,200);const first=(await response.json()).revision;
  let ready;
  for(let i=0;i<200;i++){ready=(await (await fetch(url+'/api/content-ops/revisions/'+first.id)).json()).revision;if(ready.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(ready.status,'ready',ready.error);
  response=await send(path.replace('/revisions','/apply'),{kind:'copy',copyIndex:1,baseRevision:'original',revisionId:first.id});assert.equal(response.status,200);
  assert.equal((await response.json()).batch.posts[0].copies[0].text,revisionInput.text);
  const saved=await (await fetch(url+'/api/content-ops/batches/batch-123')).json();assert.equal(saved.batch.posts[0].text,revisionInput.text);
  response=await send(path.replace('/revisions','/apply'),{kind:'copy',copyIndex:1,baseRevision:'original',revisionId:'original'});assert.equal(response.status,409);
  response=await fetch(url+path+'?kind=copy&copyIndex=1');const history=await response.json();assert.equal(history.currentRevision,first.id);assert.equal(history.original.text,'# 原稿A\n\n正文A');
  const promptPath='/api/content-ops/image-prompts/xhs/abc123/1.png';
  response=await send(promptPath,{requestId:'reverse-http-test'},{Origin:'https://unrelated.invalid'});assert.equal(response.status,403);
  await mkdir(join(dir,'data/images/xhs/abc123'),{recursive:true});await writeFile(join(dir,'data/images/xhs/abc123/1.png'),png);
  await writeFile(join(dir,'data/posts.jsonl'),JSON.stringify({id:'abc123',platform:'xhs',images:['data/images/xhs/abc123/1.png']})+'\n');
  response=await fetch(url+promptPath);assert.equal(response.status,200);const inspected=await response.json();assert.equal(inspected.run,null);assert.equal(response.headers.get('cache-control'),'no-store');
  response=await send(promptPath,{requestId:'reverse-http-stale',imageSha256:'stale'});assert.equal(response.status,409);
  response=await fetch(url+promptPath.replace('1.png','2.png'));assert.equal(response.status,404);
  response=await fetch(url+'/api/content-ops/batches/batch-123/posts/job-12345/prompts');assert.equal(response.status,200);assert.deepEqual((await response.json()).requests,[]);
});

test('batch resume creates a non-destructive snapshot and starts only one continuation',async t=>{
  const {dir,db,production}=await revisionFixture(t);
  const originalDir=join(dir,'original');const raw=JSON.stringify({product_model:'GLM5.3',platform:'xhs',posts:[]});
  await writeFile(join(originalDir,'manifest.json'),raw);await writeFile(join(originalDir,'copy.json'),'{"posts":[]}');
  await writeFile(join(originalDir,'vision-prompt-1.txt'),'{"background_style":{"profile":"光影纸张"}}');
  db.prepare("UPDATE content_ops_batches SET status='failed' WHERE id='batch-123'").run();
  db.prepare("UPDATE analysis_jobs SET status='failed' WHERE id='job-12345'").run();
  const calls=[];production.run=async(...args)=>{calls.push(args);};
  assert.equal(production.public(production.get('batch-123')).resumable,true);
  const [first,second]=await Promise.all([production.resume('batch-123'),production.resume('batch-123')]);
  assert.equal(first.batch.status,'running');assert.equal(second.batch.id,'batch-123');assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['batch-123',{resume:true}]);
  const current=production.get('batch-123');assert.notEqual(current.output_dir,originalDir);assert.ok(current.output_dir.startsWith(join(dir,'recovered-batches')));
  assert.equal(await readFile(join(originalDir,'manifest.json'),'utf8'),raw);
  assert.equal(await readFile(join(originalDir,'post-1.md'),'utf8'),'unchanged export');
  assert.equal(await readFile(join(current.output_dir,'vision-prompt-1.txt'),'utf8'),await readFile(join(originalDir,'vision-prompt-1.txt'),'utf8'));
  assert.equal(JSON.parse(await readFile(join(current.output_dir,'manifest.json'),'utf8')).recovery.source_output_dir,originalDir);
  await production.resume('batch-123');assert.equal(calls.length,1);
});

test('batch resume refuses missing copy checkpoints and abnormal snapshot files before generation',async t=>{
  const {dir,db,production}=await revisionFixture(t);
  db.prepare("UPDATE content_ops_batches SET status='failed' WHERE id='batch-123'").run();
  const calls=[];production.run=async(...args)=>calls.push(args);
  await assert.rejects(()=>production.resume('batch-123'),/尚无完整/u);
  await writeFile(join(dir,'original/copy.json'),'{"posts":[]}');
  await writeFile(join(dir,'original/manifest.json'),JSON.stringify({product_model:'GLM5.3',platform:'xhs'}));
  await symlink(join(dir,'original/post-1.md'),join(dir,'original/post-1-copy-2.md'));
  await assert.rejects(()=>production.resume('batch-123'),/异常文件/u);
  assert.equal(production.get('batch-123').status,'failed');assert.equal(production.get('batch-123').output_dir,join(dir,'original'));assert.equal(calls.length,0);
});

// Prompt tools use immutable reference snapshots and an isolated history DB.
import { ContentOpsPrompts } from './content-ops-prompts.mjs';
import { promptBlock } from './content-ops-prompt-ui.mjs';
async function promptFixture(t,mode='ready'){
  const base=await revisionFixture(t);const {dir,db,production}=base;
  await mkdir(join(dir,'data/images/xhs/abc123'),{recursive:true});
  await writeFile(join(dir,'data/images/xhs/abc123/1.png'),png);
  await writeFile(join(dir,'data/images/xhs/abc123/2.png'),Buffer.concat([png,Buffer.from('second image')]));
  const records=[{id:'abc123',platform:'xhs',title:'单图观察',images:['data/images/xhs/abc123/1.png','data/images/xhs/abc123/2.png']}];
  await writeFile(join(dir,'data/posts.jsonl'),JSON.stringify(records[0])+'\n');
  await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_BASE_URL=https://offline.invalid/v1\nCONTENT_OPS_API_KEY=fake-only\nCONTENT_OPS_VISION_MODEL=vision-test\n');
  const calls=[];
  const spawnProcess=(command,args,options)=>{
    const child=new EventEmitter();child.kill=()=>queueMicrotask(()=>child.emit('close',1));
    const entry={command,args,options};calls.push(entry);
    if(mode==='hold')return child;
    void(async()=>{const input=JSON.parse(await readFile(args[args.indexOf('--input')+1],'utf8'));entry.input=input;entry.image=await readFile(input.image_path);
      const result=mode==='error'?{error:'offline failure'}:{prompt:'灰白背景，原图准确文案 <script>不能执行</script>',negativePrompt:'无内框',imageSha256:input.image_sha256,model:input.vision_model,width:1,height:1};
      await writeFile(args[args.indexOf('--output')+1],JSON.stringify(result));child.emit('close',0);
    })().catch(e=>child.emit('error',e));return child;
  };
  const prompts=new ContentOpsPrompts({db,root:dir,production,references:new ContentOpsReferenceStore({root:dir}),spawnProcess});
  return {...base,prompts,promptCalls:calls,target:{platform:'xhs',id:'abc123',filename:'1.png'}};
}
async function promptDone(prompts,id){for(let i=0;i<300;i++){const row=prompts.public(prompts.get(id));if(row.status!=='running'&&!prompts.children.has(id))return row;await new Promise(r=>setTimeout(r,10));}throw new Error('prompt did not finish');}

test('single-image reverse caches across reopen, deduplicates concurrent requests and never changes references',async t=>{
  const {dir,prompts,promptCalls,target}=await promptFixture(t);const before=await readFile(join(dir,'data/posts.jsonl'));
  const state=await prompts.inspect(target);assert.equal(state.run,null);assert.equal(state.model,'vision-test');
  const input={requestId:'reverse-request-123',imageSha256:state.imageSha256};
  const [first,second]=await Promise.all([prompts.create(target,input),prompts.create(target,{...input,requestId:'another-request-123'})]);
  assert.equal(first.id,second.id);const ready=await promptDone(prompts,first.id);assert.equal(ready.status,'ready',ready.error);
  assert.equal(promptCalls.length,1);assert.equal(promptCalls[0].args[1],'reverse');assert.deepEqual(promptCalls[0].image,png);
  assert.equal((await prompts.inspect(target)).run.id,first.id);
  assert.equal((await prompts.create(target,{...input,requestId:'reopen-request-123'})).id,first.id);assert.equal(promptCalls.length,1);
  assert.deepEqual(await readFile(join(dir,'data/posts.jsonl')),before);assert.deepEqual(await readFile(join(dir,'data/images/xhs/abc123/1.png')),png);
  assert.deepEqual(await readdir(join(dir,'scratch/hanabi-runtime/prompts')),[]);
  assert.ok(!promptBlock('标题',ready.result.prompt).includes('<script>'));assert.ok(promptBlock('标题',ready.result.prompt).includes('&lt;script&gt;'));
});

test('reverse handles carousel images and invalidates cached results after image or model replacement',async t=>{
  const {dir,prompts,promptCalls,target}=await promptFixture(t);
  const a=await prompts.inspect(target),one=await prompts.create(target,{requestId:'first-request-123',imageSha256:a.imageSha256});await promptDone(prompts,one.id);
  const other={...target,filename:'2.png'},b=await prompts.inspect(other);assert.notEqual(b.imageSha256,a.imageSha256);
  const two=await prompts.create(other,{requestId:'second-request-123',imageSha256:b.imageSha256});await promptDone(prompts,two.id);assert.equal(promptCalls.length,2);
  await writeFile(join(dir,'data/images/xhs/abc123/1.png'),Buffer.concat([png,Buffer.from('replacement')]));
  assert.equal((await prompts.inspect(target)).run,null);
  await assert.rejects(()=>prompts.create(target,{requestId:'stale-request-123',imageSha256:a.imageSha256}),{statusCode:409});
  await assert.rejects(()=>prompts.create(other,{requestId:'first-request-123',imageSha256:b.imageSha256}),{statusCode:409});
  await writeFile(join(dir,'scratch/gateway.env'),'CONTENT_OPS_VISION_MODEL=other-model\n');assert.equal((await prompts.inspect(other)).run,null);
});

test('reverse rejects unowned/missing/symlink images before invocation and retries failures only on explicit request',async t=>{
  const {dir,prompts,promptCalls,target}=await promptFixture(t,'error');
  await assert.rejects(()=>prompts.inspect({...target,filename:'not-listed.png'}),{statusCode:404});
  await rm(join(dir,'data/images/xhs/abc123/1.png'));await symlink(join(dir,'original/post-1.md'),join(dir,'data/images/xhs/abc123/1.png'));
  await assert.rejects(()=>prompts.inspect(target));assert.equal(promptCalls.length,0);
  const second={...target,filename:'2.png'},state=await prompts.inspect(second);const first=await prompts.create(second,{requestId:'failed-request-123',imageSha256:state.imageSha256});
  assert.equal((await promptDone(prompts,first.id)).status,'failed');assert.equal((await prompts.inspect(second)).run.id,first.id);assert.equal(promptCalls.length,1);
  const retry=await prompts.create(second,{requestId:'retry-request-123',imageSha256:state.imageSha256});assert.notEqual(retry.id,first.id);await promptDone(prompts,retry.id);assert.equal(promptCalls.length,2);
});

test('generation prompt inspection preserves exact attempts and legacy records without inventing missing prompts',async t=>{
  const {dir,prompts}=await promptFixture(t);const path=join(dir,'original/manifest.json');
  await writeFile(path,JSON.stringify({vision_model:'vision-old',posts:[{index:1,visual_plan:{visual_prompt:'视觉原文',cover_texts:[{text:'GLM5.3'}]},image_generation:{prompt:'实际提交\n不是重建词',model:'image-old',mode:'layered_poster'}}]}));
  const before=await readFile(path),old=await prompts.generation('batch-123','job-12345');assert.equal(old.requests[0].prompt,'实际提交\n不是重建词');assert.equal(old.visionPrompt,'视觉原文');assert.equal(old.mode,'layered_poster');assert.deepEqual(await readFile(path),before);
  await writeFile(path,JSON.stringify({posts:[{index:1,image_requests:[{prompt:'第一次失败',status:'failed'},{prompt:'第二次成功',status:'completed'}]}]}));
  const modern=await prompts.generation('batch-123','job-12345');assert.deepEqual(modern.requests.map(r=>r.prompt),['第一次失败','第二次成功']);
  await writeFile(path,'{}');assert.deepEqual((await prompts.generation('batch-123','job-12345')).requests,[]);
  await assert.rejects(()=>prompts.generation('batch-123','other-job'),{statusCode:404});
});

test('reverse limits concurrent images and preserves interrupted history without automatic retry',async t=>{
  const {dir,prompts,promptCalls,target}=await promptFixture(t,'hold');
  const a=await prompts.inspect(target),first=await prompts.create(target,{requestId:'held-first-123',imageSha256:a.imageSha256});
  const secondTarget={...target,filename:'2.png'},b=await prompts.inspect(secondTarget);
  const second=await prompts.create(secondTarget,{requestId:'held-second-123',imageSha256:b.imageSha256});
  await writeFile(join(dir,'data/images/xhs/abc123/3.png'),Buffer.concat([png,Buffer.from('third')]));
  await writeFile(join(dir,'data/posts.jsonl'),JSON.stringify({id:'abc123',platform:'xhs',images:[1,2,3].map(i=>`data/images/xhs/abc123/${i}.png`)})+'\n');
  const third={...target,filename:'3.png'},c=await prompts.inspect(third);
  await assert.rejects(()=>prompts.create(third,{requestId:'held-third-123',imageSha256:c.imageSha256}),{statusCode:409});
  for(let i=0;i<100&&promptCalls.length<2;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(promptCalls.length,2);prompts.recover();prompts.shutdown();
  assert.equal((await promptDone(prompts,first.id)).status,'failed');assert.equal((await promptDone(prompts,second.id)).status,'failed');
  assert.equal((await prompts.inspect(target)).run.id,first.id);assert.equal(promptCalls.length,2);
});

test('image prompt revisions store exact pending/ready input, restore prompts and preserve original files',async t=>{
  const {dir,revisions,production,calls}=await revisionFixture(t);
  const prompt='  蓝色纸张，GLM5.3。\n保留完整文字与空格  ';
  const input={kind:'image',copyIndex:0,action:'regenerate',renderMode:'direct_poster',prompt,requestId:'repaint-request-123',baseRevision:'original'};
  const before=await readFile(join(dir,'original/post-1.md'));
  const first=await revisions.create('batch-123','job-12345',input);assert.equal(first.result.prompt,prompt);
  assert.equal((await revisions.create('batch-123','job-12345',input)).id,first.id);
  const ready=await revisionDone(revisions,first.id);assert.equal(ready.status,'ready',ready.error);assert.equal(ready.result.prompt,prompt);
  assert.equal(calls[0].input.prompt,prompt);assert.equal(calls[0].input.source_image,undefined);assert.equal(calls[0].input.render_mode,'direct_poster');
  assert.equal(revisions.head('job-12345','image',0),'original');
  revisions.apply('batch-123','job-12345',{kind:'image',copyIndex:0,baseRevision:'original',revisionId:first.id});
  assert.equal(revisions.history('batch-123','job-12345','image',0).current.prompt,prompt);
  assert.equal(production.public(production.get('batch-123')).posts[0].image,ready.result.image);
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{...input,requestId:'stale-repaint-123'}),{statusCode:409});
  revisions.apply('batch-123','job-12345',{kind:'image',copyIndex:0,baseRevision:first.id,revisionId:'original'});
  assert.deepEqual(await readFile(join(dir,'original/post-1.md')),before);assert.equal(calls.length,1);
});

test('failed prompt regeneration retains editable input and missing images can be repaired without changing original jobs',async t=>{
  const failed=await revisionFixture(t,'error'),input={kind:'image',copyIndex:0,action:'regenerate',renderMode:'direct_poster',prompt:'蓝色纸面',requestId:'failed-repaint-123',baseRevision:'original'};
  const first=await failed.revisions.create('batch-123','job-12345',input);const error=await revisionDone(failed.revisions,first.id);
  assert.equal(error.status,'failed');assert.equal(error.result.prompt,input.prompt);assert.equal(failed.revisions.head('job-12345','image',0),'original');
  const fixture=await revisionFixture(t);fixture.db.prepare("UPDATE content_ops_batches SET status='failed' WHERE id='batch-123'").run();
  fixture.db.prepare("UPDATE analysis_jobs SET status='failed',attachments='[]' WHERE id='job-12345'").run();
  assert.equal(fixture.revisions.history('batch-123','job-12345','image',0).original.image,null);
  const version=await fixture.revisions.create('batch-123','job-12345',input);const ready=await revisionDone(fixture.revisions,version.id);assert.equal(ready.status,'ready',ready.error);
  const adopted=fixture.revisions.apply('batch-123','job-12345',{kind:'image',copyIndex:0,baseRevision:'original',revisionId:ready.id}).batch;
  assert.equal(adopted.status,'completed');assert.equal(adopted.posts[0].status,'completed');assert.equal(fixture.production.get('batch-123').status,'failed');
  const restored=fixture.revisions.apply('batch-123','job-12345',{kind:'image',copyIndex:0,baseRevision:ready.id,revisionId:'original'}).batch;
  assert.equal(restored.status,'failed');assert.equal(restored.posts[0].image,null);
});

test('image typography reaches renderer and restores with versions; invalid settings fail before spawn',async t=>{
  const {revisions,calls}=await revisionFixture(t);
  const typography={scale:1.2,align:'left',font:'songti'};
  const coverTexts=[{role:'hook',text:'挖到宝了',scale:1.1},{role:'benefit',text:'便宜量大',scale:.8},{role:'model',text:'GLM5.3',scale:1.5}];
  const colorGrade={brightness:120,contrast:110,saturation:90,warmth:105};
  const input={kind:'image',copyIndex:0,action:'regenerate',renderMode:'layered_poster',prompt:'浅蓝纸张',requestId:'typography-request-123',baseRevision:'original',
    typography,coverTexts,colorGrade,backgroundStyle:{profile:'paper_shadow'}};
  for(const bad of [[],{scale:true,align:'left'},{scale:1.6,align:'left'},{scale:.5,align:'left'},{scale:1,align:'bad'},{scale:1,align:'left',font:'missing_font'}])await assert.rejects(()=>revisions.create('batch-123','job-12345',{...input,typography:bad}),{statusCode:400});
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{...input,requestId:'bad-line-scale',coverTexts:[{role:'hook',text:'挖到宝了',scale:1.6},{role:'benefit',text:'便宜量大'},{role:'model',text:'GLM5.3'}]}),{statusCode:400});
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{...input,requestId:'bad-grade',colorGrade:{brightness:10,contrast:100,saturation:100,warmth:100}}),{statusCode:400});
  assert.equal(calls.length,0);
  const pending=await revisions.create('batch-123','job-12345',input);assert.deepEqual(pending.result.typography,typography);assert.deepEqual(pending.result.coverTexts,coverTexts);assert.deepEqual(pending.result.colorGrade,colorGrade);
  const ready=await revisionDone(revisions,pending.id);assert.equal(ready.status,'ready',ready.error);assert.deepEqual(calls[0].input.typography,typography);assert.deepEqual(calls[0].input.cover_texts,coverTexts);assert.deepEqual(calls[0].input.color_grade,colorGrade);
  revisions.apply('batch-123','job-12345',{kind:'image',copyIndex:0,baseRevision:'original',revisionId:ready.id});
  assert.deepEqual(revisions.history('batch-123','job-12345','image',0).current.typography,typography);
  revisions.apply('batch-123','job-12345',{kind:'image',copyIndex:0,baseRevision:ready.id,revisionId:'original'});
  assert.deepEqual(revisions.history('batch-123','job-12345','image',0).current.typography,{scale:1,align:'center',font:'source_han_sans'});
});

test('live typesetting preview is ephemeral, source-bound and local; saving keeps original and restores editable fields',async t=>{
  const {dir,db,revisions,calls}=await revisionFixture(t);
  await writeFile(join(dir,'original/manifest.json'),JSON.stringify({posts:[{index:1,visual_plan:{collection_name:'大字报',cover_texts:[]},image_requests:[{prompt:'原背景词',mode:'layered_poster'}]}]}));
  const body={baseRevision:'original',sourceRevision:'original',typography:{scale:1.2,align:'left',font:'hiragino_sans'},coverTexts:[{role:'hook',text:'挖到宝了'},{role:'benefit',text:'便宜量大'},{role:'model',text:'GLM5.3'}],backgroundStyle:{profile:'paper_shadow'}};
  const result=await revisions.preview('batch-123','job-12345',body);assert.match(result.image,/^data:image\/png;base64,/u);
  assert.equal(db.prepare('SELECT count(*) as n FROM content_ops_revisions').get().n,0);
  assert.deepEqual(await readdir(join(dir,'scratch/hanabi-runtime/previews')),[]);assert.equal(calls[0].input.action,'typeset');
  assert.equal(calls[0].input.prompt,'原背景词');assert.deepEqual(calls[0].input.typography,body.typography);
  await assert.rejects(()=>revisions.preview('batch-123','job-12345',{...body,baseRevision:'stale'}),{statusCode:409});
  await assert.rejects(()=>revisions.create('batch-123','job-12345',{...body,kind:'image',copyIndex:0,action:'typeset',requestId:'layout-save-bad',renderMode:'layered_poster',prompt:'变了'}),{statusCode:400});
  const version=await revisions.create('batch-123','job-12345',{...body,kind:'image',copyIndex:0,action:'typeset',requestId:'layout-save-good',renderMode:'layered_poster',prompt:'原背景词'});
  const ready=await revisionDone(revisions,version.id);assert.equal(ready.status,'ready',ready.error);
  assert.equal(revisions.head('job-12345','image',0),'original');assert.deepEqual(ready.result.typography,body.typography);
});

test('live preview bounds concurrency and cleans failed work without history entries',async t=>{
  const fixture=await revisionFixture(t,'hold');
  await writeFile(join(fixture.dir,'original/manifest.json'),JSON.stringify({posts:[{visual_plan:{collection_name:'大字报'}}]}));
  const body={baseRevision:'original',coverTexts:[{role:'hook',text:'发现'},{role:'benefit',text:'便宜'},{role:'model',text:'GLM5.3'}]};
  const settled=Promise.allSettled([fixture.revisions.preview('batch-123','job-12345',body),fixture.revisions.preview('batch-123','job-12345',body)]);
  await assert.rejects(()=>fixture.revisions.preview('batch-123','job-12345',body),{statusCode:429});
  for(let i=0;i<100&&fixture.calls.length<2;i++)await new Promise(r=>setTimeout(r,5));
  fixture.revisions.shutdown();const results=await settled;assert.ok(results.every(r=>r.status==='rejected'));
  assert.equal(fixture.db.prepare('SELECT count(*) as n FROM content_ops_revisions').get().n,0);
  assert.deepEqual(await readdir(join(fixture.dir,'scratch/hanabi-runtime/previews')),[]);
});
