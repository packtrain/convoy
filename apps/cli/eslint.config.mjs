import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { sharedIgnores, underscoreUnusedVarsRule } from "../../eslint-shared.mjs";

export default tseslint.config(
  {
    ignores: [...sharedIgnores, "dist/**", "src/convex/**"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": underscoreUnusedVarsRule,
    },
  }
);
