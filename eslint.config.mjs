import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Domain boundary: src/domain must stay pure TypeScript so the Telegram
    // bot can reuse it outside Next.js. Nothing outside src/domain may be
    // imported (directly or via the @/ alias). See src/domain/README.md.
    files: ["src/domain/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next", message: "src/domain must not depend on Next.js." },
            { name: "react", message: "src/domain must not depend on React." },
            { name: "react-dom", message: "src/domain must not depend on React." },
          ],
          patterns: [
            { group: ["next/*"], message: "src/domain must not depend on Next.js." },
            { group: ["react/*", "react-dom/*"], message: "src/domain must not depend on React." },
            { group: ["@supabase/*"], message: "src/domain must not depend on Supabase." },
            {
              group: ["@/**", "!@/domain", "!@/domain/**"],
              message: "src/domain must not import anything outside src/domain.",
            },
          ],
        },
      ],
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/domain",
              from: "./src",
              except: ["./domain"],
              message: "src/domain must not import anything outside src/domain.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
