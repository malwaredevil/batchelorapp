import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { PageContext } from "@workspace/api-client-react";

// Lets any page across any app publish a description of what's currently on
// screen — including in-progress, unsaved field values — so Elaine can
// answer questions about it. Pages call usePageElaineContext(label, data)
// with whatever live state is relevant; the most-recently-mounted page's
// context wins (only one page is visible at a time). This provider must
// wrap the whole app so the same context reader/writer is shared between
// every page and the floating widget / full-screen chat.
interface ElainePageContextValue {
  getPageContext: () => PageContext | undefined;
  setPageContext: (id: string, context: PageContext | undefined) => void;
}

const ElainePageContext = createContext<ElainePageContextValue | null>(null);

export function ElainePageContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const contextsRef = useRef(
    new Map<string, { context: PageContext | undefined; order: number }>(),
  );
  const orderRef = useRef(0);
  const [, forceRender] = useState(0);

  const setPageContext = useCallback(
    (id: string, context: PageContext | undefined) => {
      if (context === undefined) {
        contextsRef.current.delete(id);
      } else {
        const existing = contextsRef.current.get(id);
        contextsRef.current.set(id, {
          context,
          order: existing?.order ?? orderRef.current++,
        });
      }
      forceRender((n) => n + 1);
    },
    [],
  );

  const getPageContext = useCallback(() => {
    let latest: { context: PageContext; order: number } | undefined;
    for (const [, value] of contextsRef.current) {
      if (value.context === undefined) continue;
      if (!latest || value.order > latest.order) {
        latest = { context: value.context, order: value.order };
      }
    }
    return latest?.context;
  }, []);

  return (
    <ElainePageContext.Provider value={{ getPageContext, setPageContext }}>
      {children}
    </ElainePageContext.Provider>
  );
}

function useElainePageContextInternal() {
  const ctx = useContext(ElainePageContext);
  if (!ctx) {
    throw new Error(
      "useElainePageContext must be used within ElainePageContextProvider",
    );
  }
  return ctx;
}

// Call from any page to publish its current live/unsaved state for Elaine.
// `text` should be a short, plain-language description — page name plus
// any in-progress field values worth knowing about. Pass undefined text (or
// unmount) to clear it. Re-registers whenever `text` changes.
export function usePageElaineContext(
  pageId: string,
  context: PageContext | undefined,
) {
  const { setPageContext } = useElainePageContextInternal();
  React.useEffect(() => {
    setPageContext(pageId, context);
    return () => setPageContext(pageId, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, context]);
}

export function useElainePageContextReader() {
  const { getPageContext } = useElainePageContextInternal();
  return getPageContext;
}
