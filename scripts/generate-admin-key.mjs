import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const secret = fileURLToPath(new URL("../.secrets/admin-key.vars", import.meta.url));
const local = fileURLToPath(new URL("../apps/worker/.dev.vars", import.meta.url));
let key;
try {
  const existing = await readFile(secret, "utf8");
  key = existing.match(/^ADMIN_KEY=([a-f0-9]{64})\r?$/m)?.[1];
  if (!key) throw new Error("Existing admin-key.vars is invalid; it was not overwritten.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  key = randomBytes(32).toString("hex");
  await mkdir(fileURLToPath(new URL("../.secrets/", import.meta.url)), { recursive: true });
  const file = await open(secret, "wx", 0o600);
  try { await file.writeFile(`ADMIN_KEY=${key}\n`); }
  finally { await file.close(); }
}
try {
  const vars = await readFile(local, "utf8");
  if (!/^ADMIN_KEY=/m.test(vars)) await appendFile(local, `\nADMIN_KEY=${key}\n`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
console.log(`Admin access key is stored in ${secret}. Existing signing keys were not changed.`);
