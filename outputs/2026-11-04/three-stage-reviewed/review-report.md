# 三阶段生成与 Hanabi 工作台 · 执行自验交接

日期：2026-11-04。技术自验完成，规划 agent 终审待办；未发布。目录名 reviewed 不表示已通过终审。

## 功能与验收

- 文案阶段只负责文字；视觉阶段发送最多三张本地真实封面的 base64 图像与本次文案；Qwen 阶段直接生成完整海报。文案与视觉当前分别调用同一 Sonnet 型号，可在配置中单独指定；图像使用 Qwen。参考图路径、SHA256、各阶段模型和原始 usage 以 [manifest.json](manifest.json) 为准。
- 接口配置、素材模型／版式组合筛选、分页与跨筛选引用、运营规则编辑入口、五份业务 Markdown 的实时阅读及目录已在浏览器检查。分类来自源字段启发式，需结合封面核对，不代表像素识别结果。
- 回归命令：`scratch/.venv/bin/python -m unittest scripts.lib.test_pipeline`、`npm test --prefix hanabi`；最终数量和 doctor 结果见仓库 TODO 本任务条目。生成子进程优先使用启动器建立的 scratch/.venv，避免 Pillow 依赖缺失。
- 正式入口为 http://127.0.0.1:6187 。现有 LaunchAgent 拉起失败，当前由本次启动的 Node 服务提供；自动启动机制不算本轮已修复。

## 真实生成与复核边界

本轮真实调用两次。第一次稿件混入参考帖的“百万上下文”说法，已强化参考仅供风格、事实仅来自本次简报的边界并重测；第一次中间样本移至本机 scratch/three-stage-audit/first-attempt。

本目录保留重测 [成图](post-1.png) 和 [文案](post-1.md)，原始中间响应路径记录于 manifest 的 audit_files。重测图为 1080×1440：可观察到顶部白色大字、黄色型号块、暗色工作台、发光玻璃卡片、机器人和底部小图标。构图审美与中文字形由规划 agent 终审，执行 agent 不代作风格通过结论。

**文案仍有“试过一个方法”及未经证实的效果判断，不能直接发布。** 提示词约束不是事实核验保证，需规划 agent 结合简报核对全文及海报。

## 用量追溯

不另建一份费用账。以 manifest 的 copy_calls、vision_calls、posts[].image_generation.usage 为唯一生成日志源；网关 token 含缓存和图像口径，不能据此估算实际人民币费用。可在仓库根目录重建用量汇总：

```sh
python3 - <<'USAGE'
import json
from pathlib import Path
paths = [Path('scratch/three-stage-audit/first-attempt/manifest.json'), Path('outputs/2026-11-04/three-stage-reviewed/manifest.json')]
for path in paths:
    m = json.loads(path.read_text())
    calls = [('copy', c) for c in m['copy_calls']] + [('vision', c) for c in m['vision_calls']] + [('image', p['image_generation']) for p in m['posts']]
    print(path, [(stage, call.get('model'), call.get('usage')) for stage, call in calls])
USAGE
```

## 交接限制

接手时有 443 个既有暂存删除和多项未提交迁移依赖。本任务没有重置这些变更，也没有将它们混入新提交；提交与 push 待迁移范围独立核对。代码、验收稿及当前配置已留在本机工作区。
