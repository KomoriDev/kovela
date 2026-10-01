import type { Context } from "cordis";
import { Service } from "cordis";
import type {
  LookupOrderRequest,
  LookupOrderResult,
  OfflineRequest,
  OfflineLicense,
  PublicConfig,
  VerifiedOrder,
  VerifyOrderRequest,
  ActivationStatus,
} from "@kovela/protocol";

export class KovelaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
  ) {
    super(message);
    this.name = "KovelaError";
  }
}

declare module "cordis" {
  interface Context {
    kovela: KovelaClient;
  }
}

export default class KovelaClient extends Service {
  private readonly transport: typeof fetch;
  private readonly origin: string;
  constructor(
    ctx: Context,
    config: { baseUrl?: string; fetch?: typeof fetch } = {},
  ) {
    super(ctx, "kovela");
    this.transport = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.origin = (config.baseUrl ?? "").replace(/\/$/, "");
  }

  getConfig(signal?: AbortSignal): Promise<PublicConfig> {
    return this.request("/api/config", undefined, signal);
  }
  verifyOrder(
    input: VerifyOrderRequest,
    signal?: AbortSignal,
  ): Promise<VerifiedOrder> {
    return this.request("/api/orders/verify", input, signal);
  }
  lookupOrder(
    input: LookupOrderRequest,
    signal?: AbortSignal,
  ): Promise<LookupOrderResult> {
    return this.request("/api/orders/lookup", input, signal);
  }
  status(statusToken: string, signal?: AbortSignal): Promise<ActivationStatus> {
    return this.request("/api/activation/status", { statusToken }, signal);
  }
  authorizeAdmin(key: string, signal?: AbortSignal): Promise<{ authenticated: true }> {
    return this.request("/api/admin/session", {}, signal, key);
  }
  issueOfflineLicense(input: OfflineRequest, key: string, signal?: AbortSignal): Promise<OfflineLicense> {
    return this.request("/api/admin/licenses", input, signal, key);
  }

  private async request<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    adminKey?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(this.origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(adminKey === undefined ? {} : { Authorization: `Bearer ${adminKey}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        cache: "no-store",
        credentials: "omit",
        redirect: adminKey === undefined ? "follow" : "error",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new KovelaError("NETWORK", "无法连接验证服务，请检查网络后重试。");
    }
    let value;
    try {
      value = await response.json();
    } catch {
      throw new KovelaError(
        "RESPONSE",
        "验证服务返回异常，请稍后重试。",
        response.status,
      );
    }
    if (!response.ok) {
      throw new KovelaError(
        value?.error?.code ?? "REQUEST_FAILED",
        value?.error?.message ?? "请求失败，请稍后重试。",
        response.status,
      );
    }
    return value;
  }
}
