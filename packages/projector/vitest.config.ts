import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    // CRITICAL: Projector tests must run against @observatory/core SOURCE, not
    // dist. On a clean clone dist/ doesn't exist yet (npm run check runs before
    // npm run build), so unaliased resolution 404s via the package.json
    // types/main pointer. Vite BUILD still uses dist; only test resolution is
    // aliased. (Mirrors the same fix already applied in site/vitest.config.ts.)
    alias: {
      "@observatory/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
