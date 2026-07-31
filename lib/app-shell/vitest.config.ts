import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Workspace packages are source-linked and intentionally declare React as
    // a peer. Pin test resolution to this package's dev dependency so imports
    // reached through elaine-ui/messenger-ui resolve the same React instance.
    alias: {
      react: new URL("./node_modules/react", import.meta.url).pathname,
      "react-dom": new URL("./node_modules/react-dom", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
