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
});
