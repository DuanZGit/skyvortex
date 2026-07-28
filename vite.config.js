import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineBase = path.resolve(__dirname, "engine-base");

export default defineConfig({
  root: path.resolve(__dirname, "demo"),
  publicDir: false,
  resolve: {
    alias: {
      "cesium-clouds-atmosphere": path.resolve(engineBase, "src/index.js"),
    },
  },
  server: {
    open: "/pilot-app.html",
    port: 5174,
    fs: {
      allow: [__dirname, engineBase],
    },
  },
  optimizeDeps: {
    include: ["three"],
  },
});
