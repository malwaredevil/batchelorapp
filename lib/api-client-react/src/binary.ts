import { customFetch } from "./custom-fetch";

/**
 * Loads an authenticated binary resource through the shared API client.
 *
 * This is deliberately small because image URLs may be signed storage URLs
 * rather than generated API paths, while still ensuring callers use the
 * configured auth, base URL, and request handling.
 */
export function fetchBinaryResource(
  url: string,
  options?: Pick<RequestInit, "signal" | "credentials">,
): Promise<Blob> {
  return customFetch<Blob>(url, {
    ...options,
    responseType: "blob",
  });
}