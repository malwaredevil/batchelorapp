import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/*.config.ts",
      "docs/generated/**",
      ".local/**",
      ".cache/**",
      // These executable/test files are intentionally outside their package
      // TypeScript projects, so type-aware rules cannot safely inspect them.
      "lib/api-spec/build-spec.ts",
      "artifacts/modules/src/quilting/lib/cell-parser.test.ts",
      "artifacts/modules/src/ornaments/pages/camera-add-queue.test.ts",
      "lib/api-client-react/src/custom-fetch.test.ts",
      "lib/api-client-react/src/elaine.test.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
