import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // The relayer SDK ships WASM that Vite's dep optimizer mangles.
    exclude: ["@zama-fhe/relayer-sdk"],
  },
  build: {
    target: "esnext",
  },
  define: {
    // Some wallet libs expect a Node-style global.
    global: "globalThis",
  },
});
