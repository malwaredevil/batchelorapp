import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

let optionsSet = false;
let mapsLibraryPromise: Promise<
  [google.maps.MapsLibrary, google.maps.MarkerLibrary]
> | null = null;

type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();
let authFailureFired = false;

function installAuthFailureHook() {
  if (typeof window === "undefined" || window.gm_authFailure) return;
  // Google Maps JS API calls this global exactly once if the API key/referrer
  // is rejected (e.g. RefererNotAllowedMapError). It never rejects the
  // importLibrary() promise or throws synchronously, so this is the only
  // reliable way to detect and gracefully surface an auth/referrer failure.
  window.gm_authFailure = () => {
    authFailureFired = true;
    authFailureListeners.forEach((listener) => listener());
  };
}

/**
 * Subscribes to Google Maps auth/referrer failures (e.g. the API key's
 * allowed referrers don't include the current domain). Returns an
 * unsubscribe function. If a failure already happened before subscribing,
 * the listener is invoked immediately.
 */
export function onGoogleMapsAuthFailure(
  listener: AuthFailureListener,
): () => void {
  installAuthFailureHook();
  if (authFailureFired) {
    listener();
    return () => {};
  }
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

export function hasGoogleMapsAuthFailed(): boolean {
  return authFailureFired;
}

export function loadGoogleMaps(): Promise<
  [google.maps.MapsLibrary, google.maps.MarkerLibrary]
> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    return Promise.reject(
      new Error("VITE_GOOGLE_MAPS_API_KEY is not configured"),
    );
  }
  installAuthFailureHook();
  if (!optionsSet) {
    setOptions({ key: apiKey, v: "weekly" });
    optionsSet = true;
  }
  if (!mapsLibraryPromise) {
    mapsLibraryPromise = Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
    ]);
  }
  return mapsLibraryPromise;
}

export function svgToMarkerContent(svg: string): HTMLElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement;
  return el as unknown as HTMLElement;
}
