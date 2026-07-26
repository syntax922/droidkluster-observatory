import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Playwright owns e2e/**: it uses its own `test`/`expect` from
    // @playwright/test, and vitest's default include glob
    // (**/*.{test,spec}.*) would otherwise try to collect smoke.spec.ts too.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.{idea,git,cache,output,temp}/**", "e2e/**"],
  },
  resolve: {
    // CRITICAL: Site tests must run against @observatory/core SOURCE, not stale dist.
    // Vite BUILD still uses dist; only test resolution is aliased.
    // (Fixes: stale Phase 1 reducer blocking Phase 2 test assertions.)
    alias: {
      "@observatory/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
