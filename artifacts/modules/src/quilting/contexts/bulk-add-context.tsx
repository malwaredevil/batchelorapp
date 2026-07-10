import { createContext, useCallback, useContext, useState } from "react";

export type BulkPendingItem = {
  clientId: string;
  preview: string;
  status: "uploading" | "done" | "error";
};

interface BulkAddContextValue {
  pendingItems: BulkPendingItem[];
  enqueue: (clientId: string, preview: string) => void;
  resolve: (clientId: string, status: "done" | "error") => void;
  clear: () => void;
}

const BulkAddContext = createContext<BulkAddContextValue | null>(null);

export function BulkAddProvider({ children }: { children: React.ReactNode }) {
  const [pendingItems, setPendingItems] = useState<BulkPendingItem[]>([]);

  const enqueue = useCallback((clientId: string, preview: string) => {
    setPendingItems((prev) => [
      ...prev,
      { clientId, preview, status: "uploading" },
    ]);
  }, []);

  const resolve = useCallback((clientId: string, status: "done" | "error") => {
    setPendingItems((prev) =>
      prev.map((item) =>
        item.clientId === clientId ? { ...item, status } : item,
      ),
    );
    if (status === "done") {
      setTimeout(() => {
        setPendingItems((prev) =>
          prev.filter((item) => item.clientId !== clientId),
        );
      }, 2500);
    }
  }, []);

  const clear = useCallback(() => setPendingItems([]), []);

  return (
    <BulkAddContext.Provider value={{ pendingItems, enqueue, resolve, clear }}>
      {children}
    </BulkAddContext.Provider>
  );
}

export function useBulkAdd() {
  const ctx = useContext(BulkAddContext);
  if (!ctx) throw new Error("useBulkAdd must be used within BulkAddProvider");
  return ctx;
}
