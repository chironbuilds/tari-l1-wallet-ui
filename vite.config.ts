import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  optimizeDeps: {
    exclude: ["@chironbuilder/tari-l1-wasm"],
  },
  // The scan workers instantiate their own copy of the wasm module, and Vite builds workers
  // through a separate plugin pipeline — without this the worker bundle hits the unsupported
  // "ESM integration proposal for Wasm" path and the build fails.
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  build: {
    target: "esnext",
  },
  // Same-origin routes to each network's node. The nodes' CORS allows reads but not a broadcast
  // POST, and a same-origin request has no preflight. Mirrored by the rewrites in vercel.json.
  server: {
    proxy: {
      "/rpc/mainnet": {
        target: "https://rpc.tari.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc\/mainnet/, ""),
      },
      "/rpc/esmeralda": {
        target: "https://rpc.esmeralda.tari.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc\/esmeralda/, ""),
      },
    },
  },
});
