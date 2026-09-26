// 计时反馈回路：启动时授权结论（ready）的延迟。
// 用法：node tests/latency.bench.mjs
// 判据：无论本机有没有授权记录，启动结论都只取决于 storage.get（串行
// 1–3 次）加纯 CPU 验签，与 device.getDeviceId 的响应速度完全无关——
// 真机上它被拥堵拖到半分钟也不该影响启动。设备服务一旦在启动链路里
// 被调用，这里的假端口会直接抛错。
import { performance } from "node:perf_hooks";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { deviceFingerprint, verifyLicense } from "@kovela/license";
import { createActivation } from "../src/index.js";

const PRODUCT = "com.example.game";
const RAW_DEVICE = "raw-device-0001";
const LICENSE_KEY = "kovela_license_v2";
const LEGACY_TOKEN_KEY = "kovela_license_v1";
const LEGACY_DEVICE_KEY = "kovela_device_v1";
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

function runOnce(storageDelayMs, files) {
  return new Promise((resolve) => {
    let readyAt = 0;
    let startedAt = 0;
    let busy = false;
    const activation = createActivation(PRODUCT, publicKey, {
      device: {
        getDeviceId() {
          throw new Error("启动链路不允许调用 getDeviceId");
        },
        getInfo() {
          throw new Error("启动链路不允许调用 getInfo");
        },
      },
      storage: {
        get(options) {
          if (busy) throw new Error("存储请求必须串行");
          busy = true;
          setTimeout(() => {
            busy = false;
            options.success(
              files.has(options.key) ? files.get(options.key) : "",
            );
          }, storageDelayMs);
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

const STORAGE = 5;
const scenarios = [
  ["本机无授权（未激活结论也应立即可得）", new Map(), false],
  [
    "旧版迁移（v1 授权串+指纹缓存，3 次串行读取）",
    new Map([
      [LEGACY_TOKEN_KEY, token],
      [LEGACY_DEVICE_KEY, fingerprint],
    ]),
    true,
  ],
  [
    // 启动路径：只读一次本机记录，不跑验签（签名只在激活握手验一次）。
    "v2 记录命中（1 次读取，不验签）",
    new Map([[LICENSE_KEY, JSON.stringify({ token, device: fingerprint })]]),
    true,
  ],
];

let worst = 0;
for (const [title, files, expectActivated] of scenarios) {
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    const sample = await runOnce(STORAGE, files);
    if (expectActivated !== null && sample.activated !== expectActivated) {
      console.log("RED：" + title + " 结论 activated=" + sample.activated);
      process.exit(1);
    }
    samples.push(sample.verdictMs);
  }
  const slowest = Math.max(...samples);
  if (expectActivated) worst = Math.max(worst, slowest);
  console.log(title + " → 结论延迟 " + slowest.toFixed(0) + "ms（5 次最差）");
}
if (worst < 200) {
  console.log("GREEN：启动结论与设备服务无关，最差 " + worst.toFixed(0) + "ms");
  process.exit(0);
} else {
  console.log("RED：启动结论被拖慢（最差 " + worst.toFixed(0) + "ms）");
  process.exit(1);
}
