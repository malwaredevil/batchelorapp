import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { createWorkspaceViteConfig } from "@workspace/vite-config";

const basePath = process.env.BASE_PATH ?? "";
const startUrl = basePath.endsWith("/") ? basePath : `${basePath}/`;

export default createWorkspaceViteConfig({
  artifactDir: import.meta.dirname,
  extraAliases: [
    {
      find: /^@workspace\/web-core$/,
      replacement: path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "lib",
        "web-core",
        "src",
        "index.ts",
      ),
    },
  ],
  extraPlugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "icons/icon-192x192.png",
        "icons/icon-512x512.png",
      ],
      manifest: {
        name: "Elaine — Batchelor Assistant",
        short_name: "Elaine",
        description: "Your AI household assistant from Batchelor",
        theme_color: "#1a395b",
        background_color: "#0f172a",
        display: "standalone",
        start_url: startUrl,
        scope: startUrl,
        icons: [
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Authenticated API responses must NOT be runtime-cached. Service-worker
        // caching does not vary by session/user and Cache Storage survives logout,
        // so a cached Elaine response can be served to a different household
        // member or after session expiry. Static assets above are safe to cache.
      },
    }),
  ],
});
