import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { exclude: ["@sparkjsdev/spark"] },
  build: { target: "es2022", chunkSizeWarningLimit: 4000, rollupOptions: { input: { menu: "index.html", residue: "residue.html", undeveloped: "undeveloped.html" } } },
  server: { fs: { strict: false } },
});
