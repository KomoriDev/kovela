// 计时反馈回路：结论（ready）延迟受哪条腿支配。
// 用法：node tests/latency.bench.mjs
// 判据：本机存有有效授权且设备指纹缓存命中时，结论延迟应只取决于
// storage.get，与 device.getDeviceId（真机上秒级的系统服务往返）无关。
// 没有缓存的首启仍要等真实标识，属预期，仅打印参考。
import { performance } from "node:perf_hooks";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { deviceFingerprint, verifyLicense } from "@kovela/license";
import { createActivation } from "../src/index.js";

const PRODUCT = "com.example.game";
const RAW_DEVICE = "raw-device-0001";
const TOKEN_KEY = "kovela_license_v1";
const DEVICE_KEY = "kovela_device_v1";
const seed = Buffer.alloc(32, 7);
const signingKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(signingKey)
  .export({ format: "der", type: "spki" })
  .subarray(12)
  .toString("hex");

function mint(deviceId, licenseId = "license-0000000001") {
  const payload = {
    v: 1,
    licenseId,
    productId: PRODUCT,
    deviceId,
    issuedAt: 1790000000000,
  };
  const body =
    "KV1." +
    Buffer.from(JSON.stringify(payload), "ascii").toString("base64url");
  const signature = sign(null, Buffer.from(body, "ascii"), signingKey);
  return body + "." + signature.toString("base64url");
}

const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
const token = mint(fingerprint);

// —— 纯 CPU 成本（Node 是真机 JS 引擎的上界参照） ——
{
  const rounds = 2000;
  let t0 = performance.now();
  for (let i = 0; i < rounds; i += 1) deviceFingerprint(RAW_DEVICE, PRODUCT);
  const fingerprintMs = (performance.now() - t0) / rounds;
  t0 = performance.now();
  for (let i = 0; i < rounds; i += 1)
    verifyLicense(token, publicKey, PRODUCT, fingerprint);
  const verifyMs = (performance.now() - t0) / rounds;
  console.log(
    "CPU/次（Node 参照）：deviceFingerprint=" +
      fingerprintMs.toFixed(3) +
      "ms  verifyLicense=" +
      verifyMs.toFixed(3) +
      "ms",
  );
}

// —— 状态机结论延迟（可调端口延迟） ——
function runOnce(idDelayMs, storageDelayMs, cachedDevice) {
  return new Promise((resolve) => {
    let readyAt = 0;
    let startedAt = 0;
    const activation = createActivation(PRODUCT, publicKey, {
      device: {
        getDeviceId(options) {
          setTimeout(
            () => options.success({ deviceId: RAW_DEVICE }),
            idDelayMs,
          );
        },
        getInfo(options) {
          setTimeout(() => options.success({}), idDelayMs);
        },
      },
      storage: {
        get(options) {
          const value = options.key === DEVICE_KEY ? cachedDevice : token;
          setTimeout(() => options.success(value), storageDelayMs);
        },
        set() {},
      },
      interconnect: { instance: () => ({}) },
    });
    activation.subscribe((state) => {
      if (state.ready && !readyAt) {
        readyAt = performance.now() - startedAt;
        activation.dispose();
        resolve({ verdictMs: readyAt, activated: state.activated });
      }
    });
    startedAt = performance.now();
    activation.start();
  });
}

console.log(
  "首启（无缓存，预期陪 getDeviceId 等全程；storage=5ms）→ 结论延迟：",
);
for (const idDelay of [100, 3000]) {
  const sample = await runOnce(idDelay, 5, "");
  console.log(
    "  getDeviceId " +
      String(idDelay).padStart(5) +
      "ms → 结论 " +
      sample.activated +
      "，延迟 " +
      sample.verdictMs.toFixed(0) +
      "ms",
  );
}

console.log(
  "再次进入（指纹缓存命中，结论不该被 getDeviceId 拖住；storage=5ms）→ 结论延迟：",
);
const cacheHit = [];
for (const idDelay of [5, 100, 300, 1000, 3000]) {
  const sample = await runOnce(idDelay, 5, fingerprint);
  cacheHit.push(sample.verdictMs);
  console.log(
    "  getDeviceId " +
      String(idDelay).padStart(5) +
      "ms → 结论 " +
      sample.activated +
      "，延迟 " +
      sample.verdictMs.toFixed(0) +
      "ms",
  );
}
const worst = Math.max(...cacheHit);
if (worst < 200) {
  console.log(
    "GREEN：缓存命中时结论延迟 " +
      worst.toFixed(0) +
      "ms，与 getDeviceId 延迟无关",
  );
  process.exit(0);
} else {
  console.log(
    "RED：缓存命中后结论仍要等 getDeviceId（最差 " + worst.toFixed(0) + "ms）",
  );
  process.exit(1);
}
