import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let optionsSet = false;
let mapsLibraryPromise: Promise<
  [google.maps.MapsLibrary, google.maps.MarkerLibrary]
> | null = null;

export function loadGoogleMaps(): Promise<
  [google.maps.MapsLibrary, google.maps.MarkerLibrary]
> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY is not configured"));
  }
  if (!optionsSet) {
    setOptions({ key: apiKey, v: "weekly" });
    optionsSet = true;
  }
  if (!mapsLibraryPromise) {
    mapsLibraryPromise = Promise.all([importLibrary("maps"), importLibrary("marker")]);
  }
  return mapsLibraryPromise;
}

export function svgToMarkerContent(svg: string): HTMLElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement;
  return el as unknown as HTMLElement;
}
