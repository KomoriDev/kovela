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
      if (sendFailure) {
        options.fail(...sendFailure);
        return;
      }
      options.success();
    },
  };
  // 非空时每次发送都以这组参数走 fail(data, code)。
  let sendFailure = null;
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
    failSend(...args) {
      sendFailure = args.length ? args : null;
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
  const activation = createActivation(PRODUCT, env.ports);
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
  assert.equal(done.ready, true, "本机记录直接出结论（启动不做判定）");
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

test("没有标记的旧记录同样直接生效：启动不做任何判定", () => {
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  // 1.0.8 之前的记录只有 token/device。历史版本写这些记录时也只发生在
  // 激活握手成功之后，所以启动直接采信；判定只留在激活握手那一次。
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

test("残留旧授权串的错误不会粘住：清理覆盖旧键，重试与重进都会消失", () => {
  const token = mint(deviceFingerprint(RAW_DEVICE, PRODUCT));
  const { env, activation, latest } = start({ token });
  env.serveStorage();
  assert.match(latest().error, /重新激活/);
  env.serveSets();
  assert.equal(env.sets(LEGACY_TOKEN_KEY).at(-1).value, "", "旧授权串键也被清空");
  assert.equal(env.sets(LEGACY_DEVICE_KEY).at(-1).value, "");

  // 测试存储不回放写入：重读仍会碰到同一份残留，相当于清理还没落地。
  // 重试（激活页 onShow / 重试按钮）后错误也必须消失。
  activation.retry();
  env.serveStorage();
  assert.equal(latest().ready, true);
  assert.equal(latest().activated, false);
  assert.equal(latest().error, "", "清理尚未落地时也只提示一次，不再反复上屏");
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
  assert.equal(
    env.pending.info.length,
    0,
    "机型名不与指纹并发：真机设备服务同一刻只应有一个在途请求",
  );
  assert.equal(env.sent.length, 0, "指纹未就绪不回执");

  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  const reply = env.sent[env.sent.length - 1];
  assert.equal(reply.type, "device");
  assert.equal(reply.id, HELLO_ID);
  assert.equal(reply.activated, false);
  assert.equal(reply.deviceId, deviceFingerprint(RAW_DEVICE, PRODUCT));
  assert.equal(reply.deviceModel, undefined, "回执不等机型，先发出去");
  assert.equal(env.pending.info.length, 1, "回执发出后才补读机型");
  env.pending.info.shift().success({ brand: "Xiaomi", model: "Band 10" });
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

test("回执发送失败时上屏固件错误码与原文，链路恢复后提示自动撤掉", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  activation.retry();
  env.serveStorage();
  env.failSend("CONNECT_TIMEOUT", 204);
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  for (let i = 0; i < 3; i += 1) t.mock.timers.tick(300);
  assert.equal(env.sent.length, 4, "首发加 3 次快重试");
  const failed = latest();
  assert.equal(failed.connected, false);
  assert.equal(
    failed.error,
    "回执发送失败（204 连接超时：CONNECT_TIMEOUT），请保持 AstroBox 在前台、手环靠近手机后重试",
  );

  env.failSend();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  assert.equal(latest().connected, true);
  assert.equal(latest().error, "", "下一次发送成功即撤掉发送失败提示");
});

test("发送失败文本兼容官方示例的 {data, code} 形态与异常对象", async () => {
  const { sendFailureText } = await import("../src/index.js");
  assert.equal(
    sendFailureText({ data: "link lost", code: 1006 }),
    "回执发送失败（1006 连接断开：link lost），请重新连接手环后在 AstroBox 重试",
  );
  assert.equal(
    sendFailureText(new Error("boom")),
    "回执发送失败（boom），请在 AstroBox 重试",
  );
  assert.equal(sendFailureText(undefined, 999), "回执发送失败（999），请在 AstroBox 重试");
  assert.equal(sendFailureText(), "回执发送失败，请在 AstroBox 重试");
  assert.match(sendFailureText("x".repeat(100), 204), /x{40}…）/, "原文截断，手环屏幕放得下");
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
  assert.equal(env.pending.set.length, 1, "就绪后同一安装包直接解读落盘");
  assert.equal(env.pending.set[0].key, LICENSE_KEY, "一次写完整 v2 记录");
  env.pending.set.shift().success();
  assert.equal(latest().activated, true);
  assert.equal(env.sets(LEGACY_TOKEN_KEY).length, 0, "不再写旧授权串键，免得中途中断留下残留");
  assert.equal(env.sets().length, 1);
  assert.deepEqual(JSON.parse(env.sets()[0].value), {
    token: licenseToken,
    device: deviceFingerprint(RAW_DEVICE, PRODUCT),
    licenseId,
  });
  const finalReceipt = env.sent[env.sent.length - 1];
  assert.equal(finalReceipt.type, "activation-result");
  assert.equal(finalReceipt.success, true);
});

test("激活判定只解读令牌：签名不校验，绑定不匹配仍然拒绝", () => {
  // 手环侧已放弃验签（见 README「激活链路的等待时间」）。这条用例固定住新
  // 契约：结构合法、产品与设备绑定一致的令牌就生效，无论签名来自谁；绑定
  // 换了设备或商品则照旧回 INVALID_LICENSE。
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const licenseId = "license-0000000001";
  const forged =
    "KV1." +
    Buffer.from(
      JSON.stringify({
        v: 1,
        licenseId,
        productId: PRODUCT,
        deviceId: fingerprint,
        issuedAt: 1790000000000,
      }),
      "ascii",
    ).toString("base64url") +
    "." +
    Buffer.alloc(64, 9).toString("base64url");

  const accepted = start({ token: "" });
  accepted.env.serveStorage();
  accepted.activation.retry();
  accepted.env.serveStorage();
  accepted.env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken: forged,
    },
  });
  assert.equal(accepted.env.pending.id.length, 1, "先按需读指纹");
  accepted.env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  // 第一份安装包只拿到 NOT_READY：插件按轮次重发，重发即落盘。
  accepted.env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken: forged,
    },
  });
  assert.equal(accepted.env.pending.set.length, 1, "指纹就绪即落盘");
  accepted.env.pending.set.shift().success();
  assert.equal(accepted.latest().activated, true);
  assert.equal(accepted.env.sent[accepted.env.sent.length - 1].success, true);

  const mismatched = start({ token: "" });
  mismatched.env.serveStorage();
  mismatched.activation.retry();
  mismatched.env.serveStorage();
  mismatched.env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken: forged,
    },
  });
  mismatched.env.pending.id.shift().success({ deviceId: "another-raw-device" });
  mismatched.env.connection.onmessage({
    data: {
      v: 1,
      id: HELLO_ID,
      type: "install-license",
      licenseId,
      licenseToken: forged,
    },
  });
  assert.equal(mismatched.env.pending.set.length, 0, "绑定不匹配不落盘");
  const rejection = mismatched.env.sent[mismatched.env.sent.length - 1];
  assert.equal(rejection.success, false);
  assert.equal(rejection.error, "INVALID_LICENSE");
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

test("本机已激活时回执发送失败不上屏：手环已激活，插件会重发安装包补回执", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fingerprint = deviceFingerprint(RAW_DEVICE, PRODUCT);
  const token = mint(fingerprint);
  const licenseId = "license-0000000001";
  const { env, activation, latest } = start({
    record: { token, device: fingerprint, licenseId },
  });
  env.serveStorage();
  activation.retry();
  env.failSend({ data: "CONNECT_TIMEOUT", code: 204 });
  env.connection.onmessage({
    data: { v: 1, id: HELLO_ID, type: "install-license", licenseId, licenseToken: token },
  });
  for (let i = 0; i < 3; i += 1) t.mock.timers.tick(300);
  assert.equal(env.sent.length, 4, "重复安装包的同步回执：首发加 3 次快重试");
  assert.equal(latest().activated, true);
  assert.equal(latest().error, "", "已激活的屏幕上不挂回执失败");
});

test("旧重试链迟到的失败不覆盖更晚一次成功的发送", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  activation.retry();
  env.serveStorage();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  env.failSend({ data: "CONNECT_TIMEOUT", code: 204 });
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  // 旧回复还在重试中，插件重发的 hello 得到一次成功的回复。
  env.failSend();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  env.failSend({ data: "CONNECT_TIMEOUT", code: 204 });
  for (let i = 0; i < 3; i += 1) t.mock.timers.tick(300);
  assert.equal(latest().error, "", "更新的发送已送达，旧链失败不再上屏");
});

test("固件只给 {data, code} 一个参数时也能显示错误码", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { env, activation, latest } = start({ token: "" });
  env.serveStorage();
  activation.retry();
  env.serveStorage();
  env.failSend({ data: "CONNECT_TIMEOUT", code: 204 });
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  for (let i = 0; i < 3; i += 1) t.mock.timers.tick(300);
  assert.match(latest().error, /^回执发送失败（204 连接超时：CONNECT_TIMEOUT）/);
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

test("结论未出时收到的 hello 先记账，结论一出立即回执", () => {
  const { env, activation } = start({ token: "" });
  // 读链路尚未兑现：ready 仍为 false，此时插件通常已经在发 hello。
  activation.retry();
  env.connection.onmessage({ data: { v: 1, id: HELLO_ID, type: "hello" } });
  assert.equal(env.sent.length, 0, "结论未出先不回执");
  env.serveStorage();
  assert.equal(env.pending.id.length, 1, "结论一出立刻按需读指纹");
  env.pending.id.shift().success({ deviceId: RAW_DEVICE });
  const reply = env.sent[env.sent.length - 1];
  assert.equal(reply.type, "device");
  assert.equal(reply.id, HELLO_ID, "用记账的那条 hello 回执，插件不必再等一轮重发");
  assert.equal(reply.deviceId, deviceFingerprint(RAW_DEVICE, PRODUCT));
  assert.equal(reply.activated, false);
});

test("读链卡死超过 1.5 秒后 retry() 放弃在途读链重来", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { env, activation, latest } = start({ token: "" });
  assert.equal(env.pending.get.length, 1);
  // 健康但在途的读取不打断：同时压两条存储请求会丢回调。
  activation.retry();
  assert.equal(env.pending.get.length, 1);
  t.mock.timers.tick(1600);
  env.dropPending();
  activation.retry();
  assert.equal(env.pending.get.length, 1, "在途超过 1.5 秒就放弃重读");
  env.serveStorage();
  assert.equal(latest().ready, true, "重读后照样出结论");
  assert.equal(latest().error, "");
});
