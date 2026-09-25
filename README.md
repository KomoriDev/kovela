# Kovela

Kovela 验证爱发电订单，并为小米 Vela 应用签发设备绑定许可证。买家在 AstroBox 的 Kovela 插件里输入订单号；插件向服务端核验后，把手环标识传给服务端。手环用内置公钥验签并保存后，即可离线使用。网页仍可验证订单，并留给以后的登录能力。

线上站点：<https://kovela.komoridevs.icu/>

## 工作区

| 路径 | 作用 |
| --- | --- |
| `apps/web` | Vue 订单验证页 |
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

本地打包需要 Rust stable 和 `wasm32-wasip2` 目标：

```bash
rustup target add wasm32-wasip2
pnpm build:plugin
```

产物是 `plugins/astrobox/dist/Kovela.abp`。推送插件源码，或手动运行 [`.github/workflows/plugin.yml`](.github/workflows/plugin.yml)，Actions 会执行同一条命令并上传这个包。

## 订单与私信

已完成的付费订单和零元兑换订单都可以验证，但必须匹配对应应用的爱发电方案或 SKU。爱发电私信会带上订单号，买家在 AstroBox 的 Kovela 插件里输入即可。插件只连接 `https://kovela.komoridevs.icu`；本地调试可在编译插件时设置 `KOVELA_ORIGIN=http://127.0.0.1:8787`。验证成功后的激活回执仍由服务端发送。同一订单的每个应用只绑定第一台设备。网页上的验证入口可以继续用，但不是必经步骤。

## 检查

```bash
pnpm typecheck
pnpm test
```

不要提交 `.dev.vars`、`.secrets/`、`.env` 或签名私钥。仓库只保留许可证公钥。
