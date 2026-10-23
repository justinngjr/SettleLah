import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Component tests opt into jsdom with `// @vitest-environment jsdom` at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "e2e/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
