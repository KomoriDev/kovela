import nacl from "tweetnacl";
import { asciiBytes, decodeBase64, hexBytes, validPayload } from "./codec.js";

// Device addresses are transport routing, not license identity. Hash the device's own ID.
export function deviceFingerprint(rawDeviceId, productId) {
  if (
    typeof rawDeviceId !== "string" ||
    !rawDeviceId.trim() ||
    rawDeviceId.length > 1024
  ) {
    throw new Error("Device identity unavailable");
  }
  if (
    typeof productId !== "string" ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(productId)
  ) {
    throw new Error("Invalid product");
  }
  const encoded = encodeURIComponent(
    "Kovela-device:v1|" + productId + "|" + rawDeviceId,
  );
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === "%") {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  const digest = nacl.hash(new Uint8Array(bytes));
  let fingerprint = "";
  for (let i = 0; i < 32; i += 1)
    fingerprint += ("0" + digest[i].toString(16)).slice(-2);
  return fingerprint;
}

// This function needs neither WebCrypto nor a clock/network connection on the wearable.
export function verifyLicense(token, publicKeyHex, productId, deviceId) {
  if (typeof token !== "string" || token.length > 2048) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "KV1") return null;
    const signature = decodeBase64(parts[2]);
    if (signature.length !== 64) return null;
    const bytes = decodeBase64(parts[1]);
    let json = "";
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] > 127) return null;
      json += String.fromCharCode(bytes[i]);
    }
    const payload = JSON.parse(json);
    if (
      !validPayload(payload) ||
      payload.productId !== productId ||
      payload.deviceId !== deviceId
    )
      return null;
    if (
      !nacl.sign.detached.verify(
        asciiBytes("KV1." + parts[1]),
        signature,
        hexBytes(publicKeyHex, 32),
      )
    )
      return null;
    return payload;
  } catch (_) {
    return null;
  }
}
