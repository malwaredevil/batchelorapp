import { ElaineWidget } from "@workspace/elaine-ui";

/**
 * Travels' mount point for the shared floating widget. The full-screen
 * chat experience (including travels-specific magnet check and surfaced
 * content) now lives entirely in the standalone Elaine app.
 */
export function AssistantWidget() {
  return <ElaineWidget appId="travels" fullScreenPath="/elaine/" />;
}
