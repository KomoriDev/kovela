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

// 拆出 KV1 令牌的三段并解析载荷：编码或结构不合格返回 null。
function readLicense(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
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
  if (!validPayload(payload)) return null;
  return { body: "KV1." + parts[1], signature: signature, payload: payload };
}

function boundToLocalDevice(payload, productId, deviceId) {
  return payload.productId === productId && payload.deviceId === deviceId;
}

// 手环侧的激活判定：只解读令牌并确认它属于本机（结构与产品/设备绑定），
// 不校验签名。真机上一次 Ed25519 验签要十几秒，这笔开销被移出了激活流程
// （代价与恢复方式见 README「激活链路的等待时间」）。服务端仍签发带签名的
// KV1 令牌，因此恢复验签只需把手环的调用点换回 verifyLicense。
export function decodeLicense(token, productId, deviceId) {
  try {
    const license = readLicense(token);
    if (!license || !boundToLocalDevice(license.payload, productId, deviceId))
      return null;
    return license.payload;
  } catch (_) {
    return null;
  }
}

// 完整校验：结构、绑定与 Ed25519 签名。手环不再走这条路径；创作者 CLI、
// Worker 测试与签发工具用它确认许可证确实由签发密钥签出。
export function verifyLicense(token, publicKeyHex, productId, deviceId) {
  try {
    const license = readLicense(token);
    if (!license || !boundToLocalDevice(license.payload, productId, deviceId))
      return null;
    if (
      !nacl.sign.detached.verify(
        asciiBytes(license.body),
        license.signature,
        hexBytes(publicKeyHex, 32),
      )
    )
      return null;
    return license.payload;
  } catch (_) {
    return null;
  }
}
