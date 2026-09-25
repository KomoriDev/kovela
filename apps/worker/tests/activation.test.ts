import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createWorker, type Env } from "../src/index";
import {
  deviceFingerprint,
  verifyLicense,
} from "../../../packages/license/src/index.js";
import { getPlatformProxy } from "wrangler";
import { fileURLToPath } from "node:url";

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
    for (const name of [
      "0001_initial.sql",
      "0002_products.sql",
      "0003_guides.sql",
    ]) {
      const migration = await readFile(
        new URL("../migrations/" + name, import.meta.url),
        "utf8",
      );
      await db.batch(
        migration
          .split(";")
          .map((sql) => sql.trim())
          .filter(Boolean)
          .map((sql) => db.prepare(sql)),
      );
    }
    let sent = 0;
    let messagesFail = true;
    let paid = true;
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
    const deviceA = deviceFingerprint("device-A", product);
    const deviceB = deviceFingerprint("device-B", product);
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
