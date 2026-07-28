// djb2 hash — produces a short alphanumeric string from a storage path.
// Used as a `?v=` query param on image-serving routes so the browser
// re-fetches whenever the underlying storage path changes (e.g. set-default
// swaps paths behind a fixed /image route URL).
export function pathCacheBuster(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h) ^ path.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
