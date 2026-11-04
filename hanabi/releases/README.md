# Hanabi 换机说明

不需要 ZIP。直接克隆仓库：

```bash
cd ~/Desktop && git clone https://github.com/gfdtgfgfgd-coder/content-ops.git
cd content-ops && ./start.command
```

`start.command`（支持访达直接双击运行）会检查 Node/Python 版本、自动装好 Python 虚拟环境与依赖、复制 `gateway.env` 模板、装 Hanabi npm 依赖、后台启动服务并打开 `http://127.0.0.1:6187`。

配置公司网关：把 `scratch/gateway.env.example` 复制为 `scratch/gateway.env`，填入公司 Key：

```
CONTENT_OPS_API_KEY=你的 key
CONTENT_OPS_BASE_URL=https://duoyuanx.com/v1
```
