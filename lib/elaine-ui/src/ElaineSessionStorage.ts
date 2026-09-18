/** sessionStorage keys shared by Elaine surfaces. */
export const SESSION_HIDE_KEY = "elaineWidgetSessionHidden";

/** Read the per-session bubble state without breaking SSR or blocked storage. */
export function readElaineSessionHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_HIDE_KEY) === "1";
  } catch {
    return false;
  }
}
