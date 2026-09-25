export interface LicensePayload {
  v: 1;
  licenseId: string;
  productId: string;
  deviceId: string;
  issuedAt: number;
}
export function deviceFingerprint(
  rawDeviceId: string,
  productId: string,
): string;
export function verifyLicense(
  token: unknown,
  publicKeyHex: string,
  productId: string,
  deviceId: string,
): LicensePayload | null;
