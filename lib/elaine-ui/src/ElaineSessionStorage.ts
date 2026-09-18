/** sessionStorage keys shared by Elaine surfaces. */
export const SESSION_HIDE_KEY = "elaineWidgetSessionHidden";
export const ELAINE_SESSION_HIDDEN_EVENT = "elaine-session-hidden";
const WINDOW_NAME_HIDDEN_MARKER = "[__elaine_widget_session_hidden__]";

// Storage can be disabled by browser privacy settings or fail transiently.
// Keep mounted surfaces coherent for the lifetime of this module in that case.
let volatileSessionHidden = false;
let preserveFallbackOnMissingStorageKey = false;

function readWindowNameHidden(): boolean {
  return (
    typeof window !== "undefined" &&
    window.name.includes(WINDOW_NAME_HIDDEN_MARKER)
  );
}

function writeWindowNameHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (hidden) {
      if (!window.name.includes(WINDOW_NAME_HIDDEN_MARKER)) {
        window.name += WINDOW_NAME_HIDDEN_MARKER;
      }
    } else {
      window.name = window.name.replaceAll(WINDOW_NAME_HIDDEN_MARKER, "");
    }
  } catch {
    // window.name can also be restricted by an unusual embedding context.
  }
}

/** Read the per-session bubble state without breaking SSR or blocked storage. */
export function readElaineSessionHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const hidden = window.sessionStorage.getItem(SESSION_HIDE_KEY) === "1";
    if (hidden) {
      volatileSessionHidden = true;
      preserveFallbackOnMissingStorageKey = false;
      writeWindowNameHidden(true);
      return true;
    }
    if (preserveFallbackOnMissingStorageKey && volatileSessionHidden) {
      // A previous hidden write may have failed while reads still work
      // (read-only/quota-limited storage). Do not let the missing key erase
      // the in-memory/window.name session fallback.
      writeWindowNameHidden(true);
      return true;
    }
    volatileSessionHidden = hidden;
    preserveFallbackOnMissingStorageKey = false;
    writeWindowNameHidden(hidden);
    return hidden;
  } catch {
    volatileSessionHidden = readWindowNameHidden() || volatileSessionHidden;
    return volatileSessionHidden;
  }
}

/** Update the per-session bubble state and notify all mounted Elaine surfaces. */
export function setElaineSessionHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  volatileSessionHidden = hidden;
  writeWindowNameHidden(hidden);
  try {
    if (hidden) window.sessionStorage.setItem(SESSION_HIDE_KEY, "1");
    else window.sessionStorage.removeItem(SESSION_HIDE_KEY);
    preserveFallbackOnMissingStorageKey = false;
  } catch {
    // The in-memory listeners still keep mounted surfaces in sync.
    preserveFallbackOnMissingStorageKey = hidden;
  }
  window.dispatchEvent(new Event(ELAINE_SESSION_HIDDEN_EVENT));
}
