import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { createWorker, type Env } from "../src/index";
import type { AfdianOrder } from "@kovela/afdian";
import type { ProductConfig } from "@kovela/protocol";
import { verifyLicense } from "@kovela/license";
import { issueOfflineLicense } from "../../../scripts/issue-offline.mjs";

// 型号（付费档位）：斗地主一件商品三个型号——普通版、联机版、普通版升级联机版。
const issuer = generateKeyPairSync("ed25519");
const seed = issuer.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex");
const publicKey = issuer.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const providerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const buyer = "b".repeat(32);
const other = "d".repeat(32);
const plan = "c".repeat(32);
const plainPlan = "e".repeat(32);
const landlord: ProductConfig = {
  productId: "com.komoridev.landlord",
  productName: "斗地主",
  purchaseUrl: "",
  planIds: [plan],
  skuIds: [],
  editions: [
    { id: "standard", name: "普通版", skuIds: [], skuNames: ["普通版"] },
    {
      id: "online",
      name: "联机版",
      skuIds: ["sku-online"],
      skuNames: ["联机版"],
      upgradeSkuIds: [],
      upgradeSkuNames: ["普通版升级联机版"],
    },
  ],
};
const billiard: ProductConfig = {
  productId: "com.komoridev.billiard",
  productName: "口袋台球",
  purchaseUrl: "",
  planIds: [plainPlan],
  skuIds: [],
};
const products = [billiard, landlord];

let serial = 0;
const orders: Record<string, AfdianOrder> = {};
function order(user: string, sku: { sku_id: string; count: number; name?: string }[], planId = plan) {
  const orderNo = "2026111512345678901234" + String(10000 + serial++);
  orders[orderNo] = { out_trade_no: orderNo, user_id: user, plan_id: planId, total_amount: "3.00", status: 2, sku_detail: sku };
  return orderNo;
}
// 名称带首尾空白、按 sku_id 命中但名称已改、数量为 0、不认识的型号。
const standardNo = order(buyer, [{ sku_id: "sku-x1", count: 1, name: " 普通版 " }]);
const standardNo2 = order(buyer, [{ sku_id: "sku-x1", count: 1, name: "普通版" }]);
const onlineByIdNo = order(buyer, [{ sku_id: "sku-online", count: 1, name: "联机版（旧名）" }]);
const upgradeNo = order(buyer, [{ sku_id: "sku-x3", count: 1, name: "普通版升级联机版" }]);
const zeroCountNo = order(buyer, [{ sku_id: "sku-online", count: 0, name: "联机版" }]);
const strangerNo = order(buyer, [{ sku_id: "sku-x9", count: 1, name: "豪华版" }]);
const bundleNo = order(buyer, [
  { sku_id: "sku-x1", count: 1, name: "普通版" },
  { sku_id: "sku-x3", count: 1, name: "普通版升级联机版" },
]);
const plainNo = order(buyer, [], plainPlan);
const accountStandardNo = order(other, [{ sku_id: "sku-x1", count: 1, name: "普通版" }]);
const accountUpgradeNo = order(other, [{ sku_id: "sku-x3", count: 1, name: "普通版升级联机版" }]);

function payloadOf(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("ascii"));
}

async function migrateAll(db: D1Database) {
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((item) => item.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(name, directory), "utf8");
    await db.batch(sql.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
  }
}

async function fixture(t: TestContext, queryOrder: (orderNo: string) => unknown = (orderNo) => orders[orderNo]) {
  const platform = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  t.after(() => platform.dispose());
  const db = platform.env.DB;
  await migrateAll(db);
  const messages: { recipient: string; content: string }[] = [];
  const env: Env = {
    DB: db,
    PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    DEV_MODE: "true",
    PRODUCTS: products,
    AFDIAN_USER_ID: "a".repeat(32),
    AFDIAN_TOKEN: "provider-token",
    LICENSE_SIGNING_SEED: seed,
    WEBHOOK_TOKEN: "w".repeat(32),
    ADMIN_KEY: "f".repeat(64),
    AFDIAN_WEBHOOK_PUBLIC_KEY: providerKey.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
  const worker = createWorker(async (input, init) => {
    const params = JSON.parse(JSON.parse(String(init?.body)).params);
    if (String(input).endsWith("/query-order")) {
      const found = queryOrder(params.out_trade_no);
      return Response.json({ ec: 200, data: { list: found ? [found] : [] } });
    }
    messages.push({ recipient: params.recipient, content: params.content });
    return Response.json({ ec: 200, data: {} });
  });
  // 每个请求换一个来源 IP，免得按 IP 的查单限流打断长流程。
  let ip = 0;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(env.PUBLIC_ORIGIN + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": `192.0.2.${++ip % 250}`, ...headers },
        body: JSON.stringify(body),
      }),
      env,
    );
  const ok = async (path: string, body: unknown, headers?: Record<string, string>) => {
    const response = await post(path, body, headers);
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  const rejected = async (path: string, body: unknown, status: number, code: string) => {
    const response = await post(path, body);
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    assert.equal(value.error.code, code, JSON.stringify(value));
    return value.error.message as string;
  };
  // 订单号激活一次：查询订单拿凭证，再签发。
  let request = 0;
  const lookup = async (orderNo: string, productId = landlord.productId) => {
    const found = await ok("/api/orders/lookup", { orderNo });
    const item = found.items.find((entry: { productId: string }) => entry.productId === productId);
    assert.ok(item, JSON.stringify(found));
    return item;
  };
  const activateBody = (item: { handoffToken: string }, deviceId: string, productId = landlord.productId) => ({
    handoffToken: item.handoffToken,
    productId,
    deviceId,
    requestId: "edition-request-" + String(++request).padStart(8, "0"),
  });
  return { db, env, worker, post, ok, rejected, lookup, activateBody, messages };
}

test("型号配置校验：不合规的 editions 让商品目录整体不可用", async (t) => {
  const { env, worker } = await fixture(t);
  const config = () => worker.fetch(new Request(env.PUBLIC_ORIGIN + "/api/config"), env);
  assert.equal((await config()).status, 200);
  const [standard, online] = landlord.editions!;
  for (const editions of [
    [],
    [{ ...standard, upgradeSkuNames: ["升级"] }, online],
    [{ ...standard, id: "Standard" }, online],
    [{ ...standard, id: "1st" }, online],
    [standard, { ...online, id: "standard" }],
    [{ ...standard, name: " " }, online],
    [{ ...standard, name: "普".repeat(21) }, online],
    [{ ...standard, skuNames: [""] }, online],
    [{ ...standard, skuNames: ["名".repeat(41)] }, online],
    [{ ...standard, skuNames: [3] }, online],
    [{ ...standard, skuIds: ["bad id"] }, online],
    [standard, { ...online, upgradeSkuIds: "sku" }],
    [{ id: "empty", name: "空" }, online],
    "standard",
  ]) {
    env.PRODUCTS = [billiard, { ...landlord, editions } as unknown as ProductConfig];
    const response = await config();
    assert.equal(response.status, 503, JSON.stringify(editions));
    assert.equal((await response.json()).error.code, "NOT_CONFIGURED");
  }
  // 配置写成 JSON 字符串（wrangler vars 的另一种形态）同样可用。
  env.PRODUCTS = JSON.stringify(products);
  assert.equal((await config()).status, 200);
});

test("型号按 SKU 名称或 sku_id 匹配，型号写进签名许可证，没有型号的商品不变", async (t) => {
  const { db, ok, post, lookup, activateBody, messages } = await fixture(t);
  const device = "1".repeat(64);
  // 名称匹配会去掉首尾空白。
  const standard = await lookup(standardNo);
  assert.equal(standard.productName, "斗地主（普通版）");
  const issued = await ok("/api/activate", activateBody(standard, device));
  const payload = verifyLicense(issued.licenseToken, publicKey, landlord.productId, device);
  assert.equal(payload?.licenseId, issued.licenseId);
  assert.equal(payload?.edition, "standard");
  assert.deepEqual(
    await db.prepare("SELECT edition,upgrade,product_name FROM entitlements WHERE license_id=?").bind(issued.licenseId).first(),
    { edition: "standard", upgrade: 0, product_name: "斗地主（普通版）" },
  );
  assert.ok(messages.some((message) => message.content.includes("感谢您购买 斗地主（普通版）")));

  // sku_id 命中时不看名称（名称在爱发电改过也不影响）。
  const online = await lookup(onlineByIdNo);
  assert.equal(online.productName, "斗地主（联机版）");
  const device2 = "2".repeat(64);
  const onlineIssued = await ok("/api/activate", activateBody(online, device2));
  assert.equal(verifyLicense(onlineIssued.licenseToken, publicKey, landlord.productId, device2)?.edition, "online");

  // 基础版和升级包同一单买：基础就在这单里，是普通的联机版授权。
  const bundle = await lookup(bundleNo);
  assert.equal(bundle.productName, "斗地主（联机版）");
  const device3 = "3".repeat(64);
  const bundleIssued = await ok("/api/activate", activateBody(bundle, device3));
  assert.equal(payloadOf(bundleIssued.licenseToken).edition, "online");
  assert.equal(
    await db.prepare("SELECT upgrade FROM entitlements WHERE license_id=?").bind(bundleIssued.licenseId).first("upgrade"),
    0,
  );

  // 没命中任何型号（数量为 0、不认识的型号名）就不算买了这件商品。
  for (const orderNo of [zeroCountNo, strangerNo]) {
    const response = await post("/api/orders/lookup", { orderNo });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "ORDER_NOT_ELIGIBLE");
  }

  // 没有型号的商品：许可证载荷里没有 edition 键，商品名不带括号。
  const plain = await lookup(plainNo, billiard.productId);
  assert.equal(plain.productName, "口袋台球");
  const plainIssued = await ok("/api/activate", activateBody(plain, device, billiard.productId));
  assert.ok(!("edition" in payloadOf(plainIssued.licenseToken)));
  assert.equal(verifyLicense(plainIssued.licenseToken, publicKey, billiard.productId, device)?.licenseId, plainIssued.licenseId);
  assert.equal(
    await db.prepare("SELECT edition FROM entitlements WHERE license_id=?").bind(plainIssued.licenseId).first("edition"),
    null,
  );
});

test("升级订单要求设备先有普通版；已有更高型号时拒绝降级，同一授权重发照常", async (t) => {
  const { ok, rejected, lookup, activateBody, messages } = await fixture(t);
  const device = "4".repeat(64);
  const upgrade = await lookup(upgradeNo);
  assert.equal(upgrade.productName, "斗地主（联机版）");
  const guide = messages.find((message) => message.content.includes(upgradeNo))!.content;
  assert.match(guide, /斗地主（联机版）为升级订单：请在已激活普通版的同一台手环上激活/);

  const upgradeRequest = activateBody(upgrade, device);
  const message = await rejected("/api/activate", upgradeRequest, 409, "UPGRADE_REQUIRES_BASE");
  assert.equal(message, "升级型号需要这台设备先激活普通版，请先用普通版订单激活");

  // 先激活普通版，再用同一个（未被占用的）激活凭证重试升级。
  const standard = await lookup(standardNo);
  const standardRequest = activateBody(standard, device);
  const standardIssued = await ok("/api/activate", standardRequest);
  assert.equal(payloadOf(standardIssued.licenseToken).edition, "standard");
  const upgraded = await ok("/api/activate", { ...upgradeRequest, requestId: "edition-upgrade-retry-0001" });
  assert.equal(verifyLicense(upgraded.licenseToken, publicKey, landlord.productId, device)?.edition, "online");
  assert.notEqual(upgraded.licenseId, standardIssued.licenseId);

  // 激活回执私信里的商品名带型号。
  await ok("/api/activation/report", {
    receiptToken: upgraded.receiptToken,
    requestId: "edition-upgrade-retry-0001",
    licenseId: upgraded.licenseId,
    deviceId: device,
    result: "activated",
  });
  assert.ok(messages.some((item) => item.content.includes("你已成功激活 斗地主（联机版）")));

  // 同一升级授权对同一设备重发：返回原许可证。
  const again = await lookup(upgradeNo);
  assert.equal(again.boundDeviceId, device);
  assert.equal((await ok("/api/activate", activateBody(again, device))).licenseToken, upgraded.licenseToken);

  // 防降级：已持有联机版的设备不再签发普通版——新的普通版订单和原来那份都不行，
  // 手环只存一份许可证，装上普通版会把联机版覆盖掉。
  const downgrade = await rejected("/api/activate", activateBody(await lookup(standardNo2), device), 409, "EDITION_DOWNGRADE");
  assert.equal(downgrade, "这台设备已激活更高版本（联机版），无需再激活普通版");
  await rejected("/api/activate", activateBody(await lookup(standardNo), device), 409, "EDITION_DOWNGRADE");

  // 普通版订单仍可以激活别的设备；升级订单已绑定这台设备。
  const otherDevice = "5".repeat(64);
  assert.equal(payloadOf((await ok("/api/activate", activateBody(await lookup(standardNo2), otherDevice))).licenseToken).edition, "standard");
  await rejected("/api/activate", activateBody(await lookup(upgradeNo), otherDevice), 409, "DEVICE_BOUND");
});

test("管理员签发与离线签发沿用同一套型号规则", async (t) => {
  const { env, worker, post, ok } = await fixture(t);
  const device = "6".repeat(64);
  const admin = (body: unknown) =>
    post("/api/admin/licenses", { v: 1, type: "kovela-offline-request", productId: landlord.productId, deviceId: device, ...(body as object) }, {
      Authorization: "Bearer " + env.ADMIN_KEY,
    });
  const refused = await admin({ orderNo: upgradeNo });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error.code, "UPGRADE_REQUIRES_BASE");

  // 离线签发脚本：经 /api/orders/lookup + /api/activate，许可证带型号，文件里的名称带型号。
  let ip = 0;
  const transport: typeof fetch = (input, init) =>
    worker.fetch(new Request(String(input), { ...init, headers: { ...init?.headers, "CF-Connecting-IP": `198.51.100.${++ip}` } }), env);
  const offline = await issueOfflineLicense(
    { v: 1, type: "kovela-offline-request", orderNo: standardNo, productId: landlord.productId, deviceId: device },
    { origin: env.PUBLIC_ORIGIN, transport, verificationKey: publicKey },
  );
  assert.equal(offline.productName, "斗地主（普通版）");
  assert.equal(verifyLicense(offline.licenseToken, publicKey, landlord.productId, device)?.edition, "standard");

  const upgraded = await admin({ orderNo: upgradeNo });
  const license = await upgraded.json();
  assert.equal(upgraded.status, 200, JSON.stringify(license));
  assert.equal(license.productName, "斗地主（联机版）");
  assert.equal(verifyLicense(license.licenseToken, publicKey, landlord.productId, device)?.edition, "online");
  assert.equal((await (await admin({ orderNo: upgradeNo })).json()).licenseToken, license.licenseToken);
  const downgrade = await admin({ orderNo: standardNo2 });
  assert.equal(downgrade.status, 409);
  assert.equal((await downgrade.json()).error.code, "EDITION_DOWNGRADE");
  await ok("/api/orders/lookup", { orderNo: plainNo });
});

test("账号激活优先高型号：没有基础版时退回普通版订单，有了再用升级订单", async (t) => {
  const { ok, post, lookup } = await fixture(t);
  // 订单先入库（正常路径是 Webhook，这里用查询订单落库）。
  await lookup(accountStandardNo);
  await lookup(accountUpgradeNo);
  const listed = await ok("/api/account/products", { afdianUserId: other });
  assert.deepEqual(listed.items, [{ productId: landlord.productId, productName: "斗地主（联机版）", boundDeviceId: null }]);

  const device = "7".repeat(64);
  let request = 0;
  const activate = (deviceId: string) =>
    post("/api/account/activate", {
      afdianUserId: other,
      productId: landlord.productId,
      deviceId,
      requestId: "account-edition-request-" + String(++request).padStart(4, "0"),
    });
  // 新设备：升级订单缺基础版被跳过，签发普通版。
  const first = await (await activate(device)).json();
  assert.equal(first.productName, "斗地主（普通版）", JSON.stringify(first));
  assert.equal(payloadOf(first.licenseToken).edition, "standard");
  // 同一设备再来一次：这回升级订单可用，拿到联机版。
  const second = await (await activate(device)).json();
  assert.equal(second.productName, "斗地主（联机版）", JSON.stringify(second));
  assert.equal(verifyLicense(second.licenseToken, publicKey, landlord.productId, device)?.edition, "online");
  // 再来：已绑定本机的联机版重发，普通版因防降级被跳过。
  const third = await (await activate(device)).json();
  assert.equal(third.licenseToken, second.licenseToken);
  // 两份订单都绑在这台设备上，别的设备没有可用订单。
  const elsewhere = await activate("8".repeat(64));
  assert.equal(elsewhere.status, 404);
  assert.equal((await elsewhere.json()).error.code, "ACCOUNT_NOT_ELIGIBLE");

  // 只买了升级包的账号：如实告诉买家要先激活普通版，而不是「没有可用授权」。
  const lonely = "9".repeat(32);
  const lonelyNo = order(lonely, [{ sku_id: "sku-x3", count: 1, name: "普通版升级联机版" }]);
  await lookup(lonelyNo);
  const blocked = await post("/api/account/activate", {
    afdianUserId: lonely,
    productId: landlord.productId,
    deviceId: "b".repeat(64),
    requestId: "account-edition-lonely-0001",
  });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "UPGRADE_REQUIRES_BASE");
  // 已持有联机版的设备再用升级包：没必要，如实拒绝，保留这份订单。
  const redundant = await post("/api/account/activate", {
    afdianUserId: lonely,
    productId: landlord.productId,
    deviceId: device,
    requestId: "account-edition-lonely-0002",
  });
  assert.equal(redundant.status, 409);
  assert.equal((await redundant.json()).error.code, "EDITION_DOWNGRADE");
});

test("账号同时有联机版和普通版订单时，新设备直接拿联机版", async (t) => {
  const { ok, lookup } = await fixture(t);
  await lookup(onlineByIdNo);
  await lookup(standardNo);
  const device = "a".repeat(64);
  const issued = await ok("/api/account/activate", {
    afdianUserId: buyer,
    productId: landlord.productId,
    deviceId: device,
    requestId: "account-edition-prefer-0001",
  });
  assert.equal(issued.productName, "斗地主（联机版）");
  assert.equal(payloadOf(issued.licenseToken).edition, "online");
});

test("创作者账号拿最高型号，列表名称带型号", async (t) => {
  const { env, ok } = await fixture(t);
  const listed = await ok("/api/account/products", { afdianUserId: env.AFDIAN_USER_ID });
  assert.deepEqual(
    listed.items.map((item: { productName: string }) => item.productName),
    ["口袋台球", "斗地主（联机版）"],
  );
  const device = "c".repeat(64);
  const issued = await ok("/api/account/activate", {
    afdianUserId: env.AFDIAN_USER_ID,
    productId: landlord.productId,
    deviceId: device,
    requestId: "creator-edition-request-01",
  });
  assert.equal(issued.productName, "斗地主（联机版）");
  assert.equal(verifyLicense(issued.licenseToken, publicKey, landlord.productId, device)?.edition, "online");
  const plain = await ok("/api/account/activate", {
    afdianUserId: env.AFDIAN_USER_ID,
    productId: billiard.productId,
    deviceId: device,
    requestId: "creator-edition-request-02",
  });
  assert.ok(!("edition" in payloadOf(plain.licenseToken)));
});

test("Webhook 查不到订单时，型号商品等查到再落库（推送里的型号不受签名保护）", async (t) => {
  const { env, post, messages } = await fixture(t, () => null);
  const paid = orders[onlineByIdNo];
  const response = await post("/api/webhooks/afdian?token=" + env.WEBHOOK_TOKEN, {
    ec: 200,
    data: {
      type: "order",
      order: paid,
      sign: sign("sha256", Buffer.from(paid.out_trade_no + paid.user_id + paid.plan_id + paid.total_amount), providerKey.privateKey).toString("base64"),
    },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "ORDER_NOT_FOUND");
  assert.equal(messages.length, 0);
});
