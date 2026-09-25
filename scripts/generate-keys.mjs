import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const secret = path.join(root, ".secrets/worker-license.vars");
const keyFile = path.resolve(root, "packages/vela/src/public-key.js");
for (const file of [secret, keyFile]) {
  try {
    await access(file);
    throw new Error(
      "Existing signing material found; restore the matching key instead of rotating it implicitly: " +
        file,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const key = generateKeyPairSync("ed25519");
const seed = key.privateKey
  .export({ format: "der", type: "pkcs8" })
  .subarray(-32)
  .toString("hex");
const pub = key.publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");
await mkdir(path.dirname(secret), { recursive: true });
await writeFile(secret, "LICENSE_SIGNING_SEED=" + seed + "\n", {
  flag: "wx",
  mode: 0o600,
});
await mkdir(path.dirname(keyFile), { recursive: true });
await writeFile(
  keyFile,
  "// Public verification key; private seed is only in Kovela .secrets.\nexport default " +
    JSON.stringify(pub) +
    "\n",
  { flag: "wx" },
);
console.log(
  "Created the signing seed and shared Vela public key. Back up the secret; changing it invalidates existing licenses. Run pnpm prepare:vela to rebuild application activation modules.",
);
