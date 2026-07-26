import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    // Playwright owns e2e/**: it uses its own `test`/`expect` from
    // @playwright/test, and vitest's default include glob
    // (**/*.{test,spec}.*) would otherwise try to collect smoke.spec.ts too.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.{idea,git,cache,output,temp}/**", "e2e/**"],
  },
});
