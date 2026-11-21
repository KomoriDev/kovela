# Kovela

Kovela 是为小米 Vela 穿戴设备打造的小游戏与授权服务，由三部分组成：

- **网站**：游戏展示页。每款游戏都能一键跳转 AstroBox 安装；付费内容跳转爱发电支持。
- **服务端**：Cloudflare Worker，负责核验爱发电订单、绑定设备、签发许可证、发送私信。
- **AstroBox 插件**：买家在插件里用 AstroBox 账号或订单号激活，许可证经蓝牙写入手环。保存成功后，手环离线可用。

线上站点：<https://kovela.komoridevs.icu/> · 官方 QQ 群：<https://qm.qq.com/q/WRPKz0HsQQ>

## 工作原理

1. 买家在网站点「在 AstroBox 获取」，在 AstroBox 里把游戏装到手环。免费游戏到这一步就能玩。
2. 想解锁付费内容，就在爱发电支持。订单完成后，爱发电 Webhook 通知服务端，服务端记下购买，并私信订单号和激活引导。
3. 买家打开 AstroBox 的 Kovela 插件，用 AstroBox 账号（已绑定爱发电）或订单号验证，再选择手环。
4. 服务端向爱发电复核付款，把订单中的应用绑定到这台手环，用 Ed25519 私钥签发 `KV1` 许可证令牌。
5. 插件通过蓝牙把令牌写入手环。手环确认令牌属于本机后保存并回执，服务端再私信激活结果。

服务端连不上时，有离线激活兜底，见[离线激活](#离线激活)。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `apps/web` | 网站：游戏展示（`/`、`/about`）与管理员签发（`/admin`） |
| `apps/worker` | Cloudflare Worker、D1 数据库、定时任务 |
| `packages/afdian` | 爱发电订单查询、私信发送、Webhook 验签 |
| `packages/license` | Ed25519 许可证签发、令牌解析与完整验签 |
| `packages/vela` | 手环激活状态机；只解读令牌，不校验签名 |
| `packages/client` | Worker 接口的 TypeScript 客户端（目前只有 `/admin` 使用） |
| `packages/protocol` | Worker、`packages/client` 与 `/admin` 共用的接口类型 |
| `plugins/astrobox` | AstroBox 通用激活插件（Rust → WASI） |
| `scripts` | 品牌图标、手环激活代码生成、密钥生成、离线签发 |
| `assets/kovela.png` | 品牌图标源文件 |

手环应用都在本仓库之外，与本仓库同级：

| 仓库 | 说明 |
| --- | --- |
| `../angrybirds` | 愤怒的小鸟。第一章免费，激活后解锁全部 40 关 |
| `../billiard` | 口袋台球，需激活 |
| `../tank-turmoil` | 坦克动荡，需激活 |
| `../landlord` | 斗地主，按型号出售：普通版、联机版，见[型号](#型号付费档位) |
| `../projectile` | 抛，完全免费，不接入激活 |
| `../kovela-watermelon` | 合成大西瓜换肤插件、皮肤资源、图片转换器，以及游戏用的免费通信模块 |

## 本地开发

需要 Node.js 22 和 pnpm 10.28.2。

```bash
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter @kovela/worker db:local   # 应用本地 D1 迁移
pnpm dev:worker                          # Worker：http://127.0.0.1:8787
pnpm dev                                 # 网站：http://127.0.0.1:5173
```

网站开发服务器把 `/api` 代理到 `8787`（可用 `KOVELA_WORKER_ORIGIN` 覆盖）。展示页不调用接口，不启动 Worker 也能开发；只有 `/admin` 和插件联调需要 Worker。

`.dev.vars` 至少要填以下几项：

- 爱发电创作者 ID（`AFDIAN_USER_ID`）和 API Token（`AFDIAN_TOKEN`）。
- `LICENSE_SIGNING_SEED`：从未跟踪的 `.secrets/worker-license.vars` 复制，必须与现有应用公钥匹配。

各字段的说明见 `apps/worker/.dev.vars.example`。

> **不要重新生成签名密钥。** `pnpm keys:create` 只用于全新环境，发现已有密钥时会拒绝覆盖。换掉 `LICENSE_SIGNING_SEED` 会让已签发的令牌再也通不过完整校验。

## 网站（`apps/web`）

### 页面

| 路径 | 内容 |
| --- | --- |
| `/` 总览 | 首屏、四款游戏介绍、实机画面、三步上手 |
| `/about` 关于 | Kovela 是什么、四条原则、激活的四个环节、常见问题 |
| `/admin` | 管理员签发，见[管理员签发](#管理员签发) |

`main.ts` 按路径分流。`/admin` 单独加载，用浅色后台样式 `styles/admin.css`，也是唯一启动 Kovela 客户端、调用接口的页面。展示页是纯静态的：不请求 `/api`，订单查询直接跳转爱发电订单页 <https://afdian.com/dashboard/order>。

Worker 以 SPA 模式托管 `apps/web/dist`（`not_found_handling: single-page-application`），所以直接访问 `/about` 也能打开。

### 技术与动效

- Vue 3 + vue-router。动效用 GSAP（ScrollTrigger），平滑滚动用 Lenis，二者通过 GSAP ticker 同步。
- 动效相关代码集中在 `src/motion/`：`useGsap` 把动画限定在组件内，卸载时自动清理；`reveal.ts` 提供滚动入场和底色渐变；`directives.ts` 提供磁吸按钮和聚光效果。
- 页面入场要等开场加载或换页幕布结束才播放，由 `stores/ui.ts` 协调。
- 系统开启「减少动态效果」时，动效、平滑滚动和开场加载都会关闭。
- 浅色主题。颜色、字体、间距都定义在 `src/styles/base.css` 的 CSS 变量里，整体调色只改这里。

### 内容与素材

游戏数据在 `src/data/games.ts`，常见问题在 `src/data/faq.ts`。

- **主按钮**：链接由 `astroboxUrl(productId)` 生成，格式为 `https://abox.run/open?source=resv2&id=<包名>&provider=OfficialV2`。
- **次按钮**：游戏有 `purchase` 时出现，跳转爱发电；不填即视为完全免费，只显示 AstroBox 按钮。
- **素材**：放在 `public/games/<id>/`。

| 素材 | 规格 |
| --- | --- |
| `cover.png` | 1200×800 商店封面 |
| `logo.png` | 方形图标 |
| 截图 | 手环原始分辨率：竖屏 `frame: "port"` 用 212×520，横屏 `frame: "land"` 用 520×212 |

新增一款游戏：

1. 把素材放进 `public/games/<id>/`，在 `games.ts` 里加一项。
2. 首屏统计会自动跟着游戏数量变，但「四款游戏」标题和滚动文字带要手动改（`pages/OverviewPage.vue`）。
3. 如果需要激活，另外按[新增付费商品](#新增付费商品)更新服务端和插件。网站不读取 Worker 的商品配置，两边要分别维护。

站点图标由 `pnpm brand:build` 从 `assets/kovela.png` 生成：网站 Logo、favicon、apple-touch-icon 和插件图标。

## 服务端（`apps/worker`）

### 配置与密钥

公开配置在 `apps/worker/wrangler.jsonc`：

- `PUBLIC_ORIGIN`
- `PRODUCTS`：可激活商品目录
- `AFDIAN_USER_ID`
- `TURNSTILE_SITE_KEY`
- `DEV_MODE`

以下值只放在 Cloudflare Secrets，不进 Git：

| Secret | 说明 |
| --- | --- |
| `AFDIAN_TOKEN` | 爱发电 API Token |
| `LICENSE_SIGNING_SEED` | 许可证签名私钥 |
| `WEBHOOK_TOKEN` | 爱发电 Webhook 校验 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile |
| `ADMIN_KEY` | `/admin` 专用的 32 字节随机密钥，不能与签名私钥相同 |

### 部署

推送到 `main` 后，[`deploy.yml`](.github/workflows/deploy.yml) 会依次执行：类型检查、测试、生成品牌图标、构建网站、应用远程 D1 迁移、部署 Worker。仓库需要两个 Actions secret：

- `CLOUDFLARE_API_TOKEN`：需有 Workers 脚本、路由和 D1 写权限
- `CLOUDFLARE_ACCOUNT_ID`

手动部署时，先迁移、再部署：

```bash
pnpm brand:build
pnpm --filter @kovela/web build
pnpm --filter @kovela/worker db:remote
pnpm --filter @kovela/worker deploy
```

### 接口

| 接口 | 调用方 | 作用 |
| --- | --- | --- |
| `GET /api/config` | 插件、`/admin`、`license:issue` | 商品目录与服务状态 |
| `POST /api/orders/lookup` | 插件、`license:issue` | 按订单号列出应用与绑定状态 |
| `POST /api/activate` | 插件、`license:issue` | 绑定设备并签发许可证 |
| `POST /api/activation/report` | 插件 | 手环保存后的安装回执 |
| `POST /api/activation/status` | 插件 | 查询激活状态 |
| `POST /api/account/products` | 插件 | 按爱发电账号列出已购商品 |
| `POST /api/account/activate` | 插件 | 按爱发电账号签发 |
| `POST /api/watermelon/entitlement` | 合成大西瓜换肤插件 | 查询自定义图片权益 |
| `POST /api/webhooks/afdian` | 爱发电 | 订单通知 |
| `POST /api/admin/session` | `/admin` | 校验管理员密钥 |
| `POST /api/admin/licenses` | `/admin` | 管理员签发 |
| `POST /api/orders/verify` | 当前无客户端调用 | 核单；非本地请求要求 Turnstile 令牌 |

### 订单规则

- 已完成的付费订单和零元兑换订单都可以激活，但必须匹配对应应用的爱发电方案或 SKU。
- 同一订单里的每个应用只绑定第一台设备。同一设备可以重复激活、重新传输许可证；换设备会被拒绝。
- 查询订单时得到的爱发电核验结论会记进 `sessions.verified_at`。签发（`/api/activate`）在 120 秒内直接复用这个结论，超时才重新核对付款状态，这样一次激活只需请求一次爱发电。
- 插件只连接 `https://kovela.komoridevs.icu`。本地调试时，编译插件前设置 `KOVELA_ORIGIN=http://127.0.0.1:8787`。

### 定时任务

触发器在 `wrangler.jsonc`，`src/index.ts` 根据 `event.cron` 区分：

- `* * * * *`：私信重试与过期清理。改这条表达式时，要同步改 `OUTBOX_CRON`。
- `*/15 * * * *`：补单，见下节。

### Webhook 丢单与补单

爱发电文档写明「服务器异常时不保证及时推送」。丢一单不只是少一条私信：`purchases` 里没有记录，账号激活就看不到这个商品，买家只剩手里的订单号。

所以服务端每 15 分钟主动扫一遍爱发电订单列表（`query-order`，按创建时间倒序）：

- 把已付款、命中商品方案、但本地没有记录的订单补录进来。
- 补录和私信走 Webhook 同一条路径（`deliverPurchaseGuide`），所以补单和 Webhook 谁先到、重复推送都安全：`purchases` 和 `entitlements` 幂等写入，私信 `outbox` 的主键是 `guide:<订单号>`，先到先得。
- 每轮最多看最新两页，翻到一页里没有待补订单就停。单轮最多补 20 单（私信有频率限制），剩下的下一轮接着补。部署后的第一轮也会补回窗口内此前漏掉的订单。
- 未付款的订单本轮跳过，成交后由之后的扫描补上。

### 私信限制与投递诊断

爱发电会以 `ec 400001` 拒收含尖括号（`<`、`>`）或控制字符的私信。2026-11 起平台开始执行这条规则，当时的私信文案用 `>` 做引用，整批私信因此静默失败了三天。现在的处理：

- 文案改用 `·`。
- `AfdianService.sendMessage` 发送前会兜底清除尖括号和控制字符（保留换行），队列里的旧文案也能正常发出。
- 仍然失败时，错误码和爱发电原话写进 `outbox.last_error`。

补单每次运行记在 `reconcile_runs`（单行表，`id=1`）：扫描时刻、翻了几页、看到几单、补了几单、失败原因。怀疑补单没跑或私信没发时，先查 `reconcile_runs` 和 `outbox.last_error`。

### 新增付费商品

1. 在 `wrangler.jsonc` 的 `PRODUCTS` 里加商品：应用包名、名称、爱发电链接，以及方案 ID 或 SKU ID。部署 Worker 后才生效。
2. 同一应用按档位卖（一件爱发电商品、多个型号）时，再配 `editions`，见[型号](#型号付费档位)；手环应用读激活快照的 `edition` 决定解锁内容。
3. 离线激活的商品目录写在 `plugins/astrobox/src/offline.rs` 里，需同步更新，并给插件 `manifest.json` 升版本。
4. 在 `scripts/prepare-vela.mjs` 的默认目标里加上手环应用（`package.json` 的 `build:vela` 也加上），生成激活代码。
5. 有新迁移（`apps/worker/migrations`）时，先 `db:remote` 再部署。
6. 在网站 `apps/web/src/data/games.ts` 里给游戏加 `purchase`。

### 型号（付费档位）

一款应用可以在爱发电上作为**一件商品、多个型号（SKU）**出售，例如斗地主：

| 爱发电型号 | 价格 | 签发的型号 |
| --- | --- | --- |
| 普通版 | ¥3 | `standard` |
| 联机版 | ¥6 | `online` |
| 普通版升级联机版 | ¥3 | `online`（升级，只能装到已激活普通版的设备上） |

`productId` 仍等于应用包名（插件用它做 interconnect 目标和 `open_app`），所以档位不是不同商品：型号写在签名许可证载荷的可选字段 `edition` 里。没有配置 `editions` 的商品一切照旧，许可证里没有这个字段。

配置写在商品上，`editions` 按档位**从低到高**排列：

```jsonc
{
  "productId": "com.komoridev.landlord",
  "productName": "斗地主",
  "purchaseUrl": "https://afdian.com/item/a9dc39f0e08511f1bddc52540025c377",
  "planIds": ["a9dc39f0e08511f1bddc52540025c377"],
  "skuIds": [],
  "editions": [
    { "id": "standard", "name": "普通版", "skuIds": [], "skuNames": ["普通版"] },
    { "id": "online", "name": "联机版", "skuIds": [], "skuNames": ["联机版"],
      "upgradeSkuIds": [], "upgradeSkuNames": ["普通版升级联机版"] }
  ]
}
```

- **校验**：`id` 符合 `/^[a-z][a-z0-9-]{0,31}$/` 且不重复；`name` 非空、不超过 20 字（「商品名（型号名）」总长不超过 80 字）；四个 SKU 数组都可省略，ID 与方案 ID 同规则，名称非空、不超过 40 字；每个型号至少有一个 SKU；第一个型号不能有升级 SKU。不合规时整个商品目录报 `NOT_CONFIGURED`。
- **SKU 匹配**：订单 `sku_detail` 里数量大于 0 的条目，`sku_id` 在 `skuIds` 里，或 `name`（去首尾空白）与 `skuNames` 中某项全等，即命中。按名称匹配是因为创作者不能购买自己的商品，拿不到 `sku_id`。**在爱发电上改型号名称会让名称匹配失效**，从真实订单里拿到 `sku_id` 后填进 `skuIds` / `upgradeSkuIds` 更稳。
- **订单型号**：配了 `editions` 的商品，订单必须命中某个型号的 SKU 才算买了它。型号取命中的最高档位；最高档位只经由升级 SKU 命中时是升级授权（同一单里还买了更低档位的普通 SKU 时，基础就在这单里，按普通授权处理）。
- **Webhook 兜底**：推送签名不覆盖 `sku_detail`，所以型号商品和 SKU 商品一样，`query-order` 查到订单后才落库。
- **展示名**：`entitlements.product_name`、订单查询、账号商品列表、签发结果和私信里的商品名都带型号，如「斗地主（联机版）」。升级订单的购买私信会提示「请在已激活普通版的同一台手环上激活」。
- **存储**：迁移 `0007_editions.sql` 给 `entitlements` 加了 `edition`（可空）和 `upgrade`（0/1）。只在还没签发时随订单刷新：已签发的令牌里写死了型号。

签发规则（订单号激活、账号激活、管理员签发、`license:issue` 都走同一条路径）：

- **升级**：升级授权首次绑定时，这台设备必须已绑定同一应用更低型号的授权，且那份授权的订单已付款（或是创作者记录）。否则 409 `UPGRADE_REQUIRES_BASE`：「升级型号需要这台设备先激活普通版，请先用普通版订单激活」。检查在占用激活凭证之前，买家先激活普通版后，可以直接重试升级。
- **防降级**：设备已持有更高型号时，不再签发更低型号，同一份普通版授权的重发也不行（手环只存一份许可证，装上普通版会覆盖联机版）。409 `EDITION_DOWNGRADE`：「这台设备已激活更高版本（联机版），无需再激活普通版」。已有联机版的设备再用升级订单同样拒绝。其余情况下同一授权对同一设备重发照常返回原许可证。
- **账号激活**：候选订单先在 D1 里排除绑定了其他设备的，按型号从高到低、已绑定本机的优先排序，再预先跳过会被上面两条拒绝的；最多向爱发电复核 3 单。新设备上只有「普通版 + 升级」时先签普通版，再激活一次拿到联机版。全部候选都因型号规则被跳过时，返回对应的 409 而不是「没有可用授权」。
- **创作者**：直接拿最高型号。
- 插件把服务端的错误文案原样显示，不需要额外映射。

手环侧（`packages/vela`）：

- 激活快照 `snapshot()` 多了 `edition`：已激活且许可证带型号时是型号编号（如 `"online"`），否则为 `""`。应用按 `activated && edition === "online"` 之类的条件解锁内容。
- 安装许可证时型号取自解读出的载荷，写进 v2 记录 `{token, device, licenseId, edition}`。
- 型号字段之前写的旧记录没有 `edition` 键，启动时只把令牌载荷做 base64url → JSON 解码取出型号（不验签、不碰设备服务、不写盘），读不出就是 `""`。
- 已激活普通版时收到编号不同的联机版许可证，照常解读、落盘并覆盖旧记录；hello 回执在有型号时附带 `edition`（只供展示，插件不据此跳过安装）。
- `packages/license` 的 `validPayload` 接受可选 `edition`，出现时必须是符合上述格式的字符串，否则整份令牌无效。

## 激活

### 订单号与账号激活

插件主界面第一步是「用 AstroBox 账号激活」，不必等服务检查：

- **流程**：插件读取宿主已登录账号中已确认的爱发电绑定（`account.get-current`），把爱发电用户 ID 交给 `/api/account/products` 查购买情况，再用 `/api/account/activate` 签发。买家不用去翻订单号。
- **超时兜底**：读取账号要弹授权，宿主每次实时查询绑定（单项最多 10 秒）。插件设了 20 秒超时，超时就解锁界面，提示改用订单号激活。
- **复核与回执**：两个账号接口都不返回订单详情。服务端每次都向爱发电现场复核付款状态和商品匹配；回执、状态查询和私信沿用订单号激活的同一套流程。
- **多份订单**：同一订单只绑定第一台设备，账号买过多份时，可以继续用下一份订单激活另一台设备。
- **限流**：宿主安装标识（`os.device-id`，形如 `ab-install-…`）随账号请求发给服务端，只用于限流。它不是硬件序列号，清除应用数据后会变。

> **信任边界**：`afdianUserId` 由插件提供，服务端无法验证调用者就是这个账号的主人。知道某个买家的爱发电用户 ID，就能用他还没绑定的订单激活一台设备。接口为此按 IP、账号和安装标识限流，并限制每份订单只绑一台设备。要彻底关掉这条路，删掉两个账号接口和插件里的账号激活按钮即可。

**创作者自用**：爱发电不允许创作者购买自己的商品，所以账号 ID 等于 `AFDIAN_USER_ID` 时，服务端不查订单，直接列出并签发全部可激活应用。

- 任意设备都可以，每台设备生成一条 `creator:<设备码>` 合成记录（`payment_status=0`），不会混进买家的订单；回执不发私信。
- 合成大西瓜的自定义权益也直接放行。
- 创作者 ID 是公开的，伪造它就能免费激活，这是已知并接受的取舍。

### 离线激活

买家的网络连不上 Kovela 时使用。买家这边只通过蓝牙和手环通信，由创作者在可用网络上核单签发；签发写入同一份设备绑定记录，令牌格式（`KV1`）和密钥都不变。

1. **买家取设备码**：在服务异常提示里选「离线激活」，或连续点击服务状态徽标 5 次进入。输入订单号、选择应用、连接手环后点「获取设备码」。设备码来自手环应用的握手，不是蓝牙 MAC。
2. **买家发申请**：点「复制申请」，把申请 JSON 通过爱发电私信等渠道发给创作者。申请里的订单号不是身份凭证，创作者仍须确认对方就是订单买家。
3. **创作者签发**：在 `/admin` 导入申请并签发；也可以把申请存成 `request.json`，在仓库里运行：

   ```bash
   pnpm license:issue --request request.json --output license.json
   ```

   命令通过 `/api/config`、`/api/orders/lookup`、`/api/activate` 核实付款状态、商品和设备绑定，默认访问线上域名：
   - 可用 `--origin` 指定可信代理；本地验证允许回环 HTTP。
   - 已有的输出文件不会被覆盖。同一设备重发时换个文件名，服务端返回原许可证。
   - 不同设备、未完成订单、商品不符或签名异常时，都不会导出许可证。
4. **买家导入**：选择 `license.json`，或粘贴文件内容、原始 `KV1` 授权串，点「导入并激活」。手环核对应用和设备指纹，确认属于本机后保存。

几点限制：

- **权限**：剪贴板操作用宿主的 `clipboard.read` 和 `clipboard.write` 权限，选文件用 `dialog.pick_file`。
- **内容**：许可证文件不含会话、回执令牌或签名私钥。
- **回执**：离线导入不提交服务器回执，所以服务端只记录「已签发」，不会当作已安装，也不发激活成功私信。
- **撤销**：已签发的离线许可证无法远程撤销。
- **隐私**：申请和许可证含订单与设备信息，不要提交到公开仓库。

### 管理员签发

访问 `/admin`，输入管理员密钥后，可以粘贴或上传买家的申请 JSON，也可以手填订单号、应用和设备码。确认买家身份后核单签发，再下载许可证 JSON 或复制授权串。

- **密钥保管**：密钥只保存在页面内存里，刷新或退出后要重新输入；不会出现在 URL、本地存储或构建产物里。
- **接口**：`POST /api/admin/session`、`POST /api/admin/licenses`，请求头带 `Authorization: Bearer <ADMIN_KEY>`。
- **签发规则**：签发同样核实订单已完成、商品匹配，并沿用在线激活的设备绑定。同一设备重发返回原许可证，不同设备拒绝，也不提交安装回执。

生成密钥：运行 `pnpm admin:key`，密钥保存在未跟踪的 `.secrets/admin-key.vars`，已有文件不会被覆盖。

- 本地 `.dev.vars` 里还没有 `ADMIN_KEY` 时，会自动追加进去。
- 生产环境在 `apps/worker` 下执行 `pnpm exec wrangler secret put ADMIN_KEY`，填入该文件里的值。

### 合成大西瓜自定义权益

游戏本体、内置皮肤、图片传输和手环保存都免费，购买只解锁换肤插件里的自定义图片导入。换肤插件在独立仓库 `../kovela-watermelon`；通用 Kovela 插件查到西瓜订单时，只提示使用换肤插件，不给手环装许可证。商品 ID `com.komoridev.watermelon` 和爱发电商品 `3187fe28c08a11f1805c52540025c377` 保持不变。

`POST /api/watermelon/entitlement`：

- **请求与响应**：接收 `{afdianUserId}`，返回 `{productId, afdianUserId, entitled}`。
- **判定方式**：从 `purchases.buyer_id` 找到这个爱发电用户的 `entitlements`，再向爱发电核对付款状态。旧的设备绑定不影响账号权益。
- **不返回的内容**：订单详情、签名许可证和设备信息都不返回。
- **信任边界**：和账号激活一样不认证调用者。换肤插件只信任宿主返回的已绑定爱发电 ID，每次导入和确认都复查。将来如果需要服务端资源授权，可以接入爱发电 OAuth。

### 手环侧不做签名校验

手环只解读 `KV1` 令牌的结构、应用和设备指纹（`packages/license` 的 `decodeLicense`），不校验签名。

**代价**：任何能向手环发 interconnect 消息的人（改过的插件、自己写的插件），都能推送一份字段合法但没付费的令牌，手环会照单收下。付费墙不再由设备端强制。

**为什么还签名**：服务端仍签发带 Ed25519 签名的令牌，`pnpm license:issue`、Worker 测试和 `verifyLicense` 照常做完整校验。

**恢复验签**只需两步，不用换密钥或令牌格式：

1. 把 `packages/vela/src/index.js` 里的 `decodeLicense` 换回 `verifyLicense`，并把公钥参数接回 `scripts/prepare-vela.mjs` 和 `createActivation`。
2. 重新生成并发布手环应用。

想在设备上加一道更轻的门槛，可以先确认 `@system.crypto` 的 RSA-SHA256 验签在目标机型上可用（原生秒级完成）。

`packages/vela/src/public-key.js` 目前不进入手环产物，只用于 `license:issue` 自检和将来恢复验签。更换签名私钥时必须同步更新它，否则自检会失败。

### 激活链路的等待时间

一次激活要经过插件、Worker、手环三段，每段的等待都算在用户头上。实现上遵循两条原则：先出界面再发请求；已知的结论不重复外呼。

- **插件**：点击处理器只改状态并渲染，网络和宿主调用交给定时事件（`LOOKUP_PAYLOAD`、`ACTIVATE_PAYLOAD`）。宿主要等导出函数返回后才绘制，就地发请求会让画面卡在点击前一到数秒。
- **手环收到 hello**：结论未出时先记下，读出结论立刻回执，不让插件白等一个 2 秒的重发周期。`retry()` 在途超过 1.5 秒才放弃重来，健康但慢的读取不受影响。
- **手环读取顺序**：指纹读取和机型读取串行进行。`getDeviceId`/`getInfo` 和存储请求并发时，真机系统服务可能约半分钟不响应。机型只用于回执标注，所以先发回执，读不到就用宿主连接名。
- **激活页看门狗**：每节 2.5 秒、共四节。页面可见时应用级定时器不运行，存储回调丢失时只能靠页面驱动重读。
- **写入窗口**：安装包写入等待 4 轮 × 12 秒。手环落盘前要读指纹、写存储，窗口太窄会把正在写入的激活误判为超时。
- **`NOT_READY`**：手环回这个状态，只表示还没轮到（指纹未就绪，或上一个安装包正在落盘）。插件继续等下一轮，不算失败，也不发失败私信。

## AstroBox 插件（`plugins/astrobox`）

### 界面与行为

- **界面**：遵循 Material Design 3 深色规范，颜色、圆角、间距、字号集中在 `src/theme.rs`。宿主把插件固定渲染在 `#191919` 深色容器里，所以不跟随宿主主题。
- **服务状态徽标**：打开插件时请求 `/api/config` 检查连通性，之后每分钟复查，查订单和激活期间暂停。网络失败、服务端错误或配置未就绪时显示红色「服务异常」，点击可展开原因，恢复后自动消失。业务请求的网络错误和 5xx 也会同步到徽标；订单号错误、设备通信错误不算服务异常。切到离线激活后停止探测。
- **iOS 连接提示**：iOS 上小米运动健康会和 AstroBox 抢手环的蓝牙。在线激活连上手环之前，以及离线取设备码、导入许可证时，插件显示「iOS 连接提示」：请用户在 iPhone「设置 → 小米运动健康」中关闭蓝牙权限，并从后台划掉它。
- **不推送通知**：实时活动和普通通知在真机上都会让手环重启，相关代码和 `notification` 权限已整体删除，激活进度只在插件界面显示。

### 构建

只出一份 Level 4 产物：`manifest.json` 为 `wasi_version: 3`、`api_level: 4`，权限包括 `account.profile` 和 `os.device-id`。账号资料和宿主安装标识只有 Level 4 才提供，所以不再做 Level 2/3 兼容构建，AstroBox 2.2 以下装不了。

本地打包需要 Rust stable 和 `wasm32-wasip2` 目标：

```bash
rustup target add wasm32-wasip2
pnpm build:plugin
```

产物在 `plugins/astrobox/dist/kovela/`：`manifest.json`、`kovela_astrobox.wasm`、`icon.png`、`Kovela.abp`。其中 `.abp` 是给用户本地导入的完整包，不在 `additional_files` 里，商店不会下载它；其他 `.abp` 由 `.gitignore` 排除。

推送插件源码，或手动运行 [`plugin.yml`](.github/workflows/plugin.yml)，Actions 会执行同一条构建命令，把产物提交回 `main` 并上传 `.abp`。

### 上架官方插件源

官方插件源的聚合脚本（[AstroBox-NG-Plugin-Repo](https://github.com/AstralSightStudios/AstroBox-NG-Plugin-Repo) 的 `generate-index`）每 4 小时通过匿名 raw URL 抓取一次产物，所以仓库必须公开，产物必须提交进 Git。

- 根目录的 [`index.txt`](index.txt) 列出存放 `manifest.json` 的目录（`plugins/astrobox/dist/kovela`）；空行和 `#` 开头的行会被忽略。
- 上游仓库的 `index.txt` 里登记的入口是 `https://raw.githubusercontent.com/KomoriDev/kovela/refs/heads/main/`。
- 发版只需修改 `plugins/astrobox/manifest.json` 的 `version` 并推送，等 Action 跑完即可。

## 手环应用

共享激活代码只在 `packages/vela/src/` 修改，不要直接编辑各应用的 `src/activation/index.js`：

```bash
pnpm prepare:vela   # 生成 ../billiard、../tank-turmoil、../angrybirds、../landlord 的激活代码
pnpm build:vela     # 生成后依次构建这四个应用
```

`prepare:vela` 也可以带路径参数，只生成指定的应用。合成大西瓜的免费通信模块从 `../kovela-watermelon` 的 `wearable/src/` 生成，不经过这里。

## 提交前检查

```bash
pnpm typecheck
pnpm test
```

不要提交 `.dev.vars`、`.secrets/`、`.env` 或签名私钥。仓库只保留许可证公钥。
