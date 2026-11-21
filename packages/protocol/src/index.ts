export const PLUGIN_NAME = "Kovela";

// 型号（付费档位）：同一个应用（productId 仍等于包名）在爱发电上按 SKU 分档出售。
// 型号写进签名许可证载荷的 edition 字段，手环据此解锁对应内容。
// SKU 既可按 sku_id 匹配，也可按 SKU 名称（订单 sku_detail[].name，去首尾空白后
// 全等）匹配：创作者不能购买自己的商品，往往拿不到 sku_id，只能先按名称配置。
// 在爱发电上改了 SKU 名称，名称匹配就会失效；拿到 sku_id 后填进 skuIds 更稳。
export interface ProductEdition {
  /** 写进许可证的型号编号，/^[a-z][a-z0-9-]{0,31}$/。 */
  id: string;
  /** 展示名（≤ 20 字），出现在插件商品列表与私信里，如「斗地主（联机版）」。 */
  name: string;
  skuIds?: string[];
  skuNames?: string[];
  /** 补差价升级 SKU：只能激活到已持有更低型号的同一台设备上。第一个型号不能有。 */
  upgradeSkuIds?: string[];
  upgradeSkuNames?: string[];
}

export interface ProductConfig {
  productId: string;
  productName: string;
  purchaseUrl: string;
  planIds: string[];
  skuIds: string[];
  /** 可选，按档位从低到高排列；不配置的商品许可证里没有 edition 字段。 */
  editions?: ProductEdition[];
}

export interface PublicProduct {
  productId: string;
  productName: string;
  purchaseUrl: string;
  available: boolean;
}

export interface PublicConfig {
  products: PublicProduct[];
  verificationEnabled: boolean;
  turnstileSiteKey: string;
  publicOrigin: string;
  pluginName: string;
}
export interface VerifyOrderRequest {
  orderNo: string;
  productId: string;
  turnstileToken?: string;
}
export interface VerifiedOrder {
  orderNo: string;
  productId: string;
  productName: string;
  handoffToken: string;
  statusToken: string;
  expiresAt: number;
  boundDeviceId: string | null;
}
export interface LookupOrderRequest {
  orderNo: string;
}
export interface LookupOrderItem {
  productId: string;
  productName: string;
  handoffToken: string;
  statusToken: string;
  expiresAt: number;
  boundDeviceId: string | null;
}
export interface LookupOrderResult {
  orderNo: string;
  items: LookupOrderItem[];
}
export interface ActivateRequest {
  handoffToken: string;
  productId: string;
  deviceId: string;
  requestId: string;
}
export interface IssuedLicense {
  licenseId: string;
  licenseToken: string;
  receiptToken: string;
  productId: string;
  deviceId: string;
}
export interface OfflineRequest {
  v: 1;
  type: "kovela-offline-request";
  orderNo: string;
  productId: string;
  deviceId: string;
  deviceModel?: string;
}
export interface OfflineLicense {
  v: 1;
  type: "kovela-offline-license";
  licenseId: string;
  licenseToken: string;
  productId: string;
  productName: string;
  deviceId: string;
}
export interface ReportActivationRequest {
  receiptToken: string;
  requestId: string;
  licenseId: string;
  deviceId: string;
  result: "activated" | "failed";
}
export interface ActivationReport {
  notification: "sent" | "pending";
}
export interface ActivationStatus {
  state: "ready" | "issued" | "activated" | "failed";
  deviceId: string | null;
  notification: "none" | "pending" | "sent";
}
export interface ApiFailure {
  error: { code: string; message: string };
}
export interface Handoff {
  v: 2;
  serverOrigin: string;
  handoffToken: string;
  productId: string;
  productName: string;
}
export interface LicensePayload {
  v: 1;
  licenseId: string;
  productId: string;
  deviceId: string;
  issuedAt: number;
  edition?: string;
}
export type DeviceRequest =
  | { v: 1; id: string; type: "hello" }
  | {
      v: 1;
      id: string;
      type: "install-license";
      licenseId: string;
      licenseToken: string;
    };
export type DeviceReply =
  | {
      v: 1;
      id: string;
      type: "device";
      productId: string;
      deviceId: string;
      activated: boolean;
      deviceModel?: string;
      /** 本机已保存许可证的型号；没有型号时不带。只用于展示，插件不据此跳过安装。 */
      edition?: string;
    }
  | {
      v: 1;
      id: string;
      type: "activation-result";
      licenseId: string;
      deviceId: string;
      success: boolean;
      error?: string;
    };
