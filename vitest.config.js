import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    // Phase 1–2 intentionally ships no tests yet (Phase 4 adds test/);
    // keeps `npm test` exit 0 with 0 tests until then.
    passWithNoTests: true,
  },
});
