import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    // Parser createProgram roots project sources only (no ambient @types dump),
    // but keep headroom for cold TS host init across many fixtures.
    testTimeout: 10_000,
  },
});
