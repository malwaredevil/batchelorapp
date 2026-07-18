import type { PageContext } from "@workspace/api-client-react";
import {
  ElainePageContextProvider as AssistantContextProvider,
  useElainePageContextReader as useAssistantPageContextReader,
  usePageElaineContext,
} from "@workspace/elaine-ui";

export { AssistantContextProvider, useAssistantPageContextReader };

export type UsePageContext = (
  pageId: string,
  context: string | PageContext | undefined,
) => void;

export function usePageAssistantContext(
  pageId: string,
  context: string | PageContext | undefined,
) {
  usePageElaineContext(
    pageId,
    typeof context === "string"
      ? {
          module: "office" as const,
          description: context,
        }
      : context,
  );
}
