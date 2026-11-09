# BrewReel 内置工作流

适用：用户指定 BrewReel，或任务是 15–45 秒竖版产品宣传片、App 功能演示、上新和门店推广短片。其他视频继续按 `multimodal-playbook.md` 设计。这里的 `../assets/brewreel/` 是随炼金炉保存的完整 BrewReel v0.5.1 工程，来源为 [Finderchangchang/brewreel](https://github.com/Finderchangchang/brewreel)，基于提交 `2aed49a8daeacee8ad96ddfd2906a04e329033e2`。只在 `template/remotion.config.ts` 增加了可选的本地浏览器路径。版权与第三方许可见工程内的 `LICENSE`、`NOTICE`、`THIRD_PARTY_LICENSES.md`。

## 从炼金炉交接到 BrewReel

1. 先按炼金炉的内容母板确定受众、唯一核心承诺、事实底稿、素材来源和发布渠道。把结果写成项目自己的 `brief.md`；字段以 `../assets/brewreel/brief-template.md` 为准。产品名、核心动作、卖点、数字及来源、素材和获取方式缺失时，不要补造。
2. 读取 `../assets/brewreel/SKILL.md`。按内容选 `cards`、`quiz` 或 `journey`，只读取对应 `styles/<style>/STYLE.md`、`recipes.md`；非软件行业另读对应 `industries/<industry>/recipe.md`。按工程规则生成项目自己的 `storyboard.json`，输入和成片放在项目工作目录，不放进炼金炉或内置工程。
3. 使用内置校验器核对分镜；简报有文件时传 `--brief`。按报错修订分镜，保留 warnings 和 human 项供复核。校验通过后，用户要求成片时才运行内置渲染器。`--out` 指向工程之外的项目输出目录。
4. 以渲染器最后的 `交付：<mp4 路径>` 和退出码 0 为交付依据，再查看 `report.txt`、`sheet.png` 和检查帧。人工检查字幕、画面、核心动作、事实与素材授权；把 human 项及发布前自查事项交给发布者。分镜或素材改过后重跑，不能把旧片当作新片。

```bash
BREWREEL="$HOME/.codex/skills/ai-content-alchemy/assets/brewreel"
node "$BREWREEL/scripts/validate.mjs" /绝对路径/项目/storyboard.json --brief /绝对路径/项目/brief.md
node "$BREWREEL/scripts/make.mjs" /绝对路径/项目/storyboard.json --out /绝对路径/项目/output --brief /绝对路径/项目/brief.md
```

`--brief` 仅在已有简报文件时使用。首次出片按内置 `README.md` 安装 `template/` 的 npm 依赖、Remotion 浏览器及配乐所需的 Python 依赖；校验不需要先安装渲染依赖。配音仅在用户需要旁白时启用，密钥只从环境变量读取；没有真实配音密钥时的 mock 声音只供预览。不要把 API 密钥写入简报、分镜或 Skill 文件。

若 Remotion 浏览器组件无法下载，而本机有 Chrome / Chromium，可设 `BREWREEL_BROWSER_EXECUTABLE` 为浏览器可执行文件的绝对路径，再运行 `make.mjs`；不同浏览器版本可能造成细微画面差异，仍需看检查帧。

此设备已在内置 `template/` 执行 `npm ci`，并在 `$HOME/.cache/ai-content-alchemy/brewreel-venv/` 安装 `numpy`、`scipy`。当前 Remotion 浏览器组件下载超时，已用本机的 Playwright Chrome Headless Shell 完成整片渲染。此设备再次出片时，在上面的命令前设置：

```bash
export PYTHON="$HOME/.cache/ai-content-alchemy/brewreel-venv/bin/python"
export BREWREEL_BROWSER_EXECUTABLE="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell"
```

如果缓存中的浏览器版本改变，先找实际可执行文件再更新该环境变量；不要假定旧路径仍存在。
在当前浏览器回退路径下，`--stills` 单帧预览曾未返回布局探针；完整视频渲染能返回探针并通过布局检查。若单帧检查报“layout.json 为空”，不要据此认定完整出片已通过或失败，继续按完整出片的 `report.txt`、manifest 和人工检查帧验收。

BrewReel 的自动校验只能拦住部分文案、画面和行业规则。炼金炉的事实核验、去 AI 味和人工画面终检仍适用；不要把“校验通过”写成“可直接发布”。
