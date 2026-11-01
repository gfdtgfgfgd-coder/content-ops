# T11 · 改 Hanabi 界面接入生成脚本

执行者：Codex
状态：完成（缓存背景模式实测可用，新图受 Q9 额度限制）
依赖：T08（生成脚本跑通）
开始时间：2026-11-01 晚

## 目标
改 Hanabi 的前后端，让它能调 `gen-xhs-post.py`，在界面上输入模型名 + 数量，点生成，出帖子。今天能在 Hanabi 上用。

## 输入
- `~/Desktop/Hanabi完整备份_2026-10-27/`（Nuxt 项目，后端 API + 前端页面）
- `scripts/gen-xhs-post.py`（T08 产出）

## 步骤
1. **读 Hanabi 代码结构**（30 分钟）
   - 找后端生成接口（可能在 `server/api/generate.ts` 或类似路径）
   - 找前端生成页面（可能在 `pages/generate.vue` 或 `components/GenerateForm.vue`）
   - 记录：
     - 原来的生成逻辑在哪个文件
     - 前端表单有哪些字段（模型、平台、数量）
     - 后端接口 URL 和参数格式

2. **改后端接口**（1.5 小时）
   - 找到生成接口（如 `server/api/generate.ts`），改成：
     ```typescript
     export default defineEventHandler(async (event) => {
       const { model, platform, count } = await readBody(event)
       
       // 调 gen-xhs-post.py
       const { exec } = await import('child_process')
       const outputDir = `outputs/${new Date().toISOString().split('T')[0]}`
       const cmd = `python3 scripts/gen-xhs-post.py --model "${model}" --platform ${platform} --count ${count} --output ${outputDir}`
       
       return new Promise((resolve, reject) => {
         exec(cmd, { cwd: '/Users/lilith/Desktop/content-ops' }, (err, stdout, stderr) => {
           if (err) reject({ error: stderr })
           else {
             // 读 outputDir 下的 .md 和 .png，返回给前端
             const fs = require('fs')
             const files = fs.readdirSync(outputDir)
             const posts = files.filter(f => f.endsWith('.md')).map(f => {
               const mdPath = `${outputDir}/${f}`
               const pngPath = mdPath.replace('.md', '.png')
               return {
                 text: fs.readFileSync(mdPath, 'utf-8'),
                 image: fs.existsSync(pngPath) ? pngPath : null
               }
             })
             resolve({ posts })
           }
         })
       })
     })
     ```
   - 测试：`curl -X POST http://localhost:3000/api/generate -d '{"model":"GLM5.3","platform":"xhs","count":2}'`

3. **改前端页面**（1 小时）
   - 找到生成表单页面（如 `pages/generate.vue`），改成：
     ```vue
     <template>
       <div>
         <h1>生成小红书帖子</h1>
         <form @submit.prevent="generate">
           <label>模型名：<input v-model="model" placeholder="GLM5.3" required /></label>
           <label>平台：
             <select v-model="platform">
               <option value="xhs">小红书</option>
               <!-- 后续加 <option value="xianyu">闲鱼</option> -->
             </select>
           </label>
           <label>数量：<input v-model.number="count" type="number" min="1" max="10" value="2" /></label>
           <button type="submit">生成</button>
         </form>
         
         <div v-if="loading">生成中...</div>
         
         <div v-for="(post, i) in posts" :key="i" class="post">
           <img v-if="post.image" :src="post.image" alt="封面" />
           <pre>{{ post.text }}</pre>
         </div>
       </div>
     </template>
     
     <script setup>
     const model = ref('GLM5.3')
     const platform = ref('xhs')
     const count = ref(2)
     const loading = ref(false)
     const posts = ref([])
     
     async function generate() {
       loading.value = true
       posts.value = []
       try {
         const res = await $fetch('/api/generate', {
           method: 'POST',
           body: { model: model.value, platform: platform.value, count: count.value }
         })
         posts.value = res.posts
       } catch (e) {
         alert('生成失败：' + e.message)
       } finally {
         loading.value = false
       }
     }
     </script>
     ```

4. **启动 Hanabi + 测试**（30 分钟）
   - 在 `~/Desktop/Hanabi完整备份_2026-10-27/` 目录下：
     ```bash
     npm install  # 如果依赖变了
     npm run dev
     ```
   - 浏览器打开 `http://localhost:3000`（或 Hanabi 的默认端口）
   - 测试流程：
     1. 输入模型名 `GLM5.3`
     2. 平台选「小红书」
     3. 数量填 `2`
     4. 点「生成」
     5. 等 20–30 秒
     6. 页面显示 2 个帖子（文案 + 图片）
   - 截图保存到 `docs/hanabi-interface-screenshot.png`

5. **写使用说明**（10 分钟）
   - 写 `docs/hanabi-usage.md`：
     ```markdown
     # Hanabi 界面使用说明
     
     ## 启动
     ```bash
     cd ~/Desktop/Hanabi完整备份_2026-10-27/
     npm run dev
     ```
     浏览器打开 http://localhost:3000
     
     ## 生成小红书帖子
     1. 输入模型名（如 GLM5.3、Kimi 2.6）
     2. 选平台（目前只有小红书）
     3. 填数量（1–10）
     4. 点生成
     5. 等 20–30 秒，页面显示文案 + 图片
     
     ## 后端脚本位置
     `/Users/lilith/Desktop/content-ops/scripts/gen-xhs-post.py`
     
     ## 输出保存位置
     `/Users/lilith/Desktop/content-ops/outputs/<日期>/`
     ```

## 产出
- 改过的 `~/Desktop/Hanabi完整备份_2026-10-27/server/api/generate.ts`（或类似文件）
- 改过的 `~/Desktop/Hanabi完整备份_2026-10-27/pages/generate.vue`（或类似文件）
- `docs/hanabi-usage.md`
- `docs/hanabi-interface-screenshot.png`

## 验收
- [x] Hanabi 启动成功（`npm run dev` 无报错）
- [x] 界面打开能看到表单（模型名 / 平台 / 数量）
- [x] 输入 GLM5.3 + 数量 2，点生成，页面显示 2 个帖子
- [x] 帖子有文案 + 图片，图片能显示

## 规矩
- 只改必要的文件（后端接口 + 前端表单），不重构整个 Hanabi
- 如果 Hanabi 依赖太老（Node.js 版本不兼容），先升级依赖再改
- Hanabi 的其他功能（Model Price Watch 监控）不动
- 改完的 Hanabi 不推到 content-ops 仓库，只在本地跑

## 时间估算
3 小时（读代码 0.5h + 改后端 1.5h + 改前端 1h）

## 完成记录

### 2026-11-01 · 实际实现与验收

- 启动备忘中的 Nuxt 文件只是示例。实际 Hanabi 是 Electron + Node；最新开发版位于 `/Users/lilith/Documents/ChatGPT/【探索】/content-alchemy`，运行版在应用数据目录，端口 6187。备份已读，仅作参考，未覆盖较新应用。
- 必要接入：server.mjs、app.js、index.html、styles.css；新增 content-ops-production / content-ops-ui 两个模块及 focused tests。表单放现有内容工作台顶部，保留三导航。模型/平台/数量/背景模式可见。
- 后端使用 spawn argv（shell:false），不拼接输入；同源与本机检查、1–10数量校验、请求标识防重、串行批次、持久化与重启恢复、停止、部分失败保留均已接入。没有替换真实数据库。
- 成品进入现有 analysis_jobs + 内部 conversation 上下文 + uploads，逐篇可在燃放预览查看。实测前后资料库均 25；完成任务 8→10、预览 27→29，未另造统计。
- **浏览器真操作**：GLM5.3、xhs、2、cached，点击生成，批次 `bc45c766-917e-4241-a275-7bd0c6b0190f` 完成。页面两张图均 naturalWidth/naturalHeight=1080；文案全字段禁词检查通过。截图 `docs/hanabi-interface-screenshot.png`，预览截图 `docs/hanabi-preview-screenshot.png`；副本 `outputs/2026-11-01/hanabi-验收/`。
- 终审发现第1篇开头虚构「最近在试」经历，已由公司 Claude 删除并更新同一作品版本；脚本增加独立事实终审与个人体验拦截，4项 Python 测试通过。最终成稿复核通过。
- 页面刷新后恢复同一批次；后台服务重新部署后仍显示两篇 completed，没有重跑收费请求。18项 focused Node 测试通过，`npm run test:application-ui` 通过（1400/900宽度、资料增删、Skill/成品计数、刷新与新启动），语法检查通过。
- HTTP 实测：无 Origin 生成 403、数量20为400、PNG返回200（64,365字节）、原有 Word 导出200（3,298字节）。燃放预览实际显示两篇图文，选入本批2篇成功。
- macOS 后台服务读取桌面目录会挂起；已提供应用数据目录运行副本与 `scripts/install-hanabi-runtime.py`，脚本、规则、背景、私密配置按最小范围复制，未复制企微原文或替换应用数据。一次 launchctl bootstrap 瞬态失败后修复退出信号防重并重新安装，最终 LaunchAgent running，/healthz 与配置端点均200。
- 本卡按约定只本地修改 Hanabi，不把完整应用推入 content-ops。使用说明 `docs/hanabi-usage.md` 明确换电脑还需迁移 Hanabi/背景/本机配置。
- AI行为局部追加同步至相关三份基础 Skill，用户原有内容保留。`data/wecom/raw/` 与凭证未进入 Git。

**外部限制**：公司新背景额度不足（Q9）；默认明确显示 cached，仍生成新文案与两套可辨版式，不把复用背景算作当次新生图。T04 更早聊天仍因锁屏待补（Q8）。
