# 素材参考展示 API（2026-11-01）

为 Hanabi 添加素材展示端点，让前端能看到思敏勾选的好帖和闲鱼高想要帖子。

## 数据准备

已完成：
- `data/reference-posts.json`：16 条 XHS good 帖子 + 14 条闲鱼 top 帖子
- 图片已复制到 `~/Library/Application Support/Content Alchemy/uploads/reference-xhs/` 和 `reference-xianyu/`
- 图片命名：`{postId}.jpg`

## 需要添加的 API

在 Hanabi `app.js` 中添加：

```javascript
app.get('/api/reference-posts', async (req, res) => {
  try {
    const data = JSON.parse(await fs.readFile(join(contentOpsRoot, 'data/reference-posts.json'), 'utf8'));
    res.json({
      xhs: data.xhs_good_posts.map(post => ({
        id: post.id,
        title: post.title,
        likes: post.likes,
        imageUrl: `/api/uploads/reference-xhs/${post.id}.jpg`,
        url: post.url
      })),
      xianyu: data.xianyu_top_posts.map(post => ({
        id: post.id,
        title: post.title,
        wants: post.wants,
        imageUrl: `/api/uploads/reference-xianyu/${post.id}.jpg`,
        url: post.url
      }))
    });
  } catch (error) {
    res.status(500).json({ error: '读取素材失败' });
  }
});
```

## 前端展示

在 Hanabi 素材库（archive 视图）添加「参考帖」过滤器：
- 小红书好帖（16 条）
- 闲鱼高想要（14 条）

每张卡片显示：
- 缩略图（点击放大）
- 标题
- 互动数（点赞 / 想要）
- 打开原帖链接

## 实现位置

Hanabi 代码在 `~/Documents/ChatGPT/【探索】/content-alchemy/`：
- 后端路由：`app.js`（在现有 `/api/content-ops/` 路由附近添加）
- 前端 UI：`index.html`（资料库区域）
- 前端逻辑：`app.js`（archive 视图）

## 使用

用户在 Hanabi 资料库选择「参考帖」分类，可以看到所有好帖，点击查看大图和原帖链接。
