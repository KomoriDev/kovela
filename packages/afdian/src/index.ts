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
  constructor(public readonly code: string) {
    super("爱发电服务暂时不可用，请稍后重试。");
    this.name = "AfdianError";
  }
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
    if (!response.ok) throw new AfdianError("UPSTREAM_HTTP");
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
      throw new AfdianError("UPSTREAM_REJECTED");
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
    const status = Number(order.status);
    const totalAmount =
      typeof order.total_amount === "number" &&
      Number.isFinite(order.total_amount)
        ? order.total_amount.toFixed(2)
        : order.total_amount;
    if (
      typeof order.user_id !== "string" ||
      !/^[a-f0-9]{32}$/i.test(order.user_id) ||
      typeof order.plan_id !== "string" ||
      !Number.isInteger(status) ||
      typeof totalAmount !== "string"
    )
      throw new AfdianError("UPSTREAM_SCHEMA");
    return { ...order, status, total_amount: totalAmount };
  }

  async sendMessage(recipient: string, content: string): Promise<void> {
    await this.call("send-msg", { recipient, content });
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
