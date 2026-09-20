import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const nonDeterministic = "src/engine must stay seeded and deterministic.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The resolver decides payouts. Nothing in it may read a clock or an
    // unseeded random source.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: nonDeterministic },
        { object: "Date", property: "now", message: nonDeterministic },
        { object: "performance", property: "now", message: nonDeterministic },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: nonDeterministic },
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
