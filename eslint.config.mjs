import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Playwright artifacts (git-ignored; a local `npm run test:e2e`
    // writes minified bundles here that would otherwise fail `npm run lint`):
    "playwright-report/**",
    "test-results/**",
    "playwright/.cache/**",
  ]),
]);

export default eslintConfig;
