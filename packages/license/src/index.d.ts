export interface LicensePayload {
  v: 1;
  licenseId: string;
  productId: string;
  deviceId: string;
  issuedAt: number;
  /** 型号（付费档位）编号，只在配置了 editions 的商品上出现，格式 /^[a-z][a-z0-9-]{0,31}$/。 */
  edition?: string;
}
export function deviceFingerprint(
  rawDeviceId: string,
  productId: string,
): string;
export function decodeLicense(
  token: unknown,
  productId: string,
  deviceId: string,
): LicensePayload | null;
export function verifyLicense(
  token: unknown,
  publicKeyHex: string,
  productId: string,
  deviceId: string,
): LicensePayload | null;
/** 只解码载荷读出型号，不验签、不抛错；没有或读不出时返回空串。 */
export function licenseEdition(token: unknown): string;
