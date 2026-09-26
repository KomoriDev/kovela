import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { deviceFingerprint } from "@kovela/license";
import { createActivation } from "../src/index.js";

const PRODUCT = "com.example.game";
const RAW_DEVICE = "raw-device-0001";
const LICENSE_KEY = "kovela_license_v2";
const LEGACY_TOKEN_KEY = "kovela_license_v1";
const LEGACY_DEVICE_KEY = "kovela_device_v1";
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

// 真机教训：存储实现同一时刻只应有一个未完成的 storage.get，并发发第二个
// 会把先发起的回调挤掉（授权串从此读不到）。这里把并发直接当错误抛出，
// 作为状态机的不变量；所有读取按键名逐个兑现。
// 启动链路只碰存储：device.getDeviceId / getInfo 只允许在激活握手与安装
// 包需要时按需出现，启动窗口里发起即失败。
function environment({ token = "", cachedDevice = "", record = null } = {}) {
  const pending = { id: [], info: [], get: [], set: [] };
  const files = new Map();
  if (token) files.set(LEGACY_TOKEN_KEY, token);
  if (cachedDevice) files.set(LEGACY_DEVICE_KEY, cachedDevice);
  if (record) files.set(LICENSE_KEY, JSON.stringify(record));
  const sent = [];
  const written = [];
  const probes = [];
  let readyStateCalls = 0;
  let probeStatus = 0;
  const connection = {
    onmessage: null,
    onopen: null,
    onclose: null,
    onerror: null,
    // 状态探测必须走带 timeout 的 diagnosis；getReadyState 没有超时参数，
    // 对端缺席时固件会让它同步等到连接超时（真机约半分钟），禁止调用。
    diagnosis(options) {
      probes.push(options);
      options.success({ status: probeStatus });
    },
    getReadyState() {
      readyStateCalls += 1;
      throw new Error("getReadyState 会无界等待，不允许调用");
    },
    send(options) {
      sent.push(options.data);
      options.success();
    },
  };
  let outstandingGets = 0;
  let instances = 0;
  const env = {
    sent,
    pending,
    connection,
    instances: () => instances,
    probes: () => probes,
    readyStateCalls: () => readyStateCalls,
    setProbeStatus(status) {
      probeStatus = status;
    },
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
          assert.equal(outstandingGets, 0, "存储请求必须串行");
          assert.equal(
            options.default,
            "",
            "与最初真机验证过的调用形态保持一致（default 非必填）",
          );
          outstandingGets += 1;
          pending.get.push(options);
        },
        set(options) {
          written.push(options);
          pending.set.push(options);
        },
      },
      interconnect: {
        instance: () => {
          instances += 1;
          return connection;
        },
      },
    },
    // 兑现一个挂起的读取，按内容映射返回；键不存在返回空串。
    serveOne() {
      const request = pending.get.shift();
      if (!request) return false;
      outstandingGets -= 1;
      request.success(files.has(request.key) ? files.get(request.key) : "");
      return true;
    },
    serveStorage() {
      while (env.serveOne()) {}
    },
    // 模拟真机把在途回调丢掉：请求不兑现，也不再算作未完成（页面侧
    // recover() 就是为这种形态准备的）。
    dropPending() {
      const request = pending.get.shift();
      if (!request) return false;
      outstandingGets -= 1;
      return true;
    },
    // 兑现所有挂起的写入（成功回调），链式写入会因此继续出现；
    // written 是永久记录，兑现后仍可断言。
    serveSets() {
      while (pending.set.length) pending.set.shift().success();
    },
    sets(key = LICENSE_KEY) {
      return written.filter((call) => call.key === key);
    },
  };
  return env;
}

function start(options) {
  const env = environment(options);
  const activation = createActivation(PRODUCT, publicKey, env.ports);
  const states = [];
  activation.subscribe((state) => states.push(state));
  activation.start();
  return { env, activation, states, latest: () => states[states.length - 1] };
}

test("存储回调丢失时看门狗兜底出结论，且允许重试", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { env, activation, latest } = start({ token: "" });
  // 故意不兑现 storage.get：模拟真机回调既不 success 也不 fail。
  assert.equal(env.pending.get.length, 1);
  t.mock.timers.tick(8000);
  const state = latest();
  assert.equal(state.ready, true, "看门狗必须给结论，界面不能永远等待");
  assert.equal(state.activated, false);
  assert.match(state.error, /超时/);

  activation.refresh();
  assert.equal(env.pending.get.length, 1, "超时释放后可以重新校验");
  env.serveStorage();
  const retried = latest();
  assert.equal(retried.ready, true);
  assert.equal(retried.error, "", "重试成功后错误清空");
});

test("读链回调丢失时页面可驱动 recover() 重读并出结论", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const { env, activation, latest } = start({
    record: { token, device: fingerprint, licenseId: "license-0000000001" },
  });
  // 第一次读取的回调在真机上丢了（既不回 success 也不回 fail）。
  assert.equal(env.pending.get.length, 1);
  assert.equal(latest().ready, false);
  env.dropPending();
  assert.equal(env.pending.get.length, 0);
  activation.recover();
  assert.equal(env.pending.get.length, 1, "放弃在途读链，重新发起读取");
  env.serveStorage();
  assert.equal(latest().ready, true);
  assert.equal(latest().activated, true);
  activation.recover();
  assert.equal(env.pending.get.length, 0, "结论已出就不再打扰");
});

test("v2 记录命中：启动只读一次存储，全程不碰设备服务", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const licenseId = "license-0000000001";
  const { env, activation, latest } = start({
    record: { token, device: fingerprint, licenseId },
  });
  env.serveStorage();
  const done = latest();
  assert.equal(done.ready, true, "本机记录直接出结论（启动不验签）");
  assert.equal(done.activated, true);
  assert.equal(done.licenseId, licenseId, "编号取自记录标记");
  assert.equal(done.deviceId, fingerprint, "回执与界面使用记录里的指纹");
  assert.equal(env.pending.get.length, 0, "读链路命中即止");
  assert.equal(env.pending.id.length, 0, "启动不发起设备标识读取");
  assert.equal(env.pending.info.length, 0, "启动不读机型名");
  assert.equal(env.sets().length, 0, "采信即结论，启动不写盘");

  // 消息通道由激活页打开（retry）建立：游戏启动不连接 interconnect。
  activation.retry();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  const reply = env.sent[env.sent.length - 1];
  assert.equal(reply.type, "device");
  assert.equal(reply.activated, true);
  assert.equal(reply.deviceId, fingerprint);
});

test("没有标记的旧记录同样直接生效：启动不做签名校验", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  // 1.0.8 之前的记录只有 token/device。写这些记录的历史版本同样是
  // "验签通过后才落盘"，所以启动直接采信；签名校验只留在激活握手。
  const { env, latest } = start({ record: { token, device: fingerprint } });
  env.serveStorage();
  const done = latest();
  assert.equal(done.ready, true);
  assert.equal(done.activated, true);
  assert.equal(done.licenseId, "", "旧记录没有编号可显示");
  assert.equal(env.sets().length, 0, "采信即结论，启动不写盘");
});
test("旧版迁移：v1 授权串与指纹缓存也能立即出结论", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const { env, latest } = start({ token, cachedDevice: fingerprint });
  env.serveStorage();
  const done = latest();
  assert.equal(done.ready, true);
  assert.equal(done.activated, true);
  assert.equal(env.pending.id.length, 0, "迁移路径同样不碰设备服务");
  const writes = env.sets();
  assert.equal(writes.length, 1, "顺手把配对写进 v2，下次少读两步");
  assert.deepEqual(JSON.parse(writes[0].value), {
    token,
    device: fingerprint,
    licenseId: "",
  });
});

test("没有授权时立即给出未激活结论，不发起任何设备调用", () => {
  const { env, latest } = start({ token: "" });
  env.serveStorage();
  const state = latest();
  assert.equal(state.ready, true);
  assert.equal(state.licensed, false);
  assert.equal(state.activated, false);
  assert.equal(state.error, "");
  assert.equal(env.pending.id.length, 0);
  assert.equal(env.pending.info.length, 0);
});

test("只有旧授权串没有配对指纹：提示重新激活", () => {
  const token = mint(deviceFingerprint(RAW_DEVICE, PRODUCT));
  const { env, latest } = start({ token });
  env.serveStorage();
  const state = latest();
  assert.equal(state.ready, true);
  assert.equal(state.activated, false);
  assert.match(state.error, /重新激活/);
  assert.equal(env.pending.id.length, 0);
});

test("hello 时按需读取设备标识，读到后再回执", () => {
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  assert.equal(latest().ready, true);
  assert.equal(env.pending.id.length, 0, "未激活的启动不发设备调用");

  activation.retry();
  env.serveStorage();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  assert.equal(latest().connected, true, "收到报文即证明对端在场");
  assert.equal(env.pending.id.length, 1, "激活握手才按需发起读取");
  assert.equal(env.pending.info.length, 1, "机型名同样此时才读");
  assert.equal(env.sent.length, 0, "指纹未就绪不回执");

  env.pending.info.shift().success({ brand: "Xiaomi", model: "Band 10" });
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  const reply = env.sent[env.sent.length - 1];
  assert.equal(reply.type, "device");
  assert.equal(reply.activated, false);
  assert.equal(reply.deviceId, deviceFingerprint(RAW_DEVICE, PRODUCT));
  assert.equal(reply.deviceModel, "Xiaomi Band 10");
});

test("设备标识读取失败不回执，错误上屏且允许下次再试", () => {
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  activation.retry();
  env.serveStorage();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  env.pending.id.shift().fail();
  assert.equal(env.sent.length, 0, "没有指纹就不回执，插件会重发 hello");
  assert.match(latest().error, /设备标识/);

  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  assert.equal(env.pending.id.length, 1, "失败后允许再次发起");
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  assert.equal(env.sent.length, 1, "读到指纹后正常回执");
});

test("安装包在指纹未就绪时回 NOT_READY，就绪后重发即可激活", () => {
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  activation.retry();
  env.serveStorage();
  const licenseId = "license-0000000001";
  const licenseToken = mint(deviceFingerprint(RAW_DEVICE, PRODUCT), licenseId);
  env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken,
    },
  });
  assert.equal(env.pending.id.length, 1, "安装包按需触发指纹读取");
  const receipt = env.sent[env.sent.length - 1];
  assert.equal(receipt.error, "NOT_READY", "未就绪先回 NOT_READY");

  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken,
    },
  });
  assert.equal(env.pending.set.length, 1, "就绪后同一安装包直接验签落盘");
  assert.equal(env.pending.set[0].key, LEGACY_TOKEN_KEY);
  env.pending.set.shift().success();
  assert.equal(latest().activated, true);
  assert.equal(env.sets().length, 1, "回执后链式补写 v2 记录");
  assert.deepEqual(JSON.parse(env.sets()[0].value), {
    token: licenseToken,
    device: deviceFingerprint(RAW_DEVICE, PRODUCT),
    licenseId,
  });
  const finalReceipt = env.sent[env.sent.length - 1];
  assert.equal(finalReceipt.type, "activation-result");
  assert.equal(finalReceipt.success, true);
});

test("同一许可证的重复安装包直接回执，不重写存储", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const licenseId = "license-0000000001";
  const { env, activation, latest } = start({
    record: { token, device: fingerprint, licenseId },
  });
  env.serveStorage();
  assert.equal(latest().activated, true);
  activation.retry();
  env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken: token,
    },
  });
  assert.equal(env.sets().length, 0, "已激活且编号一致，不写盘");
  const receipt = env.sent[env.sent.length - 1];
  assert.equal(receipt.success, true);
});

test("应用启动不碰 interconnect，激活页重试时才连接", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const { env, activation, latest } = start({
    record: { token, device: fingerprint, licenseId: "license-0000000001" },
  });
  env.serveStorage();
  assert.equal(latest().activated, true);
  assert.equal(
    env.instances(),
    0,
    "游戏启动绝不发起 interconnect 连接（对端不在时桥接层同步卡死 JS 线程）",
  );

  activation.retry();
  assert.equal(env.instances(), 1, "retry()（激活页 onShow）才连接");
  assert.equal(env.readyStateCalls(), 0, "getReadyState 会无界等待，不能调用");
  assert.equal(env.probes().length, 1, "改用带 timeout 的 diagnosis 探测");
  assert.equal(env.probes()[0].timeout, 1500, "等待封顶在 1.5 秒");
  assert.equal(latest().connected, true, "status 0 视为已连接");
});

test("对端缺席：有界探测按未连接收场，连接事件仍能修正提示", () => {
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  env.setProbeStatus(204);
  activation.retry();
  env.serveStorage();
  assert.equal(latest().connected, false);
  assert.equal(env.readyStateCalls(), 0);

  env.connection.onopen({ isReconnected: false });
  assert.equal(latest().connected, true, "onopen 才是连接的事实来源");
});

test("固件没有 diagnosis 时干脆不查状态，绝不退回无界等待", () => {
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  delete env.connection.diagnosis;
  activation.retry();
  env.serveStorage();
  assert.equal(env.readyStateCalls(), 0);
  assert.equal(latest().ready, true, "结论照常给出，状态提示交给事件");
});

test("hello 在结论未出时只触发读取，不回执", () => {
  const { env, activation } = start({ token: "" });
  // 读链路尚未兑现：ready 仍为 false。
  activation.retry();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  assert.equal(env.sent.length, 0);
  env.serveStorage();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  assert.equal(env.pending.id.length, 1, "结论已出，hello 走按需读取");
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  assert.equal(env.sent.length, 1);
});
