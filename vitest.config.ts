import { defineConfig } from "vitest/config";

/** Kept separate from vite.config.ts: the app build and the test runner have no reason to
 *  share a config object, and vitest owns its own schema. */
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
