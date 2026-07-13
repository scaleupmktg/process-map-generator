import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Renderers/exporters read the /skill bundle from process.cwd(); tests run
    // from the repo root so those relative reads resolve.
    globals: false,
  },
});
