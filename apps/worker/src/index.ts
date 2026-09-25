import { Context } from "cordis";
import AfdianService, {
  AfdianError,
  verifyWebhookSignature,
  type AfdianOrder,
} from "@kovela/afdian";
import { signLicense } from "@kovela/license/signing";
import { PLUGIN_NAME, type ProductConfig } from "@kovela/protocol";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  PUBLIC_ORIGIN: string;
  DEV_MODE?: string;
  PRODUCTS?: ProductConfig[] | string;
  AFDIAN_USER_ID: string;
  AFDIAN_TOKEN: string;
  LICENSE_SIGNING_SEED: string;
  WEBHOOK_TOKEN: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  AFDIAN_WEBHOOK_PUBLIC_KEY?: string;
}
interface Entitlement {
  order_no: string;
  buyer_id: string;
  product_id: string;
  product_name: string;
  license_id: string;
  device_id: string | null;
  license_token: string | null;
  issued_at: number | null;
  state: "ready" | "issued" | "activated" | "failed";
}
interface Session {
  handoff_hash: string;
  license_id: string;
  expires_at: number;
  status_expires_at: number;
  device_id: string | null;
  request_id: string | null;
  receipt_hash: string | null;
  receipt_expires_at: number | null;
}
interface Outbox {
  id: string;
  recipient: string;
  content: string;
  attempts: number;
}
class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
const productIdPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
function oneLine(value: string, maximum = 80) {
  return value
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}
function chinaTime(unix: number) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(unix * 1000))
    .replace("T", " ");
}
function portal(origin: string) {
  return origin.endsWith("/") ? origin : origin + "/";
}
function purchaseGuide(origin: string, names: string[], orderNo: string) {
  const labels = names.map((name) => oneLine(name)).filter(Boolean);
  const list = labels
    .map((name, index) => `${index + 1}. 【${name}】\n👉 ${orderNo}`)
    .join("\n");
  return [
    "【Kovela】",
    `感谢您购买 ${labels.join("、")}`,
    "为你分配商品激活订单号：",
    list,
    "",
    `您可以前往 Kovela 激活系统完成激活，传送门：${portal(origin)}`,
    "",
    "--------",
    "",
    "> 售后群：993666186",
    "> 更多商品：https://afdian.com/a/komoridev",
    "> 作者开学中，若不能及时回复请耐心等待，没有跑路的风险",
  ].join("\n");
}
function activationNotice(input: {
  result: string;
  productName: string;
  orderNo: string;
  deviceId: string;
  deviceModel: string;
  ip: string;
  activatedAt: number;
}) {
  const productName = oneLine(input.productName);
  if (input.result !== "activated") {
    return `【Kovela】\n${productName} 本次激活未完成，请查看手环提示后重试。\n订单：${input.orderNo}\n设备码：${input.deviceId}`;
  }
  return [
    "【Kovela】",
    "",
    `感谢您使用 Kovela 激活系统，你已成功激活 ${productName}`,
    "",
    `> 软件名称：${productName}`,
    `> 激活时间：${chinaTime(input.activatedAt)}`,
    `> 设备型号：${input.deviceModel || "未上报"}`,
    `> 设备码：${input.deviceId}`,
    `> 操作IP：${input.ip}`,
    "",
    "温馨提示：若本次操作非本人执行，请及时核查账号与设备安全",
  ].join("\n");
}
function operatorIp(request: Request) {
  const value = request.headers.get("CF-Connecting-IP") ?? "";
  return /^[0-9a-fA-F:.]+$/.test(value) && value.length <= 64 ? value : "未知";
}
function deviceModelOf(body: Record<string, unknown>) {
  return typeof body.deviceModel === "string" ? oneLine(body.deviceModel) : "";
}

function catalog(env: Env): ProductConfig[] {
  let products: unknown = env.PRODUCTS ?? [];
  try {
    if (typeof products === "string") products = JSON.parse(products);
    if (!Array.isArray(products)) throw new Error();
    const ids = new Set<string>();
    for (const product of products) {
      if (
        !product ||
        typeof product !== "object" ||
        typeof product.productId !== "string" ||
        product.productId.length > 128 ||
        !productIdPattern.test(product.productId) ||
        ids.has(product.productId) ||
        typeof product.productName !== "string" ||
        !product.productName.trim() ||
        product.productName.length > 80 ||
        typeof product.purchaseUrl !== "string" ||
        (product.purchaseUrl !== "" &&
          new URL(product.purchaseUrl).protocol !== "https:") ||
        ![product.planIds, product.skuIds].every(
          (values) =>
            Array.isArray(values) &&
            values.every(
              (value) =>
                typeof value === "string" &&
                /^[A-Za-z0-9_-]{1,128}$/.test(value),
            ),
        )
      )
        throw new Error();
      ids.add(product.productId);
    }
    return products;
  } catch {
    throw new HttpError(
      503,
      "NOT_CONFIGURED",
      "商品目录配置不正确，请联系创作者。",
    );
  }
}

function availableProduct(
  products: ProductConfig[],
  productId: string,
): ProductConfig {
  const product = products.find((product) => product.productId === productId);
  if (!product?.planIds.length)
    throw new HttpError(
      404,
      "PRODUCT_NOT_AVAILABLE",
      "该应用尚未开放购买验证。",
    );
  return product;
}

function matchesProduct(order: AfdianOrder, product: ProductConfig): boolean {
  return (
    product.planIds.includes(order.plan_id) &&
    (product.skuIds.length === 0 ||
      !!order.sku_detail?.some(
        (sku) => product.skuIds.includes(sku.sku_id) && sku.count > 0,
      ))
  );
}

function requireString(
  body: Record<string, unknown>,
  field: string,
  pattern: RegExp,
): string {
  const value = body[field];
  if (typeof value !== "string" || !pattern.test(value))
    throw new HttpError(400, "INVALID_INPUT", "请求参数不正确，请重新操作。");
  return value;
}
async function bodyOf(
  request: Request,
  acceptAnyContentType = false,
): Promise<Record<string, unknown>> {
  if (
    !acceptAnyContentType &&
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "CONTENT_TYPE", "请使用 JSON 请求。");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "INVALID_JSON", "请求内容为空。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 16384) {
      await reader.cancel();
      throw new HttpError(413, "BODY_TOO_LARGE", "请求内容过长。");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求内容格式错误。");
  }
}

// Provider transport is injectable so the actual Worker/D1 flow can be exercised without real purchases.
export function createWorker(
  providerFetch: typeof fetch = globalThis.fetch.bind(globalThis),
) {
  function provider(env: Env, ctx: Context) {
    if (!env.AFDIAN_TOKEN || !/^[a-f0-9]{32}$/i.test(env.AFDIAN_USER_ID ?? ""))
      throw new HttpError(
        503,
        "NOT_CONFIGURED",
        "授权服务尚未配置完成，请联系创作者。",
      );
    return new AfdianService(ctx, {
      userId: env.AFDIAN_USER_ID,
      token: env.AFDIAN_TOKEN,
      fetch: providerFetch,
    });
  }
  async function limit(
    env: Env,
    key: string,
    maximum: number,
    seconds: number,
  ) {
    const time = now();
    const row = await env.DB.prepare(
      "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count",
    )
      .bind(key, time + seconds, time, time)
      .first<{ count: number }>();
    if (!row || row.count > maximum)
      throw new HttpError(429, "RATE_LIMITED", "操作过于频繁，请稍后重试。");
  }
  async function eligible(
    api: AfdianService,
    orderNo: string,
    pending?: "pending",
  ): Promise<AfdianOrder> {
    const order = await api.getOrder(orderNo);
    if (!order)
      throw new HttpError(
        pending ? 503 : 404,
        pending ? "ORDER_NOT_FOUND" : "ORDER_NOT_ELIGIBLE",
        pending
          ? "订单尚未同步，请稍后重试。"
          : "未找到符合条件的有效订单，请核对订单号和购买商品。",
      );
    if (order.status !== 2 || !/^\d+(?:\.\d{1,2})?$/.test(order.total_amount))
      throw new HttpError(
        404,
        "ORDER_NOT_ELIGIBLE",
        "未找到符合条件的有效订单，请核对订单号和购买商品。",
      );
    return order;
  }
  async function deliverPurchaseGuide(
    env: Env,
    api: AfdianService,
    order: AfdianOrder,
    purchased: ProductConfig[],
  ) {
    if (!purchased.length) return;
    await saveOrder(env, order, purchased);
    await queuePurchaseGuide(env, order, purchased);
    await flushOutbox(env, api);
  }
  async function saveOrder(
    env: Env,
    order: AfdianOrder,
    products: ProductConfig[],
  ) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO purchases(order_no,buyer_id,plan_id,payment_status,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(order_no) DO UPDATE SET payment_status=excluded.payment_status, updated_at=excluded.updated_at",
      ).bind(
        order.out_trade_no,
        order.user_id,
        order.plan_id,
        order.status,
        now(),
      ),
      ...products.map((product) =>
        env.DB.prepare(
          "INSERT INTO entitlements(license_id,order_no,product_id,product_name,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(order_no,product_id) DO UPDATE SET product_name=excluded.product_name",
        ).bind(
          crypto.randomUUID(),
          order.out_trade_no,
          product.productId,
          product.productName,
          now(),
        ),
      ),
    ]);
  }
  async function queuePurchaseGuide(
    env: Env,
    order: AfdianOrder,
    products: ProductConfig[],
  ) {
    const anchor = products[0];
    if (!anchor) return;
    const row = await env.DB.prepare(
      "SELECT license_id FROM entitlements WHERE order_no=? AND product_id=?",
    )
      .bind(order.out_trade_no, anchor.productId)
      .first<{ license_id: string }>();
    if (!row) return;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO outbox(id,license_id,result,recipient,content,next_attempt) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        "guide:" + order.out_trade_no,
        row.license_id,
        "guide",
        order.user_id,
        purchaseGuide(
          env.PUBLIC_ORIGIN,
          products.map((product) => product.productName),
          order.out_trade_no,
        ),
        now(),
      )
      .run();
  }
  async function receiptFor(
    env: Env,
    handoffHash: string,
    requestId: string,
    deviceId: string,
  ) {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.LICENSE_SIGNING_SEED),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return Array.from(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(
            "Kovela-receipt:v1|" +
              handoffHash +
              "|" +
              requestId +
              "|" +
              deviceId,
          ),
        ),
      ),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  }
  async function flushOutbox(env: Env, api: AfdianService) {
    const time = now();
    const due = await env.DB.prepare(
      "SELECT id,recipient,content,attempts FROM outbox WHERE (state='pending' AND next_attempt<=?) OR (state='sending' AND lease_until<=?) ORDER BY next_attempt LIMIT 8",
    )
      .bind(time, time)
      .all<Outbox>();
    for (const message of due.results) {
      try {
        await limit(env, "afdian:second:" + now(), 8, 2);
        await limit(env, "afdian:hour:" + Math.floor(now() / 3600), 900, 3601);
      } catch {
        return;
      }
      const lease = randomToken();
      const claimed = await env.DB.prepare(
        "UPDATE outbox SET state='sending',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=? AND ((state='pending' AND next_attempt<=?) OR (state='sending' AND lease_until<=?)) RETURNING id",
      )
        .bind(time + 60, lease, message.id, time, time)
        .first();
      if (!claimed) continue;
      try {
        await api.sendMessage(message.recipient, message.content);
        await env.DB.prepare(
          "UPDATE outbox SET state='sent',sent_at=?,lease_until=0 WHERE id=? AND lease_token=?",
        )
          .bind(now(), message.id, lease)
          .run();
      } catch {
        // Afdian has no documented idempotency key. A lost response may cause a duplicate on retry.
        await env.DB.prepare(
          "UPDATE outbox SET state='pending',next_attempt=?,lease_until=0 WHERE id=? AND lease_token=?",
        )
          .bind(
            now() + Math.min(3600, 30 * 2 ** Math.min(message.attempts, 7)),
            message.id,
            lease,
          )
          .run();
      }
    }
  }
  async function dispatch(
    request: Request,
    env: Env,
    apiContext: Context,
  ): Promise<unknown> {
    const url = new URL(request.url);
    const origin = new URL(env.PUBLIC_ORIGIN);
    const local =
      env.DEV_MODE === "true" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      origin.origin !== env.PUBLIC_ORIGIN ||
      (!local && origin.protocol !== "https:")
    )
      throw new HttpError(503, "NOT_CONFIGURED", "服务域名配置不正确。");
    const products = catalog(env);
    const signingReady = /^[a-f0-9]{64}$/i.test(env.LICENSE_SIGNING_SEED ?? "");
    const verificationEnabled = !!(
      env.AFDIAN_TOKEN &&
      /^[a-f0-9]{32}$/i.test(env.AFDIAN_USER_ID ?? "") &&
      signingReady &&
      (local || (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)) &&
      products.some((product) => product.planIds.length > 0)
    );
    if (request.method === "GET" && url.pathname === "/api/config")
      return {
        products: products.map(
          ({ productId, productName, purchaseUrl, planIds }) => ({
            productId,
            productName,
            purchaseUrl,
            available: planIds.length > 0,
          }),
        ),
        verificationEnabled,
        pluginName: PLUGIN_NAME,
        publicOrigin: env.PUBLIC_ORIGIN,
        turnstileSiteKey:
          local || !verificationEnabled ? "" : env.TURNSTILE_SITE_KEY,
      };
    if (request.method !== "POST")
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "不支持此请求方式。");
    const body = await bodyOf(request, url.pathname === "/api/webhooks/afdian");
    if (url.pathname === "/api/orders/verify" && !verificationEnabled)
      throw new HttpError(
        503,
        "NOT_CONFIGURED",
        "购买验证尚未开放，请等待创作者完成服务配置。",
      );
    if (url.pathname === "/api/activate" && !signingReady)
      throw new HttpError(503, "NOT_CONFIGURED", "授权签发服务尚未配置完成。");
    const api = provider(env, apiContext);
    if (url.pathname === "/api/webhooks/afdian") {
      if (
        !env.WEBHOOK_TOKEN ||
        env.WEBHOOK_TOKEN.length < 32 ||
        (await digest(url.searchParams.get("token") ?? "")) !==
          (await digest(env.WEBHOOK_TOKEN))
      )
        throw new HttpError(401, "WEBHOOK_AUTH", "Webhook 认证失败。");
      if (
        body.ec !== 200 ||
        !body.data ||
        typeof body.data !== "object" ||
        !("type" in body.data) ||
        body.data.type !== "order"
      )
        return { ec: 200 };
      const data = body.data as { order?: AfdianOrder; sign?: string };
      if (
        !data.order ||
        !/^\d{16,32}$/.test(data.order.out_trade_no) ||
        typeof data.order.user_id !== "string" ||
        typeof data.order.plan_id !== "string" ||
        typeof data.order.total_amount !== "string" ||
        !data.sign ||
        !(await verifyWebhookSignature(
          data.order,
          data.sign,
          env.AFDIAN_WEBHOOK_PUBLIC_KEY,
        ))
      )
        throw new HttpError(401, "WEBHOOK_SIGNATURE", "Webhook 签名验证失败。");
      try {
        const order = await eligible(api, data.order.out_trade_no, "pending");
        await deliverPurchaseGuide(
          env,
          api,
          order,
          products.filter((product) => matchesProduct(order, product)),
        );
      } catch (error) {
        if (error instanceof HttpError && error.code === "ORDER_NOT_FOUND") {
          const status = Number(data.order.status);
          const fallback =
            status === 2 && /^\d+(?:\.\d{1,2})?$/.test(data.order.total_amount)
              ? { ...data.order, status }
              : null;
          const waitsForSku =
            !!fallback &&
            products.some(
              (product) =>
                product.planIds.includes(fallback.plan_id) &&
                product.skuIds.length > 0,
            );
          if (!fallback) {
            // Unpaid or malformed notices are not purchase replies.
          } else if (waitsForSku) throw error;
          else
            await deliverPurchaseGuide(
              env,
              api,
              fallback,
              products.filter(
                (product) =>
                  product.skuIds.length === 0 &&
                  matchesProduct(fallback, product),
              ),
            );
        } else if (!(
          error instanceof HttpError && error.code === "ORDER_NOT_ELIGIBLE"
        ))
          throw error;
      }
      return { ec: 200 };
    }
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    await limit(env, "ip:" + (await digest(ip)), 90, 60);
    if (url.pathname === "/api/orders/verify") {
      const orderNo = requireString(body, "orderNo", /^\d{16,32}$/);
      const product = availableProduct(
        products,
        requireString(body, "productId", productIdPattern),
      );
      await limit(env, "verify:" + (await digest(ip)), 10, 60);
      if (!local) {
        if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY)
          throw new HttpError(503, "NOT_CONFIGURED", "人机验证服务尚未配置。");
        const token = requireString(body, "turnstileToken", /^.{1,2048}$/);
        let check: { success?: boolean; hostname?: string; action?: string };
        try {
          const response = await providerFetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              body: new URLSearchParams({
                secret: env.TURNSTILE_SECRET_KEY,
                response: token,
                remoteip: ip,
              }),
              signal: AbortSignal.timeout(10000),
            },
          );
          check = await response.json();
        } catch {
          throw new HttpError(
            502,
            "CHALLENGE_UNAVAILABLE",
            "人机验证服务暂时不可用。",
          );
        }
        if (
          !check.success ||
          check.hostname !== origin.hostname ||
          check.action !== "verify-order"
        )
          throw new HttpError(
            403,
            "CHALLENGE_FAILED",
            "人机验证未通过，请重试。",
          );
      }
      const paidOrder = await eligible(api, orderNo);
      if (!matchesProduct(paidOrder, product))
        throw new HttpError(
          404,
          "ORDER_NOT_ELIGIBLE",
          "此订单不包含所选应用，请核对购买商品。",
        );
      await saveOrder(env, paidOrder, [product]);
      await queuePurchaseGuide(env, paidOrder, [product]);
      await flushOutbox(env, api);
      const entitlement = await env.DB.prepare(
        "SELECT * FROM entitlements WHERE order_no=? AND product_id=?",
      )
        .bind(orderNo, product.productId)
        .first<Entitlement>();
      if (!entitlement)
        throw new HttpError(
          503,
          "SERVICE_UNAVAILABLE",
          "暂时无法读取授权订单。",
        );
      const handoffToken = randomToken();
      const statusToken = randomToken();
      const expiresAt = now() + 600;
      await env.DB.prepare(
        "INSERT INTO sessions(handoff_hash,status_hash,license_id,expires_at,status_expires_at) VALUES(?,?,?,?,?)",
      )
        .bind(
          await digest(handoffToken),
          await digest(statusToken),
          entitlement.license_id,
          expiresAt,
          expiresAt + 3600,
        )
        .run();
      return {
        orderNo,
        productId: product.productId,
        productName: product.productName,
        handoffToken,
        statusToken,
        expiresAt,
        boundDeviceId: entitlement.device_id,
      };
    }
    if (url.pathname === "/api/activate") {
      const token = requireString(body, "handoffToken", /^[a-f0-9]{64}$/);
      const deviceId = requireString(body, "deviceId", /^[a-f0-9]{64}$/);
      const productId = requireString(body, "productId", productIdPattern);
      const requestId = requireString(
        body,
        "requestId",
        /^[A-Za-z0-9_-]{16,80}$/,
      );
      const hash = await digest(token);
      const session = await env.DB.prepare(
        "SELECT * FROM sessions WHERE handoff_hash=? AND expires_at>?",
      )
        .bind(hash, now())
        .first<Session>();
      if (!session)
        throw new HttpError(
          410,
          "HANDOFF_EXPIRED",
          "激活链接已过期，请在网页重新验证订单。",
        );
      if (
        session.device_id &&
        (session.device_id !== deviceId || session.request_id !== requestId)
      )
        throw new HttpError(
          409,
          "HANDOFF_USED",
          "该激活链接已用于另一请求，请重新验证订单。",
        );
      const order = await env.DB.prepare(
        "SELECT * FROM entitlements WHERE license_id=?",
      )
        .bind(session.license_id)
        .first<Entitlement>();
      if (!order) throw new HttpError(404, "ORDER_MISSING", "授权订单不存在。");
      if (order.product_id !== productId)
        throw new HttpError(
          409,
          "PRODUCT_MISMATCH",
          "激活链接与目标应用不匹配，请重新验证订单。",
        );
      const product = availableProduct(products, order.product_id);
      if (!matchesProduct(await eligible(api, order.order_no), product))
        throw new HttpError(
          404,
          "ORDER_NOT_ELIGIBLE",
          "此订单不再符合所选应用的授权条件。",
        );
      if (order.device_id && order.device_id !== deviceId)
        throw new HttpError(
          409,
          "DEVICE_BOUND",
          "此订单的应用授权已绑定其他设备，请联系创作者。",
        );
      const receiptToken = await receiptFor(env, hash, requestId, deviceId);
      const claimed = await env.DB.prepare(
        "UPDATE sessions SET device_id=?,request_id=?,receipt_hash=?,receipt_expires_at=? WHERE handoff_hash=? AND expires_at>? AND (device_id IS NULL OR (device_id=? AND request_id=?)) RETURNING handoff_hash",
      )
        .bind(
          deviceId,
          requestId,
          await digest(receiptToken),
          now() + 3600,
          hash,
          now(),
          deviceId,
          requestId,
        )
        .first();
      if (!claimed)
        throw new HttpError(409, "HANDOFF_USED", "该激活链接已被使用。");
      const issuedAt = now();
      const licenseToken =
        order.license_token ??
        signLicense(
          {
            v: 1,
            licenseId: order.license_id,
            productId: order.product_id,
            deviceId,
            issuedAt,
          },
          env.LICENSE_SIGNING_SEED,
        );
      const bound = await env.DB.prepare(
        "UPDATE entitlements SET device_id=?,license_token=COALESCE(license_token,?),issued_at=COALESCE(issued_at,?),state=CASE WHEN state='activated' THEN state ELSE 'issued' END,updated_at=? WHERE license_id=? AND (device_id IS NULL OR device_id=?) RETURNING *",
      )
        .bind(
          deviceId,
          licenseToken,
          issuedAt,
          now(),
          session.license_id,
          deviceId,
        )
        .first<Entitlement>();
      if (!bound)
        throw new HttpError(
          409,
          "DEVICE_BOUND",
          "此应用授权刚刚绑定了其他设备。",
        );
      return {
        licenseId: bound.license_id,
        licenseToken: bound.license_token,
        receiptToken,
        productId: bound.product_id,
        deviceId,
      };
    }
    if (url.pathname === "/api/activation/report") {
      const token = requireString(body, "receiptToken", /^[a-f0-9]{64}$/);
      const deviceId = requireString(body, "deviceId", /^[a-f0-9]{64}$/);
      const requestId = requireString(
        body,
        "requestId",
        /^[A-Za-z0-9_-]{16,80}$/,
      );
      const licenseId = requireString(
        body,
        "licenseId",
        /^[A-Za-z0-9_-]{16,80}$/,
      );
      const result = requireString(body, "result", /^(activated|failed)$/);
      const session = await env.DB.prepare(
        "SELECT * FROM sessions WHERE receipt_hash=? AND receipt_expires_at>?",
      )
        .bind(await digest(token), now())
        .first<Session>();
      if (
        !session ||
        session.device_id !== deviceId ||
        session.request_id !== requestId ||
        session.license_id !== licenseId
      )
        throw new HttpError(401, "INVALID_RECEIPT", "激活回执无效或已过期。");
      const order = await env.DB.prepare(
        "SELECT e.*,p.buyer_id FROM entitlements e JOIN purchases p ON p.order_no=e.order_no WHERE e.license_id=? AND e.device_id=?",
      )
        .bind(licenseId, deviceId)
        .first<Entitlement>();
      if (!order)
        throw new HttpError(401, "INVALID_RECEIPT", "激活回执与授权不匹配。");
      const content = activationNotice({
        result,
        productName: order.product_name,
        orderNo: order.order_no,
        deviceId,
        deviceModel: deviceModelOf(body),
        ip: operatorIp(request),
        activatedAt: now(),
      });
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE entitlements SET state=CASE WHEN state='activated' THEN state ELSE ? END,updated_at=? WHERE license_id=?",
        ).bind(result, now(), licenseId),
        env.DB.prepare(
          "DELETE FROM outbox WHERE license_id=? AND result='failed' AND state='pending' AND ?='activated'",
        ).bind(licenseId, result),
        env.DB.prepare(
          "INSERT OR IGNORE INTO outbox(id,license_id,result,recipient,content,next_attempt) SELECT ?,?,?,?,?,? WHERE ?='activated' OR (SELECT state FROM entitlements WHERE license_id=?)!='activated'",
        ).bind(
          licenseId + ":" + result,
          licenseId,
          result,
          order.buyer_id,
          content,
          now(),
          result,
          licenseId,
        ),
      ]);
      await flushOutbox(env, api);
      const message = await env.DB.prepare(
        "SELECT state FROM outbox WHERE id=?",
      )
        .bind(
          licenseId +
            ":" +
            (order.state === "activated" ? "activated" : result),
        )
        .first<{ state: string }>();
      return { notification: message?.state === "sent" ? "sent" : "pending" };
    }
    if (url.pathname === "/api/activation/status") {
      const token = requireString(body, "statusToken", /^[a-f0-9]{64}$/);
      const row = await env.DB.prepare(
        "SELECT e.* FROM sessions s JOIN entitlements e ON s.license_id=e.license_id WHERE s.status_hash=? AND s.status_expires_at>?",
      )
        .bind(await digest(token), now())
        .first<Entitlement>();
      if (!row)
        throw new HttpError(
          410,
          "STATUS_EXPIRED",
          "状态查询已过期，请重新验证订单。",
        );
      const message = await env.DB.prepare(
        "SELECT state FROM outbox WHERE id=?",
      )
        .bind(row.license_id + ":" + row.state)
        .first<{ state: string }>();
      return {
        state: row.state,
        deviceId: row.device_id,
        notification: !message
          ? "none"
          : message.state === "sent"
            ? "sent"
            : "pending",
      };
    }
    throw new HttpError(404, "NOT_FOUND", "接口不存在。");
  }
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/"))
        return env.ASSETS
          ? env.ASSETS.fetch(request)
          : new Response("Kovela assets are not built.", { status: 404 });
      const headers = new Headers({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        Vary: "Origin",
      });
      const origin = request.headers.get("origin");
      if (origin && origin !== env.PUBLIC_ORIGIN)
        return Response.json(
          { error: { code: "ORIGIN_REJECTED", message: "请求来源不被允许。" } },
          { status: 403, headers },
        );
      if (origin) headers.set("Access-Control-Allow-Origin", origin);
      if (request.method === "OPTIONS") {
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type");
        return new Response(null, { status: 204, headers });
      }
      const ctx = new Context();
      try {
        return Response.json(await dispatch(request, env, ctx), { headers });
      } catch (error) {
        const known = error instanceof HttpError;
        const status = known
          ? error.status
          : error instanceof AfdianError
            ? 502
            : 503;
        return Response.json(
          {
            error: {
              code: known
                ? error.code
                : error instanceof AfdianError
                  ? error.code
                  : "SERVICE_UNAVAILABLE",
              message:
                known || error instanceof AfdianError
                  ? error.message
                  : "验证服务暂时不可用，请稍后重试。",
            },
          },
          { status, headers },
        );
      } finally {
        await ctx.stop();
      }
    },
    async scheduled(_event: ScheduledController, env: Env): Promise<void> {
      if (
        !env.AFDIAN_TOKEN ||
        !/^[a-f0-9]{32}$/i.test(env.AFDIAN_USER_ID ?? "")
      )
        return;
      const ctx = new Context();
      try {
        await flushOutbox(env, provider(env, ctx));
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM sessions WHERE status_expires_at<? AND (receipt_expires_at IS NULL OR receipt_expires_at<?)",
          ).bind(now(), now()),
          env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
            now(),
          ),
        ]);
      } finally {
        await ctx.stop();
      }
    },
  };
}
export default createWorker();
