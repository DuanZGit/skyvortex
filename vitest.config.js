import { defineConfig } from "vitest/config";

// 独立于 vite.config.js（其 root=demo 仅服务于 dev server）
export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
  },
});
