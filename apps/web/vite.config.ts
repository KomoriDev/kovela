import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        // Standalone page embedded in the AstroBox personal homepage.
        astrobox: fileURLToPath(new URL("./astrobox/index.html", import.meta.url)),
      },
    },
  },
  server: { proxy: { "/api": process.env.KOVELA_WORKER_ORIGIN ?? "http://127.0.0.1:8787" } },
});
