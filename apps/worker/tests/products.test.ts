import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { createWorker, type Env } from "../src/index";
import type { AfdianOrder } from "@kovela/afdian";
import type { ProductConfig } from "@kovela/protocol";
import { verifyLicense } from "@kovela/license";
import { signLicense } from "@kovela/license/signing";
import { issueOfflineLicense, main as issueOfflineCommand } from "../../../scripts/issue-offline.mjs";

const origin = "https://kovela.example.com";
const issuer = generateKeyPairSync("ed25519");
const seed = issuer.privateKey
  .export({ format: "der", type: "pkcs8" })
  .subarray(-32)
  .toString("hex");
const publicKey = issuer.publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");
const providerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const buyer = "b".repeat(32);
const plan = "c".repeat(32);
const products: ProductConfig[] = [
  {
    productId: "com.komoridev.tankturmoil",
    productName: "坦克动荡",
    purchaseUrl: "",
    planIds: [plan],
    skuIds: ["sku-a"],
  },
  {
    productId: "com.komoridev.reader",
    productName: "阅读器",
    purchaseUrl: "",
    planIds: [plan],
    skuIds: ["sku-b"],
  },
];
const orderNo = "202609131234567890123456789";
const bundleNo = "202609131234567890123456790";
const redeemedNo = "202609131234567890123456791";
const unpaidNo = "202609131234567890123456792";
const orders: Record<string, AfdianOrder> = {
  [orderNo]: {
    out_trade_no: orderNo,
    user_id: buyer,
    plan_id: plan,
    total_amount: "5.00",
    status: 2,
    sku_detail: [{ sku_id: "sku-a", count: 1 }],
  },
  [bundleNo]: {
    out_trade_no: bundleNo,
    user_id: buyer,
    plan_id: plan,
    total_amount: "10.00",
    status: 2,
    sku_detail: [
      { sku_id: "sku-a", count: 1 },
      { sku_id: "sku-b", count: 1 },
    ],
  },
  [redeemedNo]: {
    out_trade_no: redeemedNo,
    user_id: buyer,
    plan_id: plan,
    total_amount: "0.00",
    status: 2,
    sku_detail: [{ sku_id: "sku-a", count: 1 }],
  },
  [unpaidNo]: {
    out_trade_no: unpaidNo,
    user_id: buyer,
    plan_id: plan,
    total_amount: "0.00",
    status: 1,
    sku_detail: [{ sku_id: "sku-a", count: 1 }],
  },
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function migrate(db: D1Database, name: string) {
  const sql = await readFile(
    new URL("../migrations/" + name, import.meta.url),
    "utf8",
  );
  await db.batch(
    sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => db.prepare(part)),
  );
}

async function fixture(
  t: TestContext,
  queryOrder: (orderNo: string) => unknown = (orderNo) => orders[orderNo],
) {
  const platform = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  t.after(() => platform.dispose());
  const db = platform.env.DB;
  const messages: string[] = [];
  const env: Env = {
    DB: db,
    PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    DEV_MODE: "true",
    PRODUCTS: products,
    AFDIAN_USER_ID: "a".repeat(32),
    AFDIAN_TOKEN: "provider-token",
    LICENSE_SIGNING_SEED: seed,
    WEBHOOK_TOKEN: "w".repeat(32),
    AFDIAN_WEBHOOK_PUBLIC_KEY: providerKey.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
  };
  const worker = createWorker(async (input, init) => {
    const params = JSON.parse(JSON.parse(String(init?.body)).params);
    if (String(input).endsWith("/query-order")) {
      const order = queryOrder(params.out_trade_no);
      return Response.json({ ec: 200, data: { list: order ? [order] : [] } });
    }
    assert.ok(String(input).endsWith("/send-msg"));
    assert.equal(params.recipient, buyer);
    messages.push(params.content);
    return Response.json({ ec: 200, data: {} });
  });
  const post = (path: string, body: unknown) =>
    worker.fetch(
      new Request(env.PUBLIC_ORIGIN + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
  const ok = async (path: string, body: unknown) => {
    const response = await post(path, body);
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  return { db, env, worker, post, ok, messages };
}

test("public origin verifies an order without Turnstile and then rate-limits that order", async (t) => {
  const { db, env, worker, post, ok } = await fixture(t);
  env.PUBLIC_ORIGIN = origin;
  env.DEV_MODE = "false";
  await migrate(db, "0001_initial.sql");
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const response = await worker.fetch(new Request(origin + "/api/config"), env);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.deepEqual(
    config.products.map((p: { productId: string }) => p.productId),
    products.map((p) => p.productId),
  );
  assert.equal(config.verificationEnabled, true);
  assert.equal(config.turnstileSiteKey, "");
  const found = await ok("/api/orders/lookup", { orderNo });
  assert.equal(found.orderNo, orderNo);
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].productId, products[0].productId);
  assert.equal(found.items[0].productName, products[0].productName);
  assert.match(found.items[0].handoffToken, /^[a-f0-9]{64}$/);
  const bundle = await ok("/api/orders/lookup", { orderNo: bundleNo });
  assert.deepEqual(
    bundle.items.map((item: { productId: string }) => item.productId).sort(),
    products.map((product) => product.productId).sort(),
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const blocked = await post("/api/orders/verify", {
      orderNo,
      productId: products[0].productId,
    });
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).error.code, "NOT_CONFIGURED");
  }
  const limited = await post("/api/orders/lookup", { orderNo });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "RATE_LIMITED");
});

test("completed zero-price redemptions can activate and notify without admitting unpaid orders", async (t) => {
  const { db, env, worker, post, ok, messages } = await fixture(t);
  await migrate(db, "0001_initial.sql");
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const product = products[0];
  const unpaid = await post("/api/orders/verify", {
    orderNo: unpaidNo,
    productId: product.productId,
  });
  assert.equal(unpaid.status, 404);
  assert.equal((await unpaid.json()).error.code, "ORDER_NOT_ELIGIBLE");

  const order = orders[redeemedNo];
  await ok("/api/webhooks/afdian?token=" + env.WEBHOOK_TOKEN, {
    ec: 200,
    data: {
      type: "order",
      order,
      sign: sign(
        "sha256",
        Buffer.from(redeemedNo + buyer + plan + order.total_amount),
        providerKey.privateKey,
      ).toString("base64"),
    },
  });
  const persisted = await db
    .prepare("SELECT payment_status FROM purchases WHERE order_no=?")
    .bind(redeemedNo)
    .first<{ payment_status: number }>();
  assert.equal(persisted?.payment_status, 2);

  const wrongProduct = await post("/api/orders/verify", {
    orderNo: redeemedNo,
    productId: products[1].productId,
  });
  assert.equal(wrongProduct.status, 404);
  const session = await ok("/api/orders/verify", {
    orderNo: redeemedNo,
    productId: product.productId,
  });
  const deviceId = "f".repeat(64);
  const requestId = "redeemed-order-activation-0001";
  const issued = await ok("/api/activate", {
    handoffToken: session.handoffToken,
    productId: product.productId,
    deviceId,
    requestId,
  });
  assert.equal(
    verifyLicense(issued.licenseToken, publicKey, product.productId, deviceId)
      ?.licenseId,
    issued.licenseId,
  );
  assert.match(messages[0], /感谢您购买 坦克动荡/);
  assert.match(messages[0], new RegExp(redeemedNo));
  assert.match(messages[0], /请打开 AstroBox 的 Kovela 插件/);
  assert.doesNotMatch(messages[0], /传送门/);
  assert.match(messages[0], /售后群：993666186/);
  const reportedResponse = await worker.fetch(
    new Request(env.PUBLIC_ORIGIN + "/api/activation/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.10",
      },
      body: JSON.stringify({
        receiptToken: issued.receiptToken,
        licenseId: issued.licenseId,
        requestId,
        deviceId,
        deviceModel: "Xiaomi Smart Band 11",
        result: "activated",
      }),
    }),
    env,
  );
  const reported = await reportedResponse.json();
  assert.equal(reportedResponse.status, 200, JSON.stringify(reported));
  assert.equal(reported.notification, "sent");
  assert.equal(messages.length, 2);
  assert.match(messages[1], /成功激活 坦克动荡/);
  assert.match(messages[1], /软件名称：坦克动荡/);
  assert.match(messages[1], /20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  assert.match(messages[1], /设备型号：Xiaomi Smart Band 11/);
  assert.match(messages[1], new RegExp("设备码：" + deviceId));
  assert.match(messages[1], /操作IP：203\.0\.113\.10/);
  assert.match(messages[1], /温馨提示：若本次操作非本人执行/);
});

test("purchase webhook still sends the guide when query-order is loose or not indexed yet", async (t) => {
  const paid = orders[orderNo];
  const hook = {
    ec: 200,
    data: {
      type: "order",
      order: paid,
      sign: sign(
        "sha256",
        Buffer.from(orderNo + buyer + plan + paid.total_amount),
        providerKey.privateKey,
      ).toString("base64"),
    },
  };
  const loose = await fixture(t, () => ({
    ...paid,
    status: "2",
    total_amount: 5,
  }));
  await migrate(loose.db, "0001_initial.sql");
  await migrate(loose.db, "0002_products.sql");
  await migrate(loose.db, "0003_guides.sql");
  await loose.ok("/api/webhooks/afdian?token=" + loose.env.WEBHOOK_TOKEN, hook);
  assert.match(loose.messages[0], /感谢您购买 坦克动荡/);
  assert.match(loose.messages[0], new RegExp(orderNo));

  const delayed = await fixture(t, () => null);
  await migrate(delayed.db, "0001_initial.sql");
  await migrate(delayed.db, "0002_products.sql");
  await migrate(delayed.db, "0003_guides.sql");
  delayed.env.PRODUCTS = [{ ...products[0], skuIds: [] }];
  const bare = await delayed.worker.fetch(
    new Request(
      delayed.env.PUBLIC_ORIGIN +
        "/api/webhooks/afdian?token=" +
        delayed.env.WEBHOOK_TOKEN,
      { method: "POST", body: JSON.stringify(hook) },
    ),
    delayed.env,
  );
  assert.equal(bare.status, 200, await bare.clone().text());
  assert.match(delayed.messages[0], new RegExp(orderNo));

  const waiting = await fixture(t, () => null);
  await migrate(waiting.db, "0001_initial.sql");
  await migrate(waiting.db, "0002_products.sql");
  await migrate(waiting.db, "0003_guides.sql");
  const held = await waiting.post(
    "/api/webhooks/afdian?token=" + waiting.env.WEBHOOK_TOKEN,
    hook,
  );
  assert.equal(held.status, 503);
  assert.equal((await held.json()).error.code, "ORDER_NOT_FOUND");
  assert.equal(waiting.messages.length, 0);
});

test("SKUs, handoffs, signatures, bindings and reports remain isolated for products sharing an order", async (t) => {
  const { db, env, post, ok, messages } = await fixture(t);
  await migrate(db, "0001_initial.sql");
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const [a, b] = products;
  assert.equal(
    (await post("/api/orders/verify", { orderNo, productId: b.productId }))
      .status,
    404,
  );
  const single = await ok("/api/orders/verify", {
    orderNo,
    productId: a.productId,
  });
  const singleInput = {
    handoffToken: single.handoffToken,
    deviceId: "1".repeat(64),
    requestId: "single-activation-request",
  };
  const mismatch = await post("/api/activate", {
    ...singleInput,
    productId: b.productId,
  });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error.code, "PRODUCT_MISMATCH");
  const grant = await ok("/api/activate", {
    ...singleInput,
    productId: a.productId,
  });
  assert.equal(
    verifyLicense(
      grant.licenseToken,
      publicKey,
      a.productId,
      singleInput.deviceId,
    )?.licenseId,
    grant.licenseId,
  );
  assert.equal(
    verifyLicense(
      grant.licenseToken,
      publicKey,
      b.productId,
      singleInput.deviceId,
    ),
    null,
  );

  const bundle = orders[bundleNo];
  const hook = {
    ec: 200,
    data: {
      type: "order",
      order: bundle,
      sign: sign(
        "sha256",
        Buffer.from(bundleNo + buyer + plan + bundle.total_amount),
        providerKey.privateKey,
      ).toString("base64"),
    },
  };
  await ok("/api/webhooks/afdian?token=" + env.WEBHOOK_TOKEN, hook);
  const sessions = await Promise.all(
    products.map((product) =>
      ok("/api/orders/verify", {
        orderNo: bundleNo,
        productId: product.productId,
      }),
    ),
  );
  await ok("/api/webhooks/afdian?token=" + env.WEBHOOK_TOKEN, hook);
  const requests = products.map((product, index) => ({
    productId: product.productId,
    handoffToken: sessions[index].handoffToken,
    deviceId: String(index + 2).repeat(64),
    requestId: "bundle-activation-request-" + index,
  }));
  const grants = await Promise.all(
    requests.map((request) => ok("/api/activate", request)),
  );
  assert.notEqual(grants[0].licenseId, grants[1].licenseId);
  for (const [index, issued] of grants.entries()) {
    assert.equal(
      verifyLicense(
        issued.licenseToken,
        publicKey,
        products[index].productId,
        requests[index].deviceId,
      )?.licenseId,
      issued.licenseId,
    );
    assert.equal(
      (await ok("/api/activate", requests[index])).licenseToken,
      issued.licenseToken,
    );
  }
  const reports = grants.map((issued, index) => ({
    receiptToken: issued.receiptToken,
    licenseId: issued.licenseId,
    deviceId: issued.deviceId,
    requestId: requests[index].requestId,
    result: index === 0 ? "failed" : "activated",
  }));
  assert.equal(
    (
      await post("/api/activation/report", {
        ...reports[0],
        licenseId: grants[1].licenseId,
      })
    ).status,
    401,
  );
  await ok("/api/activation/report", reports[0]);
  await ok("/api/activation/report", reports[1]);
  const states = await Promise.all(
    sessions.map((session) =>
      ok("/api/activation/status", { statusToken: session.statusToken }),
    ),
  );
  assert.deepEqual(
    states.map((state) => state.state),
    ["failed", "activated"],
  );
  assert.deepEqual(
    states.map((state) => state.deviceId),
    requests.map((request) => request.deviceId),
  );
  const notices = messages.filter((message) =>
    message.includes("为你分配商品激活订单号"),
  );
  const results = messages.filter((message) => !notices.includes(message));
  assert.ok(
    notices.some((message) => message.includes("感谢您购买 坦克动荡、阅读器")),
  );
  assert.ok(results[0].includes(a.productName));
  assert.ok(results[1].includes(b.productName));
  const rebound = await ok("/api/orders/verify", {
    orderNo: bundleNo,
    productId: a.productId,
  });
  assert.equal(rebound.boundDeviceId, requests[0].deviceId);
  assert.equal(
    (
      await post("/api/activate", {
        ...requests[0],
        handoffToken: rebound.handoffToken,
        deviceId: requests[1].deviceId,
      })
    ).status,
    409,
  );
});

test("upgrading preserves existing licenses, device bindings, status tokens and pending notifications", async (t) => {
  const { db, ok, messages } = await fixture(t);
  await migrate(db, "0001_initial.sql");
  const licenseId = "legacy-license-00000001";
  const deviceId = "4".repeat(64);
  const handoffToken = "5".repeat(64);
  const statusToken = "6".repeat(64);
  const receiptToken = "7".repeat(64);
  const requestId = "legacy-request-00000001";
  const time = Math.floor(Date.now() / 1000);
  const licenseToken = signLicense(
    {
      v: 1,
      licenseId,
      productId: products[0].productId,
      deviceId,
      issuedAt: time,
    },
    seed,
  );
  await db.batch([
    db
      .prepare(
        "INSERT INTO orders(order_no,buyer_id,plan_id,license_id,device_id,license_token,issued_at,state,payment_status,updated_at) VALUES(?,?,?,?,?,?,?,'activated',2,?)",
      )
      .bind(
        orderNo,
        buyer,
        plan,
        licenseId,
        deviceId,
        licenseToken,
        time,
        time,
      ),
    db
      .prepare(
        "INSERT INTO sessions(handoff_hash,status_hash,order_no,expires_at,status_expires_at,device_id,request_id,receipt_hash,receipt_expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        hash(handoffToken),
        hash(statusToken),
        orderNo,
        time + 600,
        time + 3600,
        deviceId,
        requestId,
        hash(receiptToken),
        time + 3600,
      ),
    db
      .prepare(
        "INSERT INTO outbox(id,order_no,result,recipient,content,next_attempt) VALUES(?,?,'activated',?,?,0)",
      )
      .bind(
        licenseId + ":activated",
        orderNo,
        buyer,
        "existing activation notification",
      ),
  ]);
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const state = await ok("/api/activation/status", { statusToken });
  assert.deepEqual(state, {
    state: "activated",
    deviceId,
    notification: "pending",
  });
  assert.equal(
    (
      await ok("/api/activation/report", {
        receiptToken,
        deviceId,
        requestId,
        licenseId,
        result: "activated",
      })
    ).notification,
    "sent",
  );
  assert.deepEqual(messages, ["existing activation notification"]);
  const issued = await ok("/api/activate", {
    handoffToken,
    deviceId,
    requestId,
    productId: products[0].productId,
  });
  assert.equal(issued.licenseToken, licenseToken);
  assert.equal(
    verifyLicense(
      issued.licenseToken,
      publicKey,
      products[0].productId,
      deviceId,
    )?.licenseId,
    licenseId,
  );
  const session = await ok("/api/orders/verify", {
    orderNo,
    productId: products[0].productId,
  });
  assert.equal(session.boundDeviceId, deviceId);
});

test("offline issuance shares the online device binding and only exports signed device licenses", async (t) => {
  const { db, env, worker, ok } = await fixture(t);
  env.PUBLIC_ORIGIN = origin;
  env.DEV_MODE = "false";
  await migrate(db, "0001_initial.sql");
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const deviceId = "a".repeat(64);
  const request = {
    v: 1, type: "kovela-offline-request", orderNo,
    productId: products[0].productId, deviceId,
  };
  let ip = 0;
  const transport: typeof fetch = (input, init) => worker.fetch(
    new Request(String(input), { ...init, headers: { ...init?.headers, "CF-Connecting-IP": `192.0.2.${++ip}` } }), env,
  );
  const options = { origin, transport, verificationKey: publicKey };
  const first = await issueOfflineLicense(request, options);
  const repeated = await issueOfflineLicense(request, options);
  assert.equal(repeated.licenseToken, first.licenseToken);
  assert.deepEqual(Object.keys(first).sort(), ["v", "type", "productId", "productName", "deviceId", "licenseId", "licenseToken"].sort());
  assert.equal(verifyLicense(first.licenseToken, publicKey, request.productId, deviceId)?.licenseId, first.licenseId);
  assert.equal(verifyLicense(first.licenseToken, publicKey, request.productId, "b".repeat(64)), null);
  await assert.rejects(issueOfflineLicense({ ...request, deviceId: "b".repeat(64) }, options), /DEVICE_BOUND/);
  const online = await ok("/api/orders/lookup", { orderNo });
  const blocked = await worker.fetch(new Request(origin + "/api/activate", {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.99" },
    body: JSON.stringify({ handoffToken: online.items[0].handoffToken, productId: request.productId, deviceId: "b".repeat(64), requestId: "online-conflict-request-001" }),
  }), env);
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "DEVICE_BOUND");
  const bound = await db.prepare("SELECT device_id,license_token,state FROM entitlements WHERE license_id=?").bind(first.licenseId).first();
  assert.deepEqual(bound, { device_id: deviceId, license_token: first.licenseToken, state: "issued" });
});

test("offline issuer rejects unpaid orders, wrong products and an invalid server signature", async (t) => {
  const { db, env, worker } = await fixture(t);
  env.PUBLIC_ORIGIN = origin;
  env.DEV_MODE = "false";
  await migrate(db, "0001_initial.sql");
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const request = { v: 1, type: "kovela-offline-request", orderNo: unpaidNo, productId: products[0].productId, deviceId: "a".repeat(64) };
  const transport: typeof fetch = (input, init) => worker.fetch(new Request(String(input), init), env);
  const options = { origin, transport, verificationKey: publicKey };
  await assert.rejects(issueOfflineLicense(request, options), /ORDER_NOT_ELIGIBLE/);
  await assert.rejects(issueOfflineLicense({ ...request, orderNo, productId: products[1].productId }, options), /does not include/);
  await assert.rejects(issueOfflineLicense({ ...request, orderNo }, { ...options, verificationKey: "0".repeat(64) }), /failed signature/);
  const state = await db.prepare("SELECT device_id,license_token FROM entitlements WHERE order_no=? AND product_id=?").bind(unpaidNo, products[0].productId).first();
  assert.equal(state, null);
});

test("offline issuance racing an online activation cannot bind one order to two devices", async (t) => {
  const { db, env, worker, ok } = await fixture(t);
  env.PUBLIC_ORIGIN = origin;
  env.DEV_MODE = "false";
  await migrate(db, "0001_initial.sql");
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const online = await ok("/api/orders/lookup", { orderNo });
  const transport: typeof fetch = (input, init) => worker.fetch(new Request(String(input), init), env);
  const offline = issueOfflineLicense({ v: 1, type: "kovela-offline-request", orderNo, productId: products[0].productId, deviceId: "a".repeat(64) }, { origin, transport, verificationKey: publicKey });
  const competing = worker.fetch(new Request(origin + "/api/activate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handoffToken: online.items[0].handoffToken, productId: products[0].productId, deviceId: "b".repeat(64), requestId: "competing-online-request-001" }),
  }), env);
  const [issued, response] = await Promise.all([offline.then((value) => ({ value, error: null }), (error) => ({ value: null, error })), competing]);
  const successful = Number(issued.value !== null) + Number(response.status === 200);
  assert.equal(successful, 1);
  if (issued.error) assert.match(issued.error.message, /DEVICE_BOUND/);
  if (response.status !== 200) assert.equal((await response.json()).error.code, "DEVICE_BOUND");
  const bound = await db.prepare("SELECT device_id,license_token FROM entitlements WHERE order_no=? AND product_id=?").bind(orderNo, products[0].productId).first<{ device_id: string; license_token: string }>();
  assert.equal(bound?.device_id, issued.value ? "a".repeat(64) : "b".repeat(64));
  assert.equal(verifyLicense(bound?.license_token, publicKey, products[0].productId, bound!.device_id)?.deviceId, bound?.device_id);
});

test("offline CLI exports a verified file and refuses to overwrite or leave a failed output", async (t) => {
  const { db, env, worker } = await fixture(t);
  env.PUBLIC_ORIGIN = origin;
  env.DEV_MODE = "false";
  await migrate(db, "0001_initial.sql");
  await migrate(db, "0002_products.sql");
  await migrate(db, "0003_guides.sql");
  const directory = await mkdtemp(path.join(tmpdir(), "kovela-offline-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputFile = path.join(directory, "request.json");
  const outputFile = path.join(directory, "license.json");
  const failedFile = path.join(directory, "failed.json");
  const request = { v: 1, type: "kovela-offline-request", orderNo, productId: products[0].productId, deviceId: "a".repeat(64) };
  await writeFile(inputFile, JSON.stringify(request));
  const transport: typeof fetch = (input, init) => worker.fetch(new Request(String(input), init), env);
  const dependencies = { transport, verificationKey: publicKey };
  const args = ["--", "--request", inputFile, "--output", outputFile, "--origin", origin];
  await issueOfflineCommand(args, dependencies);
  const exported = JSON.parse(await readFile(outputFile, "utf8"));
  assert.equal(verifyLicense(exported.licenseToken, publicKey, request.productId, request.deviceId)?.licenseId, exported.licenseId);
  assert.equal(exported.receiptToken, undefined);
  assert.equal(exported.handoffToken, undefined);
  await assert.rejects(issueOfflineCommand(args, dependencies), { code: "EEXIST" });
  await writeFile(inputFile, JSON.stringify({ ...request, orderNo: unpaidNo }));
  await assert.rejects(issueOfflineCommand(["--request", inputFile, "--output", failedFile, "--origin", origin], dependencies), /ORDER_NOT_ELIGIBLE/);
  await assert.rejects(readFile(failedFile), { code: "ENOENT" });
});

test("admin signing authenticates before orders and shares online device bindings", async (t) => {
  let queries = 0;
  const { db, env, worker, ok } = await fixture(t, (number) => { queries += 1; return orders[number]; });
  env.PUBLIC_ORIGIN = origin;
  env.DEV_MODE = "false";
  env.ADMIN_KEY = "e".repeat(64);
  for (const migration of ["0001_initial.sql", "0002_products.sql", "0003_guides.sql"]) await migrate(db, migration);
  const input = { v: 1, type: "kovela-offline-request", orderNo, productId: products[0].productId, deviceId: "a".repeat(64) };
  const admin = (path: string, value: unknown, key?: string) => worker.fetch(new Request(origin + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(value),
  }), env);
  for (const key of [undefined, "f".repeat(64)]) assert.equal((await admin("/api/admin/licenses", input, key)).status, 401);
  assert.equal(queries, 0);
  assert.equal(await db.prepare("SELECT COUNT(*) AS total FROM entitlements").first("total"), 0);
  assert.deepEqual(await (await admin("/api/admin/session", {}, env.ADMIN_KEY)).json(), { authenticated: true });
  const response = await admin("/api/admin/licenses", input, env.ADMIN_KEY);
  assert.equal(response.status, 200);
  const license = await response.json();
  assert.equal(verifyLicense(license.licenseToken, publicKey, input.productId, input.deviceId)?.licenseId, license.licenseId);
  assert.deepEqual(Object.keys(license).sort(), ["v", "type", "productId", "productName", "deviceId", "licenseId", "licenseToken"].sort());
  const repeated = await (await admin("/api/admin/licenses", input, env.ADMIN_KEY)).json();
  assert.equal(repeated.licenseToken, license.licenseToken);
  assert.equal((await admin("/api/admin/licenses", { ...input, deviceId: "b".repeat(64) }, env.ADMIN_KEY)).status, 409);
  assert.equal((await admin("/api/admin/licenses", { ...input, orderNo: unpaidNo }, env.ADMIN_KEY)).status, 404);
  assert.equal((await admin("/api/admin/licenses", { ...input, productId: products[1].productId }, env.ADMIN_KEY)).status, 404);
  const online = await ok("/api/orders/lookup", { orderNo });
  const competing = await worker.fetch(new Request(origin + "/api/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handoffToken: online.items[0].handoffToken, productId: input.productId, deviceId: "b".repeat(64), requestId: "admin-online-conflict-001" }) }), env);
  assert.equal(competing.status, 409);
  assert.deepEqual(await db.prepare("SELECT device_id,state FROM entitlements WHERE license_id=?").bind(license.licenseId).first(), { device_id: input.deviceId, state: "issued" });
  env.ADMIN_KEY = undefined;
  assert.equal((await admin("/api/admin/licenses", input, "e".repeat(64))).status, 503);
});

test("admin issuance racing online activation cannot bind two devices", async (t) => {
  const { db, env, worker, ok } = await fixture(t);
  env.PUBLIC_ORIGIN = origin;
  env.DEV_MODE = "false";
  env.ADMIN_KEY = "e".repeat(64);
  for (const migration of ["0001_initial.sql", "0002_products.sql", "0003_guides.sql"]) await migrate(db, migration);
  const online = await ok("/api/orders/lookup", { orderNo });
  const responses = await Promise.all([
    worker.fetch(new Request(origin + "/api/admin/licenses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ADMIN_KEY}` }, body: JSON.stringify({ v: 1, type: "kovela-offline-request", orderNo, productId: products[0].productId, deviceId: "a".repeat(64) }) }), env),
    worker.fetch(new Request(origin + "/api/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handoffToken: online.items[0].handoffToken, productId: products[0].productId, deviceId: "b".repeat(64), requestId: "admin-online-race-001" }) }), env),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const successful = await responses.find((response) => response.status === 200)!.json();
  const bound = await db.prepare("SELECT device_id,license_token FROM entitlements WHERE order_no=? AND product_id=?").bind(orderNo, products[0].productId).first<{ device_id: string; license_token: string }>();
  assert.equal(bound?.device_id, successful.deviceId);
  assert.equal(verifyLicense(bound?.license_token, publicKey, products[0].productId, successful.deviceId)?.licenseId, successful.licenseId);
});
