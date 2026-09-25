import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "assets/kovela.png");
await mkdir(path.join(root, "apps/web/public/brand"), { recursive: true });
const outputs = [
  ["apps/web/public/brand/kovela-mark.png", 512],
  ["apps/web/public/favicon.png", 64],
  ["apps/web/public/apple-touch-icon.png", 180],
  ["plugins/astrobox/icon.png", 512],
];
for (const [file, size] of outputs) {
  await sharp(source).resize(size, size).png().toFile(path.join(root, file));
}
console.log("Prepared Kovela web, favicon, and AstroBox icons.");
