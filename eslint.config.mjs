import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    "**/._*",
    ".next/**",
    "node_modules/**",
    "generated/**",
    ".codex-backups/**",
    ".sec-backups/**",
  ]),
  {
    rules: {
      // React 19 compiler-oriented rules are not applicable to this React 18
      // application yet. Keep the established Hooks correctness rules active.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      // Published article media intentionally uses the cross-client media
      // contract instead of Next Image.
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
    },
  },
]);
