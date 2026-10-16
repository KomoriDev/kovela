# Kovela

Kovela 验证爱发电订单，并为小米 Vela 应用签发设备绑定许可证。买家在 AstroBox 的 Kovela 插件里输入订单号；插件向服务端核验后，把手环标识传给服务端。手环确认令牌属于本机后保存，即可离线使用。令牌仍带 Ed25519 签名，但手环侧不再校验（原因、代价与恢复方式见「激活链路的等待时间」）。网页按订单号查询订单信息，并留给以后的登录能力。

线上站点：<https://kovela.komoridevs.icu/>

## 工作区

| 路径 | 作用 |
| --- | --- |
| `apps/web` | Vue 订单查询页 |
| `apps/worker` | Cloudflare Worker、D1 与爱发电接口 |
| `packages/license` | Ed25519 许可证签发、令牌解析，以及手环侧已停用的离线验签 |
| `packages/vela` | 手环激活状态机；只解读令牌，不校验签名 |
| `packages/afdian` | 爱发电订单查询、私信与 Webhook 验签 |
| `plugins/astrobox` | 通用应用激活插件源码 |
| `scripts` | 构建手环激活包、生成图标，以及仅在全新环境创建签发密钥 |

手环应用位于本仓库之外。共享激活代码变更后，在本仓库运行 `pnpm prepare:vela`，再构建对应应用。

`pnpm build:vela` 会生成并构建 `../billiard` 和 `../tank-turmoil`。共享激活代码只在 `packages/vela/src/` 修改，不直接编辑各应用的 `src/activation/index.js`。合成大西瓜换肤已独立到 `../kovela-watermelon`，游戏从其 `wearable/src/` 生成免费通信模块。

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

`.dev.vars` 至少需要爱发电创作者 ID、API Token 和与现有应用公钥匹配的 `LICENSE_SIGNING_SEED`（恢复手环验签时必须沿用同一把密钥，换掉它会让已签发的令牌再也通不过完整校验）。已有签发环境不要运行 `pnpm keys:create`；该命令只用于全新环境，并会在发现已有密钥时拒绝覆盖。

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

网页与 Worker 的商品目录由 `apps/worker/wrangler.jsonc` 中的 `PRODUCTS` 统一提供，网页读取 `/api/config` 展示，无需单独硬编码。合成大西瓜图片自定义使用 `com.komoridev.watermelon` 和爱发电 item `3187fe28c08a11f1805c52540025c377`（<https://afdian.com/item/3187fe28c08a11f1805c52540025c377>）。该配置必须部署 Worker 才会生效；本次服务端商品配置不包含插件或手环产物发布。

更换签发私钥会使已签发的令牌再也通不过完整校验（`pnpm license:issue` 的自检会直接失败），必须同时更新 `packages/vela/src/public-key.js`。手环当前不校验签名，所以换密钥只影响自检，以及将来恢复验签后旧令牌的可用性。

### 管理员签发

访问 `/admin`，验证管理员密钥后可粘贴或上传买家的申请 JSON，也可填写订单号、应用及设备码。确认买家身份后核单并签发，下载许可证 JSON 或复制授权串。页面只在内存中保留访问密钥，刷新或退出后需重新输入；密钥不进入 URL、本地存储或产物。

运行 `pnpm admin:key` 生成独立访问密钥，保存在未跟踪的 `.secrets/admin-key.vars`；已有文件不会被覆盖，已有许可证公钥不变。本地 `.dev.vars` 尚无 `ADMIN_KEY` 时会自动追加。生产环境在 `apps/worker` 目录执行 `pnpm exec wrangler secret put ADMIN_KEY`，输入该文件中的值；随后正常部署网页和 Worker。

管理员接口为 `POST /api/admin/session` 和 `POST /api/admin/licenses`，使用 `Authorization: Bearer <ADMIN_KEY>`。签发仍核实已完成订单和对应商品，复用在线激活的原子设备绑定；同设备重发返回原许可证，不同设备拒绝签发，不提交安装成功回执。

## AstroBox 插件

插件 UI 走 Material Design 3（深色）令牌，配色、圆角、间距与字号集中在 `plugins/astrobox/src/theme.rs`；宿主把插件页面固定在 `#191919` 深色容器里渲染，所以不跟随宿主应用级主题。通用插件只处理应用激活与离线许可证，西瓜换肤 UI 和图片转换器已移出。

右上角服务状态徽标在首次打开时通过 `/api/config` 检查服务连通性与配置，每分钟复查；订单查询和激活期间暂缓探测。网络失败、服务端错误或服务配置未就绪时显示红色「服务异常」，点击可展开/收起原因，恢复后自动清除。业务请求的网络和 5xx 错误也会同步到徽标；订单号错误、设备通信错误不作为服务异常。此探测不主动请求爱发电，爱发电运行故障由实际订单请求反映。切到离线激活后不再探测，也不调用订单、签发或回执 API。

### 构建与上架：只有 Level 4 一份产物

`plugins/astrobox/manifest.json` 就是 Level 4 清单（`wasi_version: 3`、`api_level: 4`，权限含 `notification`、`account.profile`、`os.device-id`），`pnpm build:plugin` 只出这一份产物到 `plugins/astrobox/dist/kovela/`，上架入口（仓库根目录 `index.txt`）列的也是它。账号资料与设备通知都只有 Level 4 才有，所以不再提供 Level 2/3 兼容构建；AstroBox 2.2 以下的宿主装不了这个插件。

- 主界面第一步直接显示「用 AstroBox 账号激活」，无需等待服务检查。插件读宿主已登录账号里已确认的爱发电绑定（`account.get-current`），把账号 ID 交给服务端查购买状态，用户不必去翻订单号。服务检查只更新状态徽标，不控制账号入口。读取账号要弹授权、宿主每次实时查询绑定（单项最多 10 秒），所以插件带 20 秒超时兜底：超时会解锁界面并提示改用订单号激活。
- 宿主安装标识（`os.device-id`，形如 `ab-install-…`，不是硬件序列号、清除应用数据后会变）随账号请求一起发给服务端，只用于限流，读一次即缓存。
- 激活过程用一条实时活动（通知 id 1）在手环上显示四段进度：按相位 `send` 更新（同一 id、`updatable`、递增 `sequence`），失败时改成失败文案，完成后发一条普通通知（id 2）并 `remove` 撤回实时活动。设备不支持小米通知协议、用户没给 `notification` 权限、传输失败、甚至实时活动本身不显示，都不影响激活。
- `focus` 的 `style` 与 `focus-v2` 的 `scene` 是协议原值，官方文档明确没有跨型号枚举、要求用目标设备确认过的取值（上游 proto 里就是裸 `uint32`，宿主原样透传）。确认办法：把 `plugins/astrobox/src/lib.rs` 的 `NOTIFY_PROBE` 改成 `true` 重新构建并本地导入，「更多操作」里会多出「样式自测 focus」「场景自测 focus-v2」两项，连接并选中手环后每点一次把编号 +1 发一条实时活动（同一个通知 id，覆盖更新，不会堆一屏）；手环上有变化就记下那个编号，填进 `plugins/astrobox/src/notify.rs` 的 `FOCUS_STYLE`（改用 focus-v2 则换 `live()` 里的 variant 并在 `probe` 里对齐 `scene`）。确认完把 `NOTIFY_PROBE` 改回 `false` 再上架。

本地打包需要 Rust stable 和 `wasm32-wasip2` 目标：

```bash
rustup target add wasm32-wasip2
pnpm build:plugin
```

产物只有一份：

| 路径 | 用途 |
| --- | --- |
| `plugins/astrobox/dist/kovela/` | **上架用**：AstroBox 2.2.0+（WASI 3 / api_level 4），含 `manifest.json`、`kovela_astrobox.wasm`、`icon.png`、`Kovela.abp` |

目录里的 `.abp` 是给用户本地导入的完整包（不在 `additional_files` 里，商店不会下载它）；其余 `.abp` 仍被 `.gitignore` 排除。

推送插件源码，或手动运行 [`.github/workflows/plugin.yml`](.github/workflows/plugin.yml)，Actions 会执行同一条命令，把产物提交回 `main` 并上传 `.abp`。

### 上架 AstroBox 官方插件源

聚合脚本（[`AstroBox-NG-Plugin-Repo`](https://github.com/AstralSightStudios/AstroBox-NG-Plugin-Repo) 的 `generate-index`）每 4 小时按**匿名 raw URL** 抓一次产物，因此仓库必须是公开的，且产物必须提交进 Git：

- 仓库根目录的 [`index.txt`](index.txt) 列出存放 `manifest.json` 的文件夹（`plugins/astrobox/dist/kovela`）；空行和 `#` 行会被忽略。
- 上架入口写在上游仓库的 `index.txt` 里：`https://raw.githubusercontent.com/KomoriDev/kovela/refs/heads/main/`。
- 发版本时只改 `plugins/astrobox/manifest.json` 的 `version`，推上去等 Action 生效即可。

### 合成大西瓜自定义权益

换肤插件、皮肤资源、图片转换器和免费手环模块位于独立仓库 `../kovela-watermelon`。原商品 `com.komoridev.watermelon` 和爱发电 item `3187fe28c08a11f1805c52540025c377` 保持不变。内置皮肤、图片传输与手环保存均免费；购买只解锁插件内的自定义图片导入。通用 Kovela 插件查询到西瓜订单时提示使用独立换肤插件，不再给手环安装西瓜许可证。

`POST /api/watermelon/entitlement` 接收 `{afdianUserId}`，返回 `{productId, afdianUserId, entitled}`。`purchases.buyer_id` 已保存爱发电用户 ID，查询关联原商品的 `entitlements`，再向爱发电核对有效支付状态；旧设备绑定不影响账号自定义权益。该接口不返回订单详情、handoff、签名许可证或设备信息。

V4 `account.get-current` 提供实时绑定资料，不提供可供后端验证的 token。插件只信任宿主返回的 `linked` 爱发电 ID，每次导入和确认应用都复查；未登录、未绑定、绑定查询失败、账号切换或服务器响应 ID 不符时拒绝导入。此接口是本地付费功能的权益查询，不是对任意 HTTP 调用者的身份认证。若以后需要服务端资源授权，可增加独立爱发电 OAuth。

发布前应用 `0004_buyer_entitlements.sql` 并部署 Worker，再分别发布独立 V4 插件和合成大西瓜 1.2.0；只更新插件无法让旧手环应用免费传输。既有购买记录、商品配置和图片持久文件无需搬迁。

## 订单与私信

已完成的付费订单和零元兑换订单都可以验证，但必须匹配对应应用的爱发电方案或 SKU。爱发电私信会带上订单号，买家在 AstroBox 的 Kovela 插件里输入即可。插件只连接 `https://kovela.komoridevs.icu`；本地调试可在编译插件时设置 `KOVELA_ORIGIN=http://127.0.0.1:8787`。验证成功后的激活回执仍由服务端发送。查询订单时核过的爱发电结论会随会话记进 `sessions.verified_at`（`0005_session_verified.sql`），签发（`/api/activate`）在 120 秒内直接复用它，超过窗口才重新核对付款状态；同一次激活不必为同一个结论付两次爱发电往返。同一订单的每个应用只绑定第一台设备。网页可按订单号查询订单包含的应用与绑定状态。

### 离线激活

插件支持网络异常时的离线激活，适用于买家无法连接 Kovela 服务的网络。用户端只通过蓝牙与手环通信；创作者在可用网络上核单并签发，使用现有 Worker/D1 的同一份设备绑定记录，不另建台账。手环沿用现有 `KV1` 令牌的结构与存储流程，不需要更换密钥或格式。

剪贴板操作分别使用宿主的 `clipboard.read` 和 `clipboard.write` 权限，首次操作时按系统提示授权。选择许可证文件走 `dialog.pick_file` 的一次性读取句柄，取消选择保留原许可证输入。

1. 买家在服务异常询问中选择「离线激活」，或连续点击服务状态徽标 5 次进入。输入订单号并选择应用，连接手环后点「获取设备码」。设备码来自该手环应用的握手，不是蓝牙 MAC；在线流程已取得的设备码会保留。
2. 点「复制申请」，将申请 JSON 通过爱发电私信等渠道发给创作者。创作者仍须确认发起者是订单买家；申请里的订单号不是身份凭证。
3. 创作者在 `/admin` 验证密钥，导入申请、确认买家身份并签发下载 `license.json`。也可将申请保存为 `request.json`，在仓库运行：

   ```bash
   pnpm license:issue --request request.json --output license.json
   ```

   命令通过现有 `/api/config`、`/api/orders/lookup`、`/api/activate` 核实当前付款状态、商品和设备绑定；默认访问线上域名。可用 `--origin https://你的代理域名` 指定可信代理；本地验证允许回环 HTTP。已有输出文件会被拒绝覆盖；同一设备重发可指定新的输出文件名，服务端返回原许可证。不同设备、未完成订单、错误商品或签名异常不会导出许可证。
4. 创作者将 `license.json` 发给买家。买家点「选择文件」导入，或粘贴整个文件内容/原始 `KV1` 授权串，点「导入并激活」。手环比对令牌里的应用与设备指纹，确认属于本机后保存并返回回执，插件显示离线激活完成。

许可证文件不包含会话、回执令牌或签名私钥。离线导入不提交服务器回执，因此网页保留「已签发」及设备绑定，不会冒充已经确认安装；也不会发送服务端激活成功私信。已签发的永久离线许可证不支持实时退款撤销。

离线产品目录目前包含口袋台球、坦克动荡和合成大西瓜图片自定义；新增商品时同步维护 `plugins/astrobox/src/offline.rs`。生成的申请和许可证含订单/设备信息，不应提交到公共仓库。

## 激活链路的等待时间

一次激活要跨越插件、Worker 与手环三段，任何一段的等待都会算在用户头上。当前实现按「先出界面、再发请求」和「不让已知结论重复外呼」组织：

- 插件的点击处理器只改状态并渲染，网络与主机调用交给定时事件（`LOOKUP_PAYLOAD`、`ACTIVATE_PAYLOAD`）。宿主在导出返回后才绘制，就地查询订单或打开手环应用会让画面停在点击前的样子一到数秒。
- 手环在结论未出时收到 hello 会先记账，读链一出结论立刻回执，不让插件白等一个 2 秒重发轮次；`retry()`（激活页 onShow 与「重新连接」）在途超过 1.5 秒就放弃读链重来，健康但慢的读取不动。
- 手环的指纹读取与机型读取串行：`getDeviceId`/`getInfo` 与存储请求并发会把真机系统服务挤到约半分钟不响应。机型只用于回执标注，回执先发，读不到就退回宿主连接名。激活页也把 `device.getInfo` 排在授权结论之后，并用默认屏参先立布局。
- 激活页带 2.5 秒一节、共四节的看门狗兜底：app 上下文的定时器在页面可见时不跑，状态机自己的 8 秒看门狗不会响，存储回调被丢时只有页面能驱动重读。
- 安装包写入的等待窗口是 4 轮 × 12 秒。手环落盘前要读指纹、写存储，叠加系统服务拥堵，窗口太窄会把已经在写入的激活误判成超时。
- 手环回 `NOT_READY`（指纹未就绪或上一条安装包正在落盘）只表示还没轮到：插件继续等下一轮重发，不当作失败上报，也不给买家发失败私信。
- 签发复用查询订单时的爱发电结论（见上文），同一次激活只付一次爱发电往返。

### 手环侧不做签名校验

激活判定只解读 `KV1` 令牌：结构、产品与设备指纹（`packages/license` 的 `decodeLicense`）。**代价要说清楚**：任何能向手环发 interconnect 消息的人（改过的插件、自写插件）都能推送一份字段合法但未付费的令牌，手环会照单收下并激活——付费墙不再由设备端强制。此前这道判定能挡住"手打一段令牌"和"改本地记录"这类做法，只挡不住"重打包应用再侧载"；现在前者也放开了。

服务端仍用 `LICENSE_SIGNING_SEED` 签发带 Ed25519 签名的令牌，`pnpm license:issue`、Worker 测试与 `packages/license` 的 `verifyLicense` 继续做完整校验。因此**恢复验签只需两步**：把 `packages/vela/src/index.js` 里的 `decodeLicense` 换回 `verifyLicense`（并把公钥参数接回 `scripts/prepare-vela.mjs` 与 `createActivation`），然后重新发布手环应用；不需要轮换密钥或更换令牌格式。想在设备上重新加一道门槛，可先确认 `@system.crypto` 的 RSA-SHA256 验签在本机型可用（原生秒级），再决定是否改用该原语。

手环侧改动只需改 `packages/vela/src/index.js`，运行 `pnpm prepare:vela` 会重新生成 `../billiard`、`../tank-turmoil` 的 `src/activation/index.js`。`packages/vela/src/public-key.js` 已不再进入手环产物，只服务于 `pnpm license:issue` 的自检与将来恢复验签。

### 账号维度激活

Level 4 插件另有两条接口：`POST /api/account/products` 用宿主确认的 `afdianUserId` 列出该账号已完成的商品与绑定状态，`POST /api/account/activate` 用同一账号加设备码签发许可证。两者都不返回订单详情，服务端每次重新用爱发电现场复核付款状态与商品匹配，签发后回执、状态查询与私信通知都沿用在线激活那条路径（`sessions` 记录把这次核对标成 `verified_at`）。同一订单仍然只绑定第一台设备，所以账号买过多份时可以继续用下一份订单。

信任边界要说清楚：`afdianUserId` 由插件提供，和 `/api/watermelon/entitlement` 一样，这不是对任意 HTTP 调用者的身份认证——知道某个买家的爱发电用户 ID，就能用该账号尚未绑定的订单激活一台设备。接口为此按 IP、按账号、按宿主安装标识限流，并把绑定限制在每订单一台；要彻底关掉这条路，删掉这两条接口与插件里的「用 AstroBox 账号激活」按钮即可。

## 检查

```bash
pnpm typecheck
pnpm test
```

不要提交 `.dev.vars`、`.secrets/`、`.env` 或签名私钥。仓库只保留许可证公钥。
