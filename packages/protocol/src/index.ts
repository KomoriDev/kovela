export const PLUGIN_NAME = "Kovela";

export interface ProductConfig {
  productId: string;
  productName: string;
  purchaseUrl: string;
  planIds: string[];
  skuIds: string[];
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
