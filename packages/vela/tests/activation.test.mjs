import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { deviceFingerprint } from "@kovela/license";
import { createActivation } from "../src/index.js";

const PRODUCT = "com.example.game";
const RAW_DEVICE = "raw-device-0001";
const OTHER_RAW_DEVICE = "raw-device-9999";
const TOKEN_KEY = "kovela_license_v1";
const DEVICE_KEY = "kovela_device_v1";
const HELLO_ID = "abcdefghijklmnop";
const seed = Buffer.alloc(32, 7);
const signingKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]),
  format: "der",
  type: "pkcs8",
});
// Ed25519 SPKI 前缀固定 12 字节，去掉前缀就是裸公钥。
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

function environment(token = "", cachedDevice = "") {
  const pending = { id: [], info: [], get: [], set: [] };
  const sent = [];
  const connection = {
    onmessage: null,
    onopen: null,
    onclose: null,
    onerror: null,
    getReadyState(options) {
      options.success({ status: 1 });
    },
    send(options) {
      sent.push(options.data);
      options.success();
    },
  };
  return {
    token,
    cachedDevice,
    sent,
    pending,
    connection,
    ports: {
      device: {
        getDeviceId(options) {
          pending.id.push(options);
        },
        getInfo(options) {
          pending.info.push(options);
        },
      },
      storage: {
        get(options) {
          pending.get.push(options);
        },
        set(options) {
          pending.set.push(options);
        },
      },
      interconnect: { instance: () => connection },
    },
  };
}

function start(token, cachedDevice = "") {
  const env = environment(token, cachedDevice);
  const activation = createActivation(PRODUCT, publicKey, env.ports);
  const states = [];
  activation.subscribe((state) => states.push(state));
  activation.start();
  return { env, activation, states, latest: () => states[states.length - 1] };
}

// 按键名兑现挂起的 storage.get。
function serveStorage(env) {
  while (env.pending.get.length) {
    const request = env.pending.get.shift();
    if (request.key === TOKEN_KEY) request.success(env.token);
    else if (request.key === DEVICE_KEY) request.success(env.cachedDevice);
    else request.success("");
  }
}

function setCalls(env, key = DEVICE_KEY) {
  return env.pending.set.filter((call) => call.key === key);
}

// 两条腿的发起顺序是实现细节：这里按实际挂起的请求逐个满足。
function settle(env, token, rawDeviceId = RAW_DEVICE) {
  serveStorage(env);
  for (let pass = 0; pass < 4; pass += 1) {
    if (env.pending.info.length) env.pending.info.shift().success({});
    if (env.pending.id.length)
      env.pending.id.shift().success({ deviceId: rawDeviceId });
  }
}

test("本地授权先发布，校验结论等设备标识一起回来", () => {
  const token = mint(deviceFingerprint(RAW_DEVICE, PRODUCT));
  const { env, activation, latest } = start(token);
  assert.equal(env.pending.get.length, 2, "授权串与设备缓存并行读取");
  assert.equal(
    env.pending.id.length,
    1,
    "getDeviceId 立刻发起，不排在存储之后",
  );

  env.pending.get.shift().success(token);
  const early = latest();
  assert.equal(early.licensed, true, "存储回来就先标记本机有授权");
  assert.equal(early.ready, false, "设备标识未到，还不能给结论");
  assert.equal(early.activated, false);
  assert.equal(activation.isActivated(), false);

  env.pending.get.shift().success("");
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  const done = latest();
  assert.equal(done.ready, true);
  assert.equal(done.activated, true);
  assert.equal(activation.isActivated(), true);
});

test("机型名读取慢不拖住授权结论，仍会补进插件回执", () => {
  const token = mint(deviceFingerprint(RAW_DEVICE, PRODUCT));
  const { env, latest } = start(token);
  assert.equal(env.pending.info.length, 1, "getInfo 与另外两条腿并发");

  serveStorage(env);
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  assert.equal(latest().ready, true, "getInfo 未回调也要出结论");
  assert.equal(latest().activated, true);

  env.pending.info.shift().success({ brand: "Xiaomi", model: "Band 10" });
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  const reply = env.sent[env.sent.length - 1];
  assert.equal(reply.type, "device");
  assert.equal(reply.activated, true);
  assert.equal(reply.deviceModel, "Xiaomi Band 10");
});

test("设备标识读取失败也结束等待，并允许整轮重来", () => {
  const { env, activation, latest } = start("");
  serveStorage(env);
  assert.equal(latest().ready, false, "只差设备标识时继续等");

  env.pending.id.shift().fail();
  const failed = latest();
  assert.equal(failed.ready, true, "失败也是结论，界面不该一直停在读取中");
  assert.equal(failed.activated, false);
  assert.match(failed.error, /设备标识/);

  activation.refresh();
  assert.equal(env.pending.id.length, 1, "失败后可以重新校验");
  assert.equal(env.pending.get.length, 2);
});

test("绑定到别的设备的授权不会通过", () => {
  const token = mint(deviceFingerprint("another-device", PRODUCT));
  const { env, latest } = start(token);
  settle(env, token);
  const state = latest();
  assert.equal(state.ready, true);
  assert.equal(state.licensed, true, "本机确实存着授权串");
  assert.equal(state.activated, false);
  assert.match(state.error, /本地授权无效/);
});

test("本地没有授权时给出未激活结论", () => {
  const { env, latest } = start("");
  settle(env, "");
  const state = latest();
  assert.equal(state.ready, true);
  assert.equal(state.licensed, false);
  assert.equal(state.activated, false);
  assert.equal(state.error, "");
});

test("首次用真实设备标识验证通过后，把设备指纹落盘", () => {
  const token = mint(deviceFingerprint(RAW_DEVICE, PRODUCT));
  const { env, latest } = start(token);
  settle(env, token);
  assert.equal(latest().activated, true);
  const writes = setCalls(env);
  assert.equal(writes.length, 1, "验证通过后写一次设备缓存");
  assert.equal(
    writes[0].value,
    deviceFingerprint(RAW_DEVICE, PRODUCT),
    "缓存的是本机真实指纹",
  );
});

test("缓存命中：结论不等设备标识，真实标识回来后仅复核", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const { env, latest } = start(token, fingerprint);
  serveStorage(env);
  const done = latest();
  assert.equal(done.ready, true, "缓存指纹直接验签出结论");
  assert.equal(done.activated, true);
  assert.equal(done.deviceId, fingerprint, "回执先用缓存指纹");
  assert.equal(env.pending.id.length, 1, "真实设备标识仍会发起复核");
  assert.equal(setCalls(env).length, 0, "缓存命中不再写盘");

  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  assert.equal(latest().activated, true, "复核一致，结论不变");
  assert.equal(latest().error, "");
  assert.equal(latest().deviceId, fingerprint);
});

test("缓存指向别的设备：复核不过就撤销授权并清缓存", () => {
  // 授权串与缓存都来自设备 A（整体拷贝的场景），本机是 B。
  const copiedFingerprint = deviceFingerprint("device-a", PRODUCT);
  const token = mint(copiedFingerprint);
  const { env, latest } = start(token, copiedFingerprint);
  serveStorage(env);
  assert.equal(latest().activated, true, "存储层面看不出问题");

  env.pending.id.shift().success({ deviceId: OTHER_RAW_DEVICE });
  const revoked = latest();
  assert.equal(revoked.activated, false, "复核失败撤销授权");
  assert.match(revoked.error, /本地授权无效/);
  assert.equal(revoked.deviceId, deviceFingerprint(OTHER_RAW_DEVICE, PRODUCT));
  const writes = setCalls(env);
  assert.equal(writes.length, 1, "撤销时清掉设备缓存");
  assert.equal(writes[0].value, "");
});

test("缓存过期但授权属于本机：按真实标识自愈并重写缓存", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const { env, latest } = start(token, deviceFingerprint("stale", PRODUCT));
  serveStorage(env);
  assert.equal(latest().ready, false, "缓存对不上号就退回慢路径");

  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  const done = latest();
  assert.equal(done.ready, true);
  assert.equal(done.activated, true);
  const writes = setCalls(env);
  assert.equal(writes.length, 1, "自愈时重写设备缓存");
  assert.equal(writes[0].value, fingerprint);
});

test("插件下发安装包成功后同样落盘设备指纹", () => {
  const { env } = start("");
  settle(env, "");
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const licenseId = "license-0000000001";
  env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken: mint(fingerprint, licenseId),
    },
  });
  assert.equal(env.pending.set.length, 1, "先落授权串");
  env.pending.set.shift().success();
  assert.equal(setCalls(env).length, 1, "授权串落盘后写设备缓存");
  assert.equal(setCalls(env)[0].value, fingerprint);
});
