/** sessionStorage keys shared by Elaine surfaces. */
export const SESSION_HIDE_KEY = "elaineWidgetSessionHidden";
export const ELAINE_SESSION_HIDDEN_EVENT = "elaine-session-hidden";

/** Read the per-session bubble state without breaking SSR or blocked storage. */
export function readElaineSessionHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Update the per-session bubble state and notify all mounted Elaine surfaces. */
export function setElaineSessionHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (hidden) window.sessionStorage.setItem(SESSION_HIDE_KEY, "1");
    else window.sessionStorage.removeItem(SESSION_HIDE_KEY);
  } catch {
    // The in-memory listeners still keep mounted surfaces in sync.
  }
  window.dispatchEvent(new Event(ELAINE_SESSION_HIDDEN_EVENT));
}
