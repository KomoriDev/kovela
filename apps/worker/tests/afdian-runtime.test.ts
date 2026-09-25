import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("Afdian requests work in workerd and never forward signed requests through redirects", async (t) => {
  const order = {
    out_trade_no: "202609131234567890123456789",
    user_id: "b".repeat(32),
    plan_id: "c".repeat(32),
    status: 2,
    total_amount: "5.00",
  };
  let redirectedRequests = 0;
  const server = createServer((request, response) => {
    request.resume();
    if (request.url === "/redirect/query-order") {
      response.writeHead(307, { Location: "/leaked" });
      response.end();
      return;
    }
    if (request.url === "/leaked") redirectedRequests++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ec: 200, data: { list: [order] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const bundled = await build({
    stdin: {
      contents: `
        import { Context } from "cordis";
        import AfdianService, { AfdianError } from "@kovela/afdian";
        export default {
          async fetch(request) {
            const ctx = new Context();
            try {
              const api = new AfdianService(ctx, {
                userId: "a".repeat(32),
                token: "fixture-api-token",
                baseUrl: ${JSON.stringify(origin)} + new URL(request.url).pathname,
              });
              return Response.json(await api.getOrder(${JSON.stringify(order.out_trade_no)}));
            } catch (error) {
              if (!(error instanceof AfdianError)) throw error;
              return Response.json({ code: error.code }, { status: 502 });
            } finally {
              await ctx.stop();
            }
          }
        };
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      sourcefile: "afdian-runtime.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  });
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: "afdian-runtime",
          type: "worker",
          compatibilityDate: "2026-09-01",
          manifest: {
            mainModule: "probe.js",
            modules: {
              "probe.js": {
                type: "esm",
                contents: bundled.outputFiles[0].text,
              },
            },
          },
        },
      },
    ],
  });
  t.after(() => runtime.dispose());
  const worker = await runtime.getWorker("afdian-runtime");
  const queried = await worker.fetch("https://probe.invalid/ok");
  const result = await queried.json();
  assert.equal(queried.status, 200, JSON.stringify(result));
  assert.deepEqual(result, order);
  const redirected = await worker.fetch("https://probe.invalid/redirect");
  assert.equal(redirected.status, 502);
  assert.deepEqual(await redirected.json(), { code: "UPSTREAM_HTTP" });
  assert.equal(
    redirectedRequests,
    0,
    "a redirect must not receive the signed API request",
  );
});
