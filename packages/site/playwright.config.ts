import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: [
    // --host 127.0.0.1 is load-bearing, not decorative: `vite preview` with no
    // --host binds only the IPv6 loopback ([::1]:4173) on this environment.
    // Playwright's own readiness probe resolves "localhost" and finds it (via
    // ::1), so the webServer looks healthy — but `baseURL` above is the
    // explicit IPv4 literal, so `page.goto("/")` then hits a closed IPv4 port
    // and fails with ERR_CONNECTION_REFUSED. Pin the preview server to the
    // same IPv4 literal the tests actually navigate to.
    {
      command: "npx vite preview --port 4173 --host 127.0.0.1",
      cwd: ".",
      port: 4173,
      reuseExistingServer: true,
    },
    {
      command: "node e2e/fixture-server.mjs",
      cwd: ".",
      port: 4174,
      reuseExistingServer: true,
    },
  ],
});
