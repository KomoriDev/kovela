import type { Context } from "cordis";
import { Service } from "cordis";
import { md5 } from "@noble/hashes/legacy";
import { bytesToHex } from "@noble/hashes/utils";

export const AFDIAN_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`;

export interface AfdianOrder {
  out_trade_no: string;
  user_id: string;
  plan_id: string;
  status: number;
  total_amount: string;
  sku_detail?: { sku_id: string; count: number }[];
}
export class AfdianError extends Error {
  constructor(
    public readonly code: string,
    // 上游原话（ec/em 或 HTTP 状态），只用于落库排查，不进用户可见文案：
    // 爱发电拒收私信的理由（比如内容带尖括号）就藏在这里。
    public readonly detail = "",
  ) {
    super("爱发电服务暂时不可用，请稍后重试。");
    this.name = "AfdianError";
  }
}
function upstreamDetail(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const { ec, em } = value as { ec?: unknown; em?: unknown };
  return `ec=${String(ec ?? "")} ${typeof em === "string" ? em : ""}`
    .trim()
    .slice(0, 200);
}
// 订单既可能来自 Webhook 的 data.order，也可能来自列表接口的 data.list[i]。
// 金额有时是数字、有时是字符串，这里统一成接口用到的形态；解析不了的条目返回
// null，让列表接口能跳过单条脏数据，而不是把整页结果废掉。
function normalizeOrder(value: unknown): AfdianOrder | null {
  if (!value || typeof value !== "object") return null;
  const { sku_detail: rawSku, ...order } = value as Record<string, unknown>;
  const status = Number(order.status);
  const totalAmount =
    typeof order.total_amount === "number" && Number.isFinite(order.total_amount)
      ? order.total_amount.toFixed(2)
      : order.total_amount;
  if (
    typeof order.out_trade_no !== "string" ||
    typeof order.user_id !== "string" ||
    !/^[a-f0-9]{32}$/i.test(order.user_id) ||
    typeof order.plan_id !== "string" ||
    !Number.isInteger(status) ||
    typeof totalAmount !== "string"
  )
    return null;
  return {
    ...order,
    status,
    total_amount: totalAmount,
    // 型号明细只接受数组：校验订单商品时要按 sku 过滤，格式不对就当没有。
    ...(Array.isArray(rawSku)
      ? { sku_detail: rawSku as AfdianOrder["sku_detail"] }
      : {}),
  } as unknown as AfdianOrder;
}
export interface AfdianConfig {
  userId: string;
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}
declare module "cordis" {
  interface Context {
    afdian: AfdianService;
  }
}

export default class AfdianService extends Service {
  private readonly transport: typeof fetch;
  private readonly base: string;
  constructor(
    ctx: Context,
    private readonly options: AfdianConfig,
  ) {
    super(ctx, "afdian");
    this.transport = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.base = options.baseUrl ?? "https://afdian.com/api/open";
  }

  private async call(
    path: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const ts = Math.floor(Date.now() / 1000);
    const encoded = JSON.stringify(params);
    // Afdian's documented legacy API signature, not used for Kovela licenses.
    const sign = bytesToHex(
      md5(
        this.options.token +
          "params" +
          encoded +
          "ts" +
          ts +
          "user_id" +
          this.options.userId,
      ),
    );
    let response;
    try {
      response = await this.transport(this.base + "/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: this.options.userId,
          params: encoded,
          ts,
          sign,
        }),
        signal: AbortSignal.timeout(12000),
        // workerd has no "error" mode; the status check below rejects redirects.
        redirect: "manual",
      });
    } catch {
      throw new AfdianError("UPSTREAM_NETWORK");
    }
    if (!response.ok)
      throw new AfdianError("UPSTREAM_HTTP", "HTTP " + response.status);
    let value;
    try {
      value = await response.json();
    } catch {
      throw new AfdianError("UPSTREAM_JSON");
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("ec" in value) ||
      value.ec !== 200 ||
      !("data" in value)
    )
      throw new AfdianError("UPSTREAM_REJECTED", upstreamDetail(value));
    return value.data;
  }

  async getOrder(orderNo: string): Promise<AfdianOrder | null> {
    const data = await this.call("query-order", { out_trade_no: orderNo });
    if (
      !data ||
      typeof data !== "object" ||
      !("list" in data) ||
      !Array.isArray(data.list)
    )
      throw new AfdianError("UPSTREAM_SCHEMA");
    const order = data.list.find(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        "out_trade_no" in item &&
        item.out_trade_no === orderNo,
    );
    if (!order) return null;
    const normalized = normalizeOrder(order);
    if (!normalized) throw new AfdianError("UPSTREAM_SCHEMA");
    return normalized;
  }

  // 按订单创建时间倒序分页，第 1 页是最新的一页；爱发电没有按时间区间筛选的
  // 参数，补单只能从最新一页往回翻。
  async listOrders(page: number): Promise<AfdianOrder[]> {
    const data = await this.call("query-order", { page });
    if (
      !data ||
      typeof data !== "object" ||
      !("list" in data) ||
      !Array.isArray(data.list)
    )
      throw new AfdianError("UPSTREAM_SCHEMA");
    return data.list.flatMap((item: unknown) => normalizeOrder(item) ?? []);
  }

  async sendMessage(recipient: string, content: string): Promise<void> {
    // 爱发电会以 ec 400001 拒收含尖括号或控制字符的私信。历史文案用 `>` 做引用，
    // 2026-11 起整批私信就是这样静默失败的。队列里存量的旧文案先还原成 `·`，
    // 否则清洗完只剩下行首的空格，气泡里看不出这里本来是个引用行。
    await this.call("send-msg", {
      recipient,
      content: content
        .replace(/\r\n?/g, "\n")
        .replace(/^[ \t]*>[ \t]?/gm, "· ")
        .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f<>]/g, ""),
    });
  }
}

// Official specification: https://afdian.com/p/9c65d9cc617011ed81c352540025c377
// Since 2025-07, data.sign is RSA-SHA256 over these four concatenated fields.
export async function verifyWebhookSignature(
  order: AfdianOrder,
  signature: string,
  publicKey = AFDIAN_WEBHOOK_PUBLIC_KEY,
): Promise<boolean> {
  try {
    if (typeof signature !== "string" || signature.length > 1024) return false;
    const der = Uint8Array.from(
      atob(publicKey.replace(/-----[A-Z ]+-----|\s/g, "")),
      (c) => c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      "spki",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(
      order.out_trade_no + order.user_id + order.plan_id + order.total_amount,
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)),
      signed,
    );
  } catch {
    return false;
  }
}
