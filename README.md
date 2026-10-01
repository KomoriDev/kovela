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
- `ADMIN_KEY`：独立的 32 字节随机访问密钥，仅用于 `/admin`，不能使用许可证签名私钥

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

### 管理员签发

访问 `/admin`，验证管理员密钥后可粘贴或上传买家的申请 JSON，也可填写订单号、应用及设备码。确认买家身份后核单并签发，下载许可证 JSON 或复制授权串。页面只在内存中保留访问密钥，刷新或退出后需重新输入；密钥不进入 URL、本地存储或产物。

运行 `pnpm admin:key` 生成独立访问密钥，保存在未跟踪的 `.secrets/admin-key.vars`；已有文件不会被覆盖，已有许可证公钥不变。本地 `.dev.vars` 尚无 `ADMIN_KEY` 时会自动追加。生产环境在 `apps/worker` 目录执行 `pnpm exec wrangler secret put ADMIN_KEY`，输入该文件中的值；随后正常部署网页和 Worker。

管理员接口为 `POST /api/admin/session` 和 `POST /api/admin/licenses`，使用 `Authorization: Bearer <ADMIN_KEY>`。签发仍核实已完成订单和对应商品，复用在线激活的原子设备绑定；同设备重发返回原许可证，不同设备拒绝签发，不提交安装成功回执。

## AstroBox 插件

插件 UI 走 Material Design 3（深色）令牌，配色、圆角、间距与字号集中在 `plugins/astrobox/src/theme.rs`；宿主把插件页面固定在 `#191919` 深色容器里渲染，所以不跟随宿主应用级主题。

右上角服务状态徽标在首次打开时通过 `/api/config` 检查服务连通性与配置，每分钟复查；订单查询和激活期间暂缓探测。网络失败、服务端错误或服务配置未就绪时显示红色「服务异常」，点击可展开/收起原因，恢复后自动清除。业务请求的网络和 5xx 错误也会同步到徽标；订单号错误、设备通信错误不作为服务异常。此探测不主动请求爱发电，爱发电运行故障由实际订单请求反映。切到离线激活后不再探测，也不调用订单、签发或回执 API。

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

### 离线激活

插件支持网络异常时的离线激活，适用于买家无法连接 Kovela 服务的网络。用户端只通过蓝牙与手环通信；创作者在可用网络上核单并签发，使用现有 Worker/D1 的同一份设备绑定记录，不另建台账。手环复用现有 `KV1` 验签和存储流程，无需重新发布应用或更换公钥。

剪贴板操作分别使用宿主的 `clipboard.read` 和 `clipboard.write` 权限，首次操作时按系统提示授权。API3 文件选择保留一次性读取句柄，通过短定时回调接收结果，不占用单次回调的 30 秒时限；取消选择保留原许可证输入。

1. 买家在服务异常询问中选择「离线激活」，或连续点击服务状态徽标 5 次进入。输入订单号并选择应用，连接手环后点「获取设备码」。设备码来自该手环应用的握手，不是蓝牙 MAC；在线流程已取得的设备码会保留。
2. 点「复制申请」，将申请 JSON 通过爱发电私信等渠道发给创作者。创作者仍须确认发起者是订单买家；申请里的订单号不是身份凭证。
3. 创作者在 `/admin` 验证密钥，导入申请、确认买家身份并签发下载 `license.json`。也可将申请保存为 `request.json`，在仓库运行：

   ```bash
   pnpm license:issue --request request.json --output license.json
   ```

   命令通过现有 `/api/config`、`/api/orders/lookup`、`/api/activate` 核实当前付款状态、商品和设备绑定；默认访问线上域名。可用 `--origin https://你的代理域名` 指定可信代理；本地验证允许回环 HTTP。已有输出文件会被拒绝覆盖；同一设备重发可指定新的输出文件名，服务端返回原许可证。不同设备、未完成订单、错误商品或签名异常不会导出许可证。
4. 创作者将 `license.json` 发给买家。买家点「选择文件」导入，或粘贴整个文件内容/原始 `KV1` 授权串，点「导入并激活」。手环验证签名、应用及设备指纹，保存成功并返回回执后，插件显示离线激活完成。

许可证文件不包含会话、回执令牌或签名私钥。离线导入不提交服务器回执，因此网页保留「已签发」及设备绑定，不会冒充已经确认安装；也不会发送服务端激活成功私信。已签发的永久离线许可证不支持实时退款撤销。

离线产品目录目前包含口袋台球和坦克动荡；新增商品时同步维护 `plugins/astrobox/src/offline.rs`。生成的申请和许可证含订单/设备信息，不应提交到公共仓库。

## 检查

```bash
pnpm typecheck
pnpm test
```

不要提交 `.dev.vars`、`.secrets/`、`.env` 或签名私钥。仓库只保留许可证公钥。
