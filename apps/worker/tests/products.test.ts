import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { createWorker, type Env } from "../src/index";
import type { AfdianOrder } from "@kovela/afdian";
import type { ProductConfig } from "@kovela/protocol";
import { verifyLicense } from "@kovela/license";
import { signLicense } from "@kovela/license/signing";

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

async function fixture(t: TestContext) {
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
      const order = orders[params.out_trade_no];
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

test("first deployment serves its catalogue but cannot bypass missing Turnstile on a public origin", async (t) => {
  const { env, worker, post } = await fixture(t);
  env.PUBLIC_ORIGIN = origin;
  // Even DEV_MODE=true cannot exempt a public hostname from Turnstile.
  for (const siteKey of ["", "configured-site-key"]) {
    env.TURNSTILE_SITE_KEY = siteKey;
    const response = await worker.fetch(
      new Request(origin + "/api/config"),
      env,
    );
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.deepEqual(
      config.products.map((p: { productId: string }) => p.productId),
      products.map((p) => p.productId),
    );
    assert.equal(config.verificationEnabled, false);
    assert.equal(config.turnstileSiteKey, "");
    const blocked = await post("/api/orders/verify", {
      orderNo,
      productId: products[0].productId,
    });
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).error.code, "NOT_CONFIGURED");
  }
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
  assert.match(messages[0], /传送门：http:\/\/127\.0\.0\.1:5173\//);
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
  const notices = messages.filter((message) => message.includes("为你分配商品激活订单号"));
  const results = messages.filter((message) => !notices.includes(message));
  assert.ok(notices.some((message) => message.includes("感谢您购买 坦克动荡、阅读器")));
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
