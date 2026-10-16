import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createWorker, type Env } from "../src/index";
import {
  deviceFingerprint,
  verifyLicense,
} from "../../../packages/license/src/index.js";
import { getPlatformProxy } from "wrangler";
import { fileURLToPath } from "node:url";

// 迁移脚本只会增加：测试统一按顺序全量应用，免得每加一条就漏掉一处。
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
async function migrateAll(db: D1Database) {
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) await migrate(db, name);
}

const product = "com.komoridev.tankturmoil";
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
const orderNo = "202609121234567890123456789";
const goodOrder = {
  out_trade_no: orderNo,
  user_id: buyer,
  plan_id: plan,
  status: 2,
  total_amount: "5.00",
};

test("real D1 transaction binds once, retries idempotently, verifies webhook and persists message delivery", async () => {
  const platform = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  try {
    const db = platform.env.DB;
    await migrateAll(db);
    let sent = 0;
    let messagesFail = true;
    let paid = true;
    // 爱发电的订单查询次数：用来证明「签发」没有再外呼一次。
    let queries = 0;
    const provider: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(
        body.sign,
        createHash("md5")
          .update(
            "provider-token" +
              "params" +
              body.params +
              "ts" +
              body.ts +
              "user_id" +
              body.user_id,
          )
          .digest("hex"),
      );
      const params = JSON.parse(body.params);
      if (String(input).endsWith("/query-order")) {
        assert.equal(params.out_trade_no, orderNo);
        queries += 1;
        return Response.json({
          ec: 200,
          data: { list: [{ ...goodOrder, status: paid ? 2 : 1 }] },
        });
      }
      assert.ok(String(input).endsWith("/send-msg"));
      assert.equal(params.recipient, buyer);
      if (messagesFail) return Response.json({ ec: 500, em: "temporary" });
      sent++;
      return Response.json({ ec: 200, data: {} });
    };
    const worker = createWorker(provider);
    const env: Env = {
      DB: db,
      PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      DEV_MODE: "true",
      AFDIAN_USER_ID: "a".repeat(32),
      AFDIAN_TOKEN: "provider-token",
      PRODUCTS: [
        {
          productId: product,
          productName: "坦克动荡",
          purchaseUrl: "",
          planIds: [plan],
          skuIds: [],
        },
      ],
      LICENSE_SIGNING_SEED: seed,
      WEBHOOK_TOKEN: "w".repeat(32),
      AFDIAN_WEBHOOK_PUBLIC_KEY: providerKey.publicKey
        .export({ format: "pem", type: "spki" })
        .toString(),
    };
    const post = (path: string, body: unknown) =>
      worker.fetch(
        new Request("http://127.0.0.1:8787" + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      );
    const hookBody = {
      ec: 200,
      data: {
        type: "order",
        order: goodOrder,
        sign: sign(
          "sha256",
          Buffer.from(orderNo + buyer + plan + "5.00"),
          providerKey.privateKey,
        ).toString("base64"),
      },
    };
    assert.equal(
      (await post("/api/webhooks/afdian?token=" + env.WEBHOOK_TOKEN, hookBody))
        .status,
      200,
    );
    assert.equal(
      (
        await post("/api/webhooks/afdian?token=" + env.WEBHOOK_TOKEN, {
          ...hookBody,
          data: { ...hookBody.data, sign: "bad" },
        })
      ).status,
      401,
    );
    const verify = async () => {
      const response = await post("/api/orders/verify", {
        orderNo,
        productId: product,
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const [first, second] = await Promise.all([verify(), verify()]);
    // 到这里为止的外呼次数就是查询订单该有的全部外呼。
    const lookups = queries;
    const deviceA = deviceFingerprint("device-A", product);
    const deviceB = deviceFingerprint("device-B", product);
    // 竞争哪台设备赢是随机的，旧会话那一步要用第三台设备才必然撞上绑定。
    const deviceC = deviceFingerprint("device-C", product);
    const idA = "b0fe4a71-87d1-4b5d-9031-14cda14b7b4b";
    const idB = "fe6a2d58-494f-4f13-80e4-7f6a6f1a2e78";
    const inputs = [
      {
        handoffToken: first.handoffToken,
        productId: product,
        deviceId: deviceA,
        requestId: idA,
      },
      {
        handoffToken: second.handoffToken,
        productId: product,
        deviceId: deviceB,
        requestId: idB,
      },
    ];
    const raced = await Promise.all(
      inputs.map((x) => post("/api/activate", x)),
    );
    assert.deepEqual(raced.map((x) => x.status).sort(), [200, 409]);
    const winner = raced.findIndex((x) => x.status === 200);
    const issued = await raced[winner].json();
    assert.equal(
      verifyLicense(
        issued.licenseToken,
        publicKey,
        product,
        inputs[winner].deviceId,
      )?.licenseId,
      issued.licenseId,
    );
    const retry = await (await post("/api/activate", inputs[winner])).json();
    assert.equal(retry.licenseToken, issued.licenseToken);
    assert.equal(retry.receiptToken, issued.receiptToken);
    // 查询刚核过爱发电：签发（含失败的那次竞争与本次重发）不该再外呼一遍，
    // 否则用户要为同一个已知结论多等一次爱发电往返。
    assert.equal(queries, lookups, "签发复用了查询时的结论");
    // 反面：会话放久了必须重新核对付款状态。
    const stale = await verify();
    await db
      .prepare("UPDATE sessions SET verified_at=0 WHERE handoff_hash=?")
      .bind(createHash("sha256").update(stale.handoffToken).digest("hex"))
      .run();
    const beforeStale = queries;
    const staleAttempt = await post("/api/activate", {
      handoffToken: stale.handoffToken,
      productId: product,
      deviceId: deviceC,
      requestId: "stale-session-request-001",
    });
    assert.equal(queries, beforeStale + 1, "旧会话仍要复核付款状态");
    assert.equal(staleAttempt.status, 409, "同一订单只能绑定第一台设备");
    const report = {
      receiptToken: issued.receiptToken,
      requestId: inputs[winner].requestId,
      deviceId: issued.deviceId,
      licenseId: issued.licenseId,
      result: "activated",
    };
    assert.equal(
      (
        await post("/api/activation/report", {
          ...report,
          deviceId: "0".repeat(64),
        })
      ).status,
      401,
    );
    await post("/api/activation/report", { ...report, result: "failed" });
    assert.equal(
      (
        await (
          await post("/api/activation/status", {
            statusToken: first.statusToken,
          })
        ).json()
      ).state,
      "failed",
    );
    assert.equal(
      (await (await post("/api/activation/report", report)).json())
        .notification,
      "pending",
    );
    const state = await (
      await post("/api/activation/status", { statusToken: first.statusToken })
    ).json();
    assert.equal(state.state, "activated");
    assert.equal(state.notification, "pending");
    messagesFail = false;
    await db.prepare("UPDATE outbox SET next_attempt=0").run();
    await worker.scheduled({} as ScheduledController, env);
    assert.equal(sent, 2);
    await post("/api/activation/report", report);
    assert.equal(sent, 2, "repeat ACK must not create another notification");
    await post("/api/activation/report", { ...report, result: "failed" });
    assert.equal(
      (
        await (
          await post("/api/activation/status", {
            statusToken: first.statusToken,
          })
        ).json()
      ).state,
      "activated",
      "late failure cannot downgrade success",
    );
    paid = false;
    assert.equal(
      (await post("/api/orders/verify", { orderNo, productId: product }))
        .status,
      404,
    );
    await db.prepare("UPDATE sessions SET expires_at=0").run();
    assert.equal((await post("/api/activate", inputs[winner])).status, 410);
    const external = await worker.fetch(
      new Request("http://127.0.0.1:8787/api/orders/verify", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderNo, productId: product }),
      }),
      env,
    );
    assert.equal(external.status, 403);
  } finally {
    await platform.dispose();
  }
});
