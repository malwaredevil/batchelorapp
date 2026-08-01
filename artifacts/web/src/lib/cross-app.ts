export { crossAppUrl } from "@workspace/web-core/cross-app";

/**
 * Base URL for links that cross SPA boundaries from the Hub app (/, /modules/,
 * /elaine/).  The Hub's BASE_URL is "/" so this gives a root-anchored prefix
 * when on a raw dev port (e.g. https://<domain>:3000) and "/" otherwise.
 *
 * For cross-app links in Modules or Elaine, use `crossAppUrl(path)` from
 * `@workspace/web-core/cross-app` directly.
 */
export function crossAppBase(): string {
  if (typeof window === "undefined") return import.meta.env.BASE_URL;
  const { protocol, hostname, port } = window.location;
  // Standard origins (no explicit port) keep plain relative-to-root behavior.
  if (!port) return import.meta.env.BASE_URL;
  return `${protocol}//${hostname}${import.meta.env.BASE_URL}`;
}
