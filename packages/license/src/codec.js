const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function asciiBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 127) throw new Error("Expected ASCII");
    bytes[i] = code;
  }
  return bytes;
}

export function hexBytes(value, length) {
  if (
    typeof value !== "string" ||
    value.length !== length * 2 ||
    !/^[0-9a-f]+$/i.test(value)
  ) {
    throw new Error("Invalid key encoding");
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1)
    bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function encodeBase64(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    output += alphabet[a >>> 2] + alphabet[((a & 3) << 4) | (b >>> 4)];
    if (i + 1 < bytes.length) output += alphabet[((b & 15) << 2) | (c >>> 6)];
    if (i + 2 < bytes.length) output += alphabet[c & 63];
  }
  return output;
}

export function decodeBase64(value) {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid license encoding");
  }
  const bytes = new Uint8Array(Math.floor((value.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (let i = 0; i < value.length; i += 1) {
    buffer = (buffer << 6) | alphabet.indexOf(value[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >>> bits) & 255;
    }
  }
  if ((buffer & ((1 << bits) - 1)) !== 0)
    throw new Error("Non-canonical license encoding");
  return bytes;
}

export function validPayload(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.v === 1 &&
    typeof value.licenseId === "string" &&
    /^[A-Za-z0-9_-]{16,80}$/.test(value.licenseId) &&
    typeof value.productId === "string" &&
    /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.productId) &&
    value.productId.length <= 120 &&
    typeof value.deviceId === "string" &&
    /^[0-9a-f]{64}$/.test(value.deviceId) &&
    typeof value.issuedAt === "number" &&
    value.issuedAt > 0 &&
    value.issuedAt <= Number.MAX_SAFE_INTEGER &&
    Math.floor(value.issuedAt) === value.issuedAt
  );
}
