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
const schedule = (cron: string) => ({ cron }) as ScheduledController;

test("a webhook that never arrives is backfilled by the 15-minute order sweep", async (t) => {
  const platform = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  t.after(() => platform.dispose());
  const db = platform.env.DB;
  await migrateAll(db);

  // 爱发电订单列表：第 1 页按创建时间倒序，只有第一单是我们的商品。
  const paid = {
    out_trade_no: "202611131200000000000000001",
    user_id: buyer,
    plan_id: plan,
    status: 2,
    total_amount: "5.00",
  };
  const unrelated = {
    out_trade_no: "202611131200000000000000002",
    user_id: "d".repeat(32),
    plan_id: "z".repeat(32),
    status: 2,
    total_amount: "5.00",
  };
  const unpaid = {
    out_trade_no: "202611131200000000000000003",
    user_id: "e".repeat(32),
    plan_id: plan,
    status: 1,
    total_amount: "0.00",
  };
  const list = [paid, unrelated, unpaid];
  const pages: number[] = [];
  const lookups: string[] = [];
  const messages: string[] = [];
  const provider: typeof fetch = async (input, init) => {
    const params = JSON.parse(JSON.parse(String(init?.body)).params);
    if (String(input).endsWith("/query-order")) {
      if (params.page !== undefined) {
        pages.push(params.page);
        return Response.json({
          ec: 200,
          data: {
            list: params.page === 1 ? list : [],
            total_count: list.length,
            total_page: 1,
          },
        });
      }
      lookups.push(params.out_trade_no);
      const found: unknown = list.find((order) => order.out_trade_no === params.out_trade_no);
      return Response.json({ ec: 200, data: { list: found ? [found] : [] } });
    }
    assert.ok(String(input).endsWith("/send-msg"));
    messages.push(params.recipient + "\n" + params.content);
    return Response.json({ ec: 200, data: {} });
  };
  const worker = createWorker(provider);
  const env: Env = {
    DB: db,
    PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    DEV_MODE: "true",
    PRODUCTS: [
      {
        productId: product,
        productName: "坦克动荡",
        purchaseUrl: "",
        planIds: [plan],
        skuIds: [],
      },
    ],
    AFDIAN_USER_ID: "a".repeat(32),
    AFDIAN_TOKEN: "provider-token",
    LICENSE_SIGNING_SEED: "f".repeat(64),
    WEBHOOK_TOKEN: "w".repeat(32),
  };
  const post = async (path: string, body: unknown) =>
    (
      await worker.fetch(
        new Request("http://127.0.0.1:8787" + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      )
    ).json();
  const count = async (table: string) =>
    (await db.prepare("SELECT COUNT(*) AS n FROM " + table).first<{ n: number }>())!.n;

  // Webhook 丢了：爱发电那边订单已经成立，本地却什么都没有，账号激活也看不到商品。
  assert.deepEqual((await post("/api/account/products", { afdianUserId: buyer })).items, []);

  await worker.scheduled(schedule("*/15 * * * *"), env);
  assert.equal(messages.length, 1, "补单发出一条教学私信");
  assert.equal(messages[0].split("\n")[0], buyer);
  assert.ok(messages[0].includes(paid.out_trade_no), "私信要带上订单号");
  assert.equal(
    (
      await db.prepare("SELECT payment_status FROM purchases WHERE order_no=?")
        .bind(paid.out_trade_no)
        .first<{ payment_status: number }>()
    )?.payment_status,
    2,
  );
  assert.equal(
    (
      await db.prepare("SELECT product_id FROM entitlements WHERE order_no=?")
        .bind(paid.out_trade_no)
        .first<{ product_id: string }>()
    )?.product_id,
    product,
  );
  // 其他商品方案与未付款订单不是漏单，不该有记录，也不该发私信。
  assert.equal(await count("purchases"), 1);
  assert.equal(await count("entitlements"), 1);
  assert.equal(
    (await db.prepare("SELECT state FROM outbox WHERE id=?").bind("guide:" + paid.out_trade_no).first<{ state: string }>())?.state,
    "sent",
  );
  // 补回来的订单立刻能走账号激活：这是补单真正要救的东西。
  const items = (await post("/api/account/products", { afdianUserId: buyer })).items;
  assert.deepEqual(items, [{ productId: product, productName: "坦克动荡", boundDeviceId: null }]);
  assert.deepEqual(lookups, [paid.out_trade_no]);

  // 下一轮再扫：订单已在本地，不该重发私信，也不该多出记录。
  pages.length = 0;
  await worker.scheduled(schedule("*/15 * * * *"), env);
  assert.equal(messages.length, 1, "补过的单不会再发私信");
  assert.deepEqual(pages, [1], "这一页没有漏单就不再往后翻");
  assert.equal(await count("purchases"), 1);

  // 每分钟的触发器只重试私信，不该去问爱发电要订单列表。
  pages.length = 0;
  await worker.scheduled(schedule("* * * * *"), env);
  assert.deepEqual(pages, [], "每分钟的触发器不跑补单");
});
