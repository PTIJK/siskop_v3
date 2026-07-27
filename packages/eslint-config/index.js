import js from "@eslint/js";
import ts from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    // Type-aware rules need a TS program, so scope them to TS files only —
    // applying them to plain .js config files makes ESLint throw.
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true }
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error"
    }
  },
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error"
    }
  }
];
