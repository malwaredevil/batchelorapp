import type { PageContext } from "@workspace/api-client-react";
import {
  ElainePageContextProvider as AssistantContextProvider,
  useElainePageContextReader as useAssistantPageContextReader,
  usePageElaineContext,
} from "@workspace/elaine-ui";

export { AssistantContextProvider, useAssistantPageContextReader };

export function usePageAssistantContext(
  pageId: string,
  context: string | PageContext | undefined,
) {
  usePageElaineContext(
    pageId,
    typeof context === "string"
      ? {
          module: "quilting",
          description: `Viewing ${pageId}.`,
          userNotes: context,
        }
      : context,
  );
}
