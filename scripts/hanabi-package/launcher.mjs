import {spawn, execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile, writeFile, cp, mkdir, mkdtemp, rm, readdir, readlink} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createServer} from 'node:net';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const appData = join(homedir(), 'Library/Application Support/Content Alchemy');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packageFiles = Object.keys(manifest.files).filter(name => /^app\/(?:server\.mjs|app\.js|index\.html|styles\.css|lib\/.*)$/u.test(name)).map(name => name.slice(4));

async function verify() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('这份包适用于 Apple Silicon Mac（M 系列）；Intel Mac 需要另行构建。');
  let checked = 0;
  for (const [name, info] of Object.entries(manifest.files)) {
    const path = resolve(root, name);
    if (!path.startsWith(root + '/')) throw new Error('清单路径无效。');
    if (info.symlink) {
      if (await readlink(path) !== info.symlink) throw new Error('符号链接校验失败：' + name);
    } else if (hash(await readFile(path)) !== info.sha256) throw new Error('文件校验失败：' + name);
    checked++;
  }
  return {checked, version: manifest.bundleVersion};
}
async function health(port = 6187) {
  try { const response = await fetch(`http://127.0.0.1:${port}/healthz`, {signal:AbortSignal.timeout(600)}); return response.ok && (await response.json()).ok === true; }
  catch {return false;}
}
async function waitHealthy(port, child) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await health(port)) return;
    if (child?.exitCode !== null && child?.exitCode !== undefined) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Hanabi 未能启动；请查看本机 Content Alchemy/logs 中的日志。');
}
async function sameRuntime() {
  try {
    for (const name of packageFiles) if (hash(await readFile(join(appData, 'runtime', name))) !== manifest.files['app/' + name].sha256) return false;
    return true;
  } catch {return false;}
}
async function sameCopy(source, target, {skipSecrets = false} = {}) {
  await mkdir(target, {recursive:true, mode:0o700});
  for (const entry of await readdir(source, {withFileTypes:true})) {
    if (skipSecrets && ['work', '.venv', 'outputs'].includes(entry.name)) continue;
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) await sameCopy(from, to, {skipSecrets});
    else if (!existsSync(to) || hash(await readFile(from)) !== hash(await readFile(to))) await cp(from, to, {dereference:true});
  }
}
function environment(runtimeRoot, dataDir = appData, port = 6187) {
  const nodeBin = join(runtimeRoot, 'runtimes/node/bin');
  const pythonBin = join(runtimeRoot, 'runtimes/python/bin');
  return {...process.env, PATH:[nodeBin, pythonBin, process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'].join(':'), CONTENT_ALCHEMY_DATA_DIR:dataDir, CONTENT_ALCHEMY_PORT:String(port)};
}
async function smokeTest() {
  const verification = await verify();
  const scratch = await mkdtemp(join(tmpdir(), 'hanabi-package-test-'));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let child, closed, stderr = '';
  try {
    const python = join(root, 'runtimes/python/bin/python3');
    await exec(python, ['-c', 'import ssl,sqlite3,yaml; from PIL import Image,ImageFont; print("Python + Pillow + PyYAML OK")']);
    await exec(process.execPath, ['--input-type=module', '-e', 'await import("node-pty"); console.log("native module OK")'], {cwd:join(root,'app')});
    const env = {...environment(root, scratch, port), CONTENT_OPS_ROOT:join(root, 'content-ops')};
    child = spawn(process.execPath, ['server.mjs'], {cwd:join(root, 'app'), env, stdio:['ignore', 'ignore', 'pipe']});
    child.stderr.on('data', data => {stderr = (stderr + data).slice(-4000);});
    closed = new Promise(resolve => child.once('close', resolve));
    await waitHealthy(port, child);
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(base + '/');
    const html = await response.text();
    if (!response.ok || !html.includes('生成小红书图文') || !html.includes('name="backgroundMode"')) throw new Error('未找到最新小红书生成界面。');
    const config = await (await fetch(base + '/api/content-ops/config')).json();
    if (!config.available || !config.cachedAvailable || config.configured) throw new Error('生成器、背景或无令牌状态不符合打包预期。');
    const imageTest = await exec(python, ['-c', 'import importlib.util,sys; from pathlib import Path; from PIL import Image; spec=importlib.util.spec_from_file_location("gen",sys.argv[1]); gen=importlib.util.module_from_spec(spec); spec.loader.exec_module(gen); out=Path(sys.argv[2]); p={"title_lines":["安排！","GLM5.3","先跑一个真实任务"],"cover_footer":"试用思路，结果自行核对"}; gen.cover(Path(sys.argv[3]),out,p,{"background":"#447FCF","card":"#FFFFFF","accent":"#85CFAC"},Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),0); print(Image.open(out).size)', join(root, 'content-ops/scripts/gen-xhs-post.py'), join(scratch,'cover.png'), join(root,'content-ops/data/images/backgrounds/company-qwen-2026-11-01.png')]);
    console.log(JSON.stringify({ok:true, ...verification, health:true, latestForm:true, config, offlineCover:imageTest.stdout.trim(), personalDatabaseUsed:false, modelCalls:0}));
  } catch (error) {throw new Error(error.message + (stderr ? '\n' + stderr : ''));}
  finally {
    if (child && child.exitCode === null) {child.kill('SIGTERM'); const killTimer = setTimeout(() => child.kill('SIGKILL'), 4000); await closed; clearTimeout(killTimer);}
    await rm(scratch, {recursive:true, force:true});
  }
}
async function start() {
  await verify();
  const portable = join(appData, 'portable', manifest.bundleVersion);
  const marker = join(portable, '.complete');
  if (!existsSync(marker)) {
    await mkdir(portable, {recursive:true, mode:0o700});
    await cp(join(root, 'app'), join(portable, 'app'), {recursive:true, dereference:true});
    await cp(join(root, 'runtimes'), join(portable, 'runtimes'), {recursive:true, dereference:true});
    await writeFile(marker, manifest.bundleVersion, {mode:0o600});
  }
  // Copy only the packaged generation files; keep this machine's key, history and outputs.
  await sameCopy(join(root, 'content-ops'), join(appData, 'content-ops'), {skipSecrets:true});
  const env = environment(portable);
  const installedNode = join(portable, 'runtimes/node/bin/node');
  const current = await sameRuntime();
  if (!current || !await health()) {
    console.log('正在安装或启动本机 Hanabi 后台服务……');
    const {stdout} = await exec(installedNode, ['scripts/install-background-service.mjs'], {cwd:join(portable, 'app'), env, timeout:120000, maxBuffer:4*1024*1024});
    console.log(stdout.trim());
  }
  await waitHealthy(6187);
  await exec('/usr/bin/open', ['http://127.0.0.1:6187']);
  console.log('Hanabi 已打开。首次换机请运行「配置公司网关.command」设置公司 Key。');
}
try {
  if (process.argv.includes('--verify')) console.log(JSON.stringify({ok:true,...await verify()}));
  else if (process.argv.includes('--self-test')) await smokeTest();
  else await start();
} catch (error) {console.error(error.message); process.exitCode = 1;}
