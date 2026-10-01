import { randomUUID } from "node:crypto";
import { readFile, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLicense } from "../packages/license/src/index.js";
import publicKey from "../packages/vela/src/public-key.js";

export const DEFAULT_ORIGIN = "https://kovela.komoridevs.icu";

export function parseRequest(value) {
  if (
    !value || value.v !== 1 || value.type !== "kovela-offline-request" ||
    typeof value.orderNo !== "string" || !/^\d{16,32}$/.test(value.orderNo) ||
    typeof value.productId !== "string" || value.productId.length > 120 ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.productId) ||
    typeof value.deviceId !== "string" || !/^[a-f0-9]{64}$/.test(value.deviceId) ||
    (value.deviceModel !== undefined &&
      (typeof value.deviceModel !== "string" || [...value.deviceModel].length > 80 || /[\x00-\x1f\x7f]/.test(value.deviceModel)))
  ) throw new Error("Invalid Kovela offline request. Export it from the plugin.");
  return { orderNo: value.orderNo, productId: value.productId, deviceId: value.deviceId };
}

export async function issueOfflineLicense(input, {
  origin = DEFAULT_ORIGIN,
  transport = globalThis.fetch,
  verificationKey = publicKey,
} = {}) {
  const request = parseRequest(input);
  const base = new URL(origin);
  const local = base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  if (base.origin !== origin || (base.protocol !== "https:" && !local)) {
    throw new Error("Origin must be HTTPS (or loopback HTTP) without a path, query or credentials.");
  }
  const call = async (endpoint, body) => {
    let response;
    try {
      response = await transport(origin + endpoint, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new Error("Cannot connect to the issuing service. Use a working network or an --origin proxy.");
    }
    if (response.status >= 300 && response.status < 400) throw new Error("Issuing service redirected the request; check --origin.");
    let value;
    try { value = await response.json(); } catch { throw new Error("Issuing service returned a non-JSON response."); }
    if (!response.ok) {
      const code = value?.error?.code;
      const message = value?.error?.message;
      throw new Error(typeof code === "string" && typeof message === "string" ? `${code}: ${message}` : `Issuing service returned HTTP ${response.status}.`);
    }
    return value;
  };
  const config = await call("/api/config");
  if (!config?.verificationEnabled || !Array.isArray(config.products)) throw new Error("Order verification is not enabled on the issuing service.");
  const product = config.products.find((item) => item.productId === request.productId && item.available);
  if (!product || typeof product.productName !== "string" || !product.productName.trim()) throw new Error("This application is not available for activation.");
  const lookup = await call("/api/orders/lookup", { orderNo: request.orderNo });
  if (lookup?.orderNo !== request.orderNo || !Array.isArray(lookup.items)) throw new Error("Invalid order lookup response.");
  const item = lookup.items.find((item) => item.productId === request.productId);
  if (!item || !/^[a-f0-9]{64}$/.test(item.handoffToken)) throw new Error("The order does not include the requested application.");
  if (item.boundDeviceId !== null && item.boundDeviceId !== request.deviceId) throw new Error("DEVICE_BOUND: This order is already bound to another device.");
  const issued = await call("/api/activate", {
    handoffToken: item.handoffToken,
    requestId: randomUUID(),
    productId: request.productId,
    deviceId: request.deviceId,
  });
  const payload = verifyLicense(issued?.licenseToken, verificationKey, request.productId, request.deviceId);
  if (!payload || payload.licenseId !== issued.licenseId || issued.productId !== request.productId || issued.deviceId !== request.deviceId) {
    throw new Error("The issued license failed signature or device validation; no license was exported.");
  }
  return {
    v: 1,
    type: "kovela-offline-license",
    productId: request.productId,
    productName: product.productName,
    deviceId: request.deviceId,
    licenseId: issued.licenseId,
    licenseToken: issued.licenseToken,
  };
}

const usage = "Usage: pnpm license:issue --request request.json --output license.json [--origin https://kovela.komoridevs.icu]";

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") { console.log(usage); return; }
    if (!["--request", "--output", "--origin"].includes(arg) || !args[i + 1] || args[i + 1].startsWith("--") || options[arg]) throw new Error(usage);
    options[arg] = args[++i];
  }
  if (!options["--request"] || !options["--output"]) throw new Error(usage);
  const inputText = await readFile(options["--request"], "utf8");
  if (Buffer.byteLength(inputText) > 8192) throw new Error("Offline request is too large.");
  let input;
  try { input = JSON.parse(inputText); } catch { throw new Error("Offline request must be a JSON file exported from Kovela."); }
  parseRequest(input);
  const destination = path.resolve(options["--output"]);
  // Reserve the destination before binding an order; never overwrite unrelated files.
  const output = await open(destination, "wx", 0o600);
  let written = false;
  try {
    const envelope = await issueOfflineLicense(input, { ...dependencies, origin: options["--origin"] ?? DEFAULT_ORIGIN });
    await output.writeFile(JSON.stringify(envelope, null, 2) + "\n", "utf8");
    written = true;
    console.log(`Issued ${envelope.productName} for device ${envelope.deviceId.slice(0, 12)}.`);
    console.log(`License: ${destination}`);
    console.log("Send this file to the buyer. The shared order record is bound; installation is not yet confirmed.");
  } finally {
    await output.close();
    if (!written) {
      const { unlink } = await import("node:fs/promises");
      await unlink(destination);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
