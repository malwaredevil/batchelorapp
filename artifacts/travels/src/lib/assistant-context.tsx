import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// Lets any page publish a description of what's currently on screen —
// including in-progress, unsaved field values — so elAIne can answer
// questions about it. Pages call usePageAssistantContext(label, data) with
// whatever live state is relevant; the most-recently-mounted page's context
// wins (only one page is visible at a time).
interface AssistantContextValue {
  getPageContext: () => string | undefined;
  setPageContext: (id: string, text: string | undefined) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantContextProvider({ children }: { children: React.ReactNode }) {
  const contextsRef = useRef(new Map<string, { text: string | undefined; order: number }>());
  const orderRef = useRef(0);
  const [, forceRender] = useState(0);

  const setPageContext = useCallback((id: string, text: string | undefined) => {
    if (text === undefined) {
      contextsRef.current.delete(id);
    } else {
      const existing = contextsRef.current.get(id);
      contextsRef.current.set(id, {
        text,
        order: existing?.order ?? orderRef.current++,
      });
    }
    forceRender((n) => n + 1);
  }, []);

  const getPageContext = useCallback(() => {
    let latest: { text: string; order: number } | undefined;
    for (const [, value] of contextsRef.current) {
      if (value.text === undefined) continue;
      if (!latest || value.order > latest.order) {
        latest = { text: value.text, order: value.order };
      }
    }
    return latest?.text;
  }, []);

  return (
    <AssistantContext.Provider value={{ getPageContext, setPageContext }}>
      {children}
    </AssistantContext.Provider>
  );
}

function useAssistantContextInternal() {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error("useAssistantContext must be used within AssistantContextProvider");
  }
  return ctx;
}

// Call from any page to publish its current live/unsaved state for elAIne.
// `text` should be a short, plain-language description — page name plus
// any in-progress field values worth knowing about. Pass undefined text (or
// unmount) to clear it. Re-registers whenever `text` changes.
export function usePageAssistantContext(pageId: string, text: string | undefined) {
  const { setPageContext } = useAssistantContextInternal();
  React.useEffect(() => {
    setPageContext(pageId, text);
    return () => setPageContext(pageId, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, text]);
}

export function useAssistantPageContextReader() {
  const { getPageContext } = useAssistantContextInternal();
  return getPageContext;
}
