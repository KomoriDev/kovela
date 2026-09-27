# Kovela

Kovela 验证爱发电订单，并为小米 Vela 应用签发设备绑定许可证。买家在 AstroBox 的 Kovela 插件里输入订单号；插件向服务端核验后，把手环标识传给服务端。手环用内置公钥验签并保存后，即可离线使用。网页按订单号查询订单信息，并留给以后的登录能力。

线上站点：<https://kovela.komoridevs.icu/>

## 工作区

| 路径 | 作用 |
| --- | --- |
| `apps/web` | Vue 订单查询页 |
| `apps/worker` | Cloudflare Worker、D1 与爱发电接口 |
| `packages/license` | Ed25519 许可证签发与离线验签 |
| `packages/vela` | 手环激活状态机；只包含公钥 |
| `packages/afdian` | 爱发电订单查询、私信与 Webhook 验签 |
| `plugins/astrobox` | AstroBox v2 插件源码 |
| `scripts` | 构建手环激活包、生成图标，以及仅在全新环境创建签发密钥 |

手环应用位于本仓库之外。共享激活代码变更后，在本仓库运行 `pnpm prepare:vela`，再构建对应应用。

## 本地开发

需要 Node.js 22、pnpm 10.28.2。

```bash
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @kovela/worker db:local
pnpm dev:worker
pnpm dev
```

网页默认在 <http://127.0.0.1:5173/>，并把 `/api` 代理到 Worker 的 `8787` 端口。

`.dev.vars` 至少需要爱发电创作者 ID、API Token 和与现有应用公钥匹配的 `LICENSE_SIGNING_SEED`。已有签发环境不要运行 `pnpm keys:create`；该命令只用于全新环境，并会在发现已有密钥时拒绝覆盖。

## 生产部署

公开配置在 `apps/worker/wrangler.jsonc`。以下值只放在 Cloudflare Secrets，不进入 Git：

- `AFDIAN_TOKEN`
- `LICENSE_SIGNING_SEED`
- `WEBHOOK_TOKEN`
- `TURNSTILE_SECRET_KEY`

部署前先应用远程迁移：

```bash
pnpm --filter @kovela/web build
pnpm --filter @kovela/worker db:remote
pnpm --filter @kovela/worker deploy
```

`main` 分支推送后，[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 会执行类型检查、测试、数据库迁移和 Worker 部署。仓库需要这两个 Actions secrets：

- `CLOUDFLARE_API_TOKEN`：包含 Workers 脚本、路由和 D1 写权限
- `CLOUDFLARE_ACCOUNT_ID`

更换签发私钥会使已安装应用无法验证旧许可证，必须同时更新 `packages/vela/src/public-key.js` 并重新发布手环应用。

## AstroBox 插件

插件 UI 走 Material Design 3（深色）令牌，配色、圆角、间距与字号集中在 `plugins/astrobox/src/theme.rs`；宿主把插件页面固定在 `#191919` 深色容器里渲染，所以不跟随宿主应用级主题。

本地打包需要 Rust stable 和 `wasm32-wasip2` 目标：

```bash
rustup target add wasm32-wasip2
pnpm build:plugin
```

产物是两套：

| 路径 | 用途 |
| --- | --- |
| `plugins/astrobox/dist/kovela/` | **上架用**：AstroBox 2.0.0+（wasi 2 / api_level 3），含 `manifest.json`、`kovela_astrobox.wasm`、`icon.png`、`Kovela.abp` |
| `plugins/astrobox/dist/kovela-v4/` | AstroBox 2.2.0+（wasi 3 / api_level 4），2.2.0 未发布前不上架 |

每个目录里的 `.abp` 是给用户本地导入的完整包（不在 `additional_files` 里，商店不会下载它）；其余 `.abp` 仍被 `.gitignore` 排除。

推送插件源码，或手动运行 [`.github/workflows/plugin.yml`](.github/workflows/plugin.yml)，Actions 会执行同一条命令，把两套产物提交回 `main` 并上传 `.abp`。

### 上架 AstroBox 官方插件源

聚合脚本（[`AstroBox-NG-Plugin-Repo`](https://github.com/AstralSightStudios/AstroBox-NG-Plugin-Repo) 的 `generate-index`）每 4 小时按**匿名 raw URL** 抓一次产物，因此仓库必须是公开的，且产物必须提交进 Git：

- 仓库根目录的 [`index.txt`](index.txt) 列出存放 `manifest.json` 的文件夹（当前是 `plugins/astrobox/dist/kovela`）；空行和 `#` 行会被忽略，所以 v4 那行先注释着，2.2.0 发布后再放开。
- 上架入口写在上游仓库的 `index.txt` 里：`https://raw.githubusercontent.com/KomoriDev/kovela/refs/heads/main/`。
- 发版本时只改 `plugins/astrobox/manifest.json` 的 `version`（api4 那份由 `package.py` 覆盖 `wasi_version`/`api_level`），推上去等 Action 生效即可。

## 订单与私信

已完成的付费订单和零元兑换订单都可以验证，但必须匹配对应应用的爱发电方案或 SKU。爱发电私信会带上订单号，买家在 AstroBox 的 Kovela 插件里输入即可。插件只连接 `https://kovela.komoridevs.icu`；本地调试可在编译插件时设置 `KOVELA_ORIGIN=http://127.0.0.1:8787`。验证成功后的激活回执仍由服务端发送。同一订单的每个应用只绑定第一台设备。网页可按订单号查询订单包含的应用与绑定状态。

## 检查

```bash
pnpm typecheck
pnpm test
```

不要提交 `.dev.vars`、`.secrets/`、`.env` 或签名私钥。仓库只保留许可证公钥。
