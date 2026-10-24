import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
  resolve: {
    alias: [
      {
        find: "@",
        replacement: "@",
        // The regression suite mounts Elaine's real page as well as Modules'
        // widget. Resolve each app's local imports against its own source tree.
        customResolver(source, importer) {
          const root = importer?.includes("/artifacts/elaine/src/")
            ? "../elaine/src"
            : "src";
          return this.resolve(
            path.resolve(import.meta.dirname, root, source.slice(2)),
            importer,
            { skipSelf: true },
          );
        },
      },
    ],
  },
});
