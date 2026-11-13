import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { createWorker, type Env } from "../src/index";

// 迁移脚本只会增加：测试统一按顺序全量应用，免得每加一条就漏掉一处。
async function migrateAll(db: D1Database) {
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL("../migrations/" + name, import.meta.url), "utf8");
    await db.batch(
      sql
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => db.prepare(part)),
    );
  }
}

const product = "com.komoridev.tankturmoil";
const buyer = "b".repeat(32);
const plan = "c".repeat(32);
const orderNo = "202611131200000000000000001";
const license = "a".repeat(32);

test("queued DMs are stripped of the angle brackets Afdian rejects, and a rejection records why", async (t) => {
  const platform = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  t.after(() => platform.dispose());
  const db = platform.env.DB;
  await migrateAll(db);

  const received: string[] = [];
  let reject = false;
  const provider: typeof fetch = async (input, init) => {
    assert.ok(String(input).endsWith("/send-msg"));
    const params = JSON.parse(JSON.parse(String(init?.body)).params);
    if (reject)
      return Response.json({
        ec: 400001,
        em: "私信内容不能包含尖括号或不允许的控制字符",
      });
    received.push(params.content);
    return Response.json({ ec: 200, em: "发送成功", data: {} });
  };
  const worker = createWorker(provider);
  const env: Env = {
    DB: db,
    PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    DEV_MODE: "true",
    AFDIAN_USER_ID: "9".repeat(32),
    AFDIAN_TOKEN: "provider-token",
    LICENSE_SIGNING_SEED: "f".repeat(64),
    WEBHOOK_TOKEN: "w".repeat(32),
  };

  await db.batch([
    db
      .prepare(
        "INSERT INTO purchases(order_no,buyer_id,plan_id,payment_status,updated_at) VALUES(?,?,?,?,?)",
      )
      .bind(orderNo, buyer, plan, 2, 0),
    db
      .prepare(
        "INSERT INTO entitlements(license_id,order_no,product_id,product_name,updated_at) VALUES(?,?,?,?,?)",
      )
      .bind(license, orderNo, product, "坦克动荡", 0),
  ]);
  const enqueue = (id: string, content: string) =>
    db
      .prepare(
        "INSERT INTO outbox(id,license_id,result,recipient,content,next_attempt) VALUES(?,?,?,?,?,0)",
      )
      .bind(id, license, "guide", buyer, content)
      .run();

  // 2026-11 之前发出去的教学私信都用 `>` 做引用，爱发电后来开始拒收这类内容，
  // 队列里存量的旧文案要还原成 `·` 再发（换行等结构要保留）。
  await enqueue("guide:legacy", "【Kovela】\n> 售后群：<993666186>\n结束");
  await worker.scheduled({ cron: "* * * * *" } as ScheduledController, env);
  assert.deepEqual(received, ["【Kovela】\n· 售后群：993666186\n结束"]);
  const sent = await db
    .prepare("SELECT state,last_error FROM outbox WHERE id=?")
    .bind("guide:legacy")
    .first<{ state: string; last_error: string | null }>();
  assert.equal(sent?.state, "sent");
  assert.equal(sent?.last_error, null);

  // 仍然失败时把爱发电的原话留在行上：整批私信静默失败时，这是唯一能查的线索。
  reject = true;
  await enqueue("guide:rejected", "【Kovela】\n普通内容");
  await worker.scheduled({ cron: "* * * * *" } as ScheduledController, env);
  const failed = await db
    .prepare("SELECT state,last_error FROM outbox WHERE id=?")
    .bind("guide:rejected")
    .first<{ state: string; last_error: string | null }>();
  assert.equal(failed?.state, "pending");
  assert.match(failed?.last_error ?? "", /UPSTREAM_REJECTED: ec=400001/);
  assert.match(failed?.last_error ?? "", /尖括号/);
});
