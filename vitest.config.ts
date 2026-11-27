import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    mockReset: true,
    clearMocks: true,
    typecheck: {
      tsconfig: "./tsconfig.json",
    },
  },
});
