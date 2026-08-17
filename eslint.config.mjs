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
      // Throwaway fixtures that check-domain-composition.test.ts briefly writes
      // into various src/ directories during integration tests. The glob covers
      // all of them so the TS language service (projectService: true) never
      // races on a fixture file between its creation and deletion — the same
      // race the tsconfig exclude handles for tsc itself.
      "**/_temp_*",
      "**/_temp-*",
      // These executable/test files are intentionally outside their package
      // TypeScript projects, so type-aware rules cannot safely inspect them.
      "lib/api-spec/build-spec.ts",
      "artifacts/modules/src/quilting/lib/cell-parser.test.ts",
      "artifacts/modules/src/quilting/hooks/useCompareSelectMutualExclusion.test.ts",
      "artifacts/modules/src/ornaments/pages/camera-add-queue.test.ts",
      "artifacts/modules/src/ornaments/pages/collection-bulk-reanalyze.test.ts",
      "artifacts/modules/src/ornaments/components/use-barcode-camera.test.ts",
      "artifacts/modules/src/pottery/pages/collection-bulk-reanalyze.test.ts",
      "artifacts/modules/src/quilting/hooks/bulk-reanalyze-run.test.ts",
      "lib/api-client-react/src/custom-fetch.test.ts",
      "lib/api-client-react/src/elaine.test.ts",
      "lib/api-client-react/src/ornaments-hallmark.test.ts",
      // Excluded from its package tsconfig (intentional CI sentinel); ESLint
      // cannot type-check it without a project reference.
      "artifacts/api-server/src/_ci_sentinel_scheduler_names_.ts",
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
