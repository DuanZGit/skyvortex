import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineBase = path.resolve(__dirname, "engine-base");

const MIME = {
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".glsl": "text/plain",
  ".frag": "text/plain",
  ".json": "application/json",
};

/**
 * 引擎静态资产（大气 LUT .bin、噪声图等）不在 demo root 内：
 * dev 下把 /engine-base/** 映射到磁盘，build 后复制到 dist 供运行时 fetch。
 */
function engineAssetsPlugin() {
  const assetDirs = [
    "engine-base/public",
    "engine-base/src/AtmosphereFromThreeGeospatial/assets",
    "engine-base/src/AtmosphereFromThreeGeospatial/Shaders",
  ];
  return {
    name: "skyvortex-engine-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/engine-base/")) return next();
        const rel = decodeURIComponent(req.url.split("?")[0]);
        const filePath = path.join(__dirname, rel);
        if (!filePath.startsWith(engineBase)) return next(); // 防目录穿越
        fs.stat(filePath, (err, st) => {
          if (err || !st.isFile()) return next();
          res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
    closeBundle() {
      for (const dir of assetDirs) {
        const src = path.resolve(__dirname, dir);
        if (!fs.existsSync(src)) continue;
        fs.cpSync(src, path.resolve(__dirname, "dist", dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, "demo"),
  publicDir: false,
  plugins: [engineAssetsPlugin()],
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "demo/pilot-app.html"),
    },
  },
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
