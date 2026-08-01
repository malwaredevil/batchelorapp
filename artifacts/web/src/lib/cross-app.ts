/**
 * Base URL for links that may cross SPA boundaries (/, /modules/, /elaine/).
 *
 * Path-based routing between artifacts only exists on the PORTLESS origin
 * (Replit's proxy in dev, the real domain in prod). If the app is opened via
 * a raw mapped dev port (e.g. https://<repl-domain>:3000 → the hub's Vite
 * server only), relative links like "modules/office/" 404 because no other
 * artifact is reachable on that port. Anchoring cross-app links to
 * `protocol//hostname/` (dropping any port) fixes that case and is a no-op
 * everywhere else.
 */
export function crossAppBase(): string {
  if (typeof window === "undefined") return import.meta.env.BASE_URL;
  const { protocol, hostname, port } = window.location;
  // Standard origins (no explicit port) keep plain relative-to-root behavior.
  if (!port) return import.meta.env.BASE_URL;
  return `${protocol}//${hostname}${import.meta.env.BASE_URL}`;
}
