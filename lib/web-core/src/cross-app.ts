/**
 * Build a cross-app URL that works regardless of which origin the page is
 * opened from.
 *
 * Path-based routing between artifacts only exists on the PORTLESS origin
 * (Replit's proxy in dev, the real domain in prod). If an app is opened via
 * a raw mapped dev port (e.g. https://<domain>:25313, which serves only the
 * Modules Vite server), absolute root-relative paths like "/modules/..." or
 * "/" 404 because no other artifact is reachable on that port.
 *
 * `crossAppUrl` anchors the path to `protocol//hostname/` (dropping any
 * explicit port) so the request always hits the reverse-proxy origin.  When
 * there is no explicit port (normal portless dev or prod) the function returns
 * `path` unchanged so nothing regresses.
 *
 * Usage:
 *   window.location.href = crossAppUrl("/modules/pottery/");
 *   <a href={crossAppUrl("/")}>Hub</a>
 */
export function crossAppUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const { protocol, hostname, port } = window.location;
  if (!port) return path;
  return `${protocol}//${hostname}${path}`;
}
