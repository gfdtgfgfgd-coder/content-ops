# 素材来源（2026-11-01 Claude 从 ego 浏览器书签「素材参考帖」导出）

| 平台 | 账号 | 链接 | 规模 | 备注 |
|---|---|---|---|---|
| 小红书 | 深度deepAI（小红书号 63083359583） | https://www.xiaohongshu.com/user/profile/69df2b9f0000000032019e07 | **364 篇**（2026-04-25 至 10-30），361 图文 + 3 视频 | 思敏运营的账号。两篇置顶见下。粉丝 1703，获赞收藏 4777 |
| 闲鱼 | API大玩家 | https://www.goofish.com/personal?userId=2219851738192 | 34 个宝贝，69 粉丝 | 卖模型 API 额度：Seedance 2/2.5、GLM 5.2/5.3、Kimi K3.1 Pro。单价 ¥2–7，划线价 ¥100 |

## 小红书置顶两篇

| 标题 | 链接 | 点赞 |
|---|---|---|
| 便宜量大的GLM-5.2太香了！ | https://www.xiaohongshu.com/explore/6a30b2be000000000f00456d | 140 |
| 太香了sd2 | https://www.xiaohongshu.com/explore/6a02c2ed000000003502f752 | 612 |

## 小红书全量清单（2026-11-01 Claude 导出）

- `data/xhs/_urls.txt`：364 条带 `xsec_token` 的笔记链接，T02 直接按这个抓。
- `data/xhs/_notes-index.json`：每条的 id、标题、点赞、类型、封面图 url。
- 主页「笔记」标签显示 266，但页面状态里滚到底是 364 条且 `hasMore=false`，以状态为准。差异原因未查（可能是标签计数缓存），T02 抓完后核对。
- 点赞分布：≥50 的 9 篇，≥10 的 23 篇，其余大多个位数。Top：612（太香了sd2）、194、183、171、140（GLM-5.2 置顶）。

### 抓取技术要点（给 T02）

- 主页 DOM 是虚拟列表，永远只渲染 30 个 `section.note-item`。**不要数 DOM。** 真实数据在 `window.__INITIAL_STATE__.user.notes`（Vue ref，取 `_rawValue`），`user.noteQueries[0].hasMore` 为 false 时到底。
- 滚动触发加载：`document.scrollingElement.scrollTop = scrollHeight` 加一次 `mouse.wheel`，每轮等 notes 长度增长。364 条约 12 轮。
- 单篇链接必须带 `xsec_token`，index 里已有。
- `opencli xiaohongshu note <url>` 和 `opencli xiaohongshu download` 能取正文和下图，但在 ego 浏览器里报「Creating browser windows from extensions is not supported in Owl」，需用 Chrome 或改用 ego 的 page.evaluate 读 `__INITIAL_STATE__.note`。T02 先试 ego 路径。

## 闲鱼首屏观察（2026-11-01）

想要数最高的几条：351、97、62、37、16、15。标题套路：模型名 + 「白菜价 / 免排队 / 高清 / 好用」+ 「5折」。闲鱼可写具体折扣，与小红书规则不同。
