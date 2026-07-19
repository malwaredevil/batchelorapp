import path from "path";
import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import type { PluginOption, UserConfig } from "vite";

function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export interface WorkspaceViteConfigOptions {
  /** The artifact's own directory — pass `import.meta.dirname`. */
  artifactDir: string;
  /**
   * Extra resolve aliases prepended before the default `@` and `@assets`
   * entries. Use array form to support regex `find` values.
   */
  extraAliases?: Array<{ find: string | RegExp; replacement: string }>;
  /** Extra plugins inserted immediately after the core stack and before the
   * Replit dev-only plugins (cartographer, dev-banner). */
  extraPlugins?: PluginOption[];
}

/**
 * Shared Vite config factory for all workspace artifacts.
 *
 * Handles PORT / BASE_PATH env validation, the common plugin stack (React,
 * Tailwind, runtime-error overlay, Replit dev-only plugins), and standard
 * resolve / build / server / preview settings.
 *
 * @example
 * // artifacts/modules/vite.config.ts
 * import { createWorkspaceViteConfig } from "@workspace/vite-config";
 * export default createWorkspaceViteConfig({ artifactDir: import.meta.dirname });
 *
 * @example
 * // artifacts/elaine/vite.config.ts — with PWA extension
 * import { createWorkspaceViteConfig } from "@workspace/vite-config";
 * import { VitePWA } from "vite-plugin-pwa";
 * export default createWorkspaceViteConfig({
 *   artifactDir: import.meta.dirname,
 *   extraPlugins: [VitePWA({ ... })],
 *   extraAliases: [{ find: /^@workspace\/web-core$/, replacement: "..." }],
 * });
 */
export async function createWorkspaceViteConfig(
  opts: WorkspaceViteConfigOptions,
): Promise<UserConfig> {
  const { artifactDir, extraPlugins = [], extraAliases = [] } = opts;

  const rawPort = process.env.PORT;
  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }
  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH;
  if (!basePath) {
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }

  const replitDevPlugins: PluginOption[] =
    process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({ root: path.resolve(artifactDir, "..") }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : [];

  // Source-map upload to Sentry — production builds only, skipped when
  // SENTRY_AUTH_TOKEN is absent (e.g. local dev without the secret set).
  const sentryPlugins: PluginOption[] =
    process.env.NODE_ENV === "production" && process.env.SENTRY_AUTH_TOKEN
      ? [
          await import("@sentry/vite-plugin").then((m) =>
            m.sentryVitePlugin({
              org: process.env.SENTRY_ORG_SLUG,
              project: process.env.SENTRY_PROJECT_SLUG,
              authToken: process.env.SENTRY_AUTH_TOKEN,
              silent: true,
              sourcemaps: {
                // Delete the uploaded .map files from the dist directory so
                // they are never served to end users.
                filesToDeleteAfterUpload: ["./dist/public/**/*.map"],
              },
            }),
          ),
        ]
      : [];

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...extraPlugins,
      ...sentryPlugins,
      ...replitDevPlugins,
    ],
    resolve: {
      alias: [
        ...extraAliases,
        { find: "@", replacement: path.resolve(artifactDir, "src") },
        {
          find: "@assets",
          replacement: path.resolve(artifactDir, "..", "..", "attached_assets"),
        },
      ],
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(artifactDir),
    define: {
      // Expose the server-side SENTRY_DSN as a build-time constant so the
      // browser bundle can initialise @sentry/react without a separate secret.
      // The Sentry DSN is a public identifier — safe to embed in the bundle.
      "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(
        process.env.SENTRY_DSN ?? "",
      ),
      // Inject the git commit SHA as VITE_APP_VERSION so Sentry can tag
      // errors with the exact release that produced them.
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(getGitSha()),
    },
    build: {
      outDir: path.resolve(artifactDir, "dist/public"),
      emptyOutDir: true,
      // Hidden source maps are generated during production builds so the
      // Sentry Vite plugin can upload them, but they are deleted from dist/
      // afterwards (filesToDeleteAfterUpload above) and never served publicly.
      sourcemap: process.env.NODE_ENV === "production" ? "hidden" : false,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
}
