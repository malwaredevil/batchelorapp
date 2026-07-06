import { useLocation } from "wouter";
import { ElaineWidget } from "@workspace/elaine-ui";

/**
 * Travels-specific mount point for the shared floating widget. Travels has
 * a full-screen chat page (`/elaine`) that the widget hides itself while
 * on, unlike apps without that surface.
 */
export function AssistantWidget() {
  const [location] = useLocation();
  return (
    <ElaineWidget appId="travels" fullScreenPath="/elaine" currentPath={location} />
  );
}
