import { useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Camera,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFabric,
  getListFabricsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useBulkAdd } from "@/contexts/bulk-add-context";

type ItemStatus = "queued" | "processing" | "done" | "error";

interface CaptureItem {
  clientId: string;
  file: File;
  preview: string;
  status: ItemStatus;
  name?: string;
}

const CONCURRENCY = 2;

export default function BulkAddFabric() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<CaptureItem[]>([]);

  const semaphoreRef = useRef(0);
  const waitlistRef = useRef<CaptureItem[]>([]);

  const { enqueue, resolve } = useBulkAdd();

  async function runItem(item: CaptureItem) {
    setItems((prev) =>
      prev.map((i) =>
        i.clientId === item.clientId ? { ...i, status: "processing" } : i,
      ),
    );

    try {
      const result = await createFabric({ image: item.file });
      queryClient.invalidateQueries({ queryKey: getListFabricsQueryKey() });
      resolve(item.clientId, "done");
      setItems((prev) =>
        prev.map((i) =>
          i.clientId === item.clientId
            ? { ...i, status: "done", name: result.name ?? undefined }
            : i,
        ),
      );
    } catch {
      resolve(item.clientId, "error");
      setItems((prev) =>
        prev.map((i) =>
          i.clientId === item.clientId ? { ...i, status: "error" } : i,
        ),
      );
    } finally {
      semaphoreRef.current--;
      const next = waitlistRef.current.shift();
      if (next) {
        semaphoreRef.current++;
        runItem(next);
      }
    }
  }

  function scheduleItem(item: CaptureItem) {
    if (semaphoreRef.current < CONCURRENCY) {
      semaphoreRef.current++;
      runItem(item);
    } else {
      waitlistRef.current.push(item);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";

    const clientId = crypto.randomUUID();
    const preview = URL.createObjectURL(f);
    const item: CaptureItem = { clientId, file: f, preview, status: "queued" };

    setItems((prev) => [...prev, item]);
    enqueue(clientId, preview);
    scheduleItem(item);
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const totalCount = items.length;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/fabrics")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Bulk Add Fabrics</h1>
      </div>

      {/* Capture zone */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="relative flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-card py-10 transition-colors hover:border-primary hover:bg-muted/30"
      >
        <div className="absolute left-3 top-3 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-primary/60" />
        <div className="absolute right-3 top-3 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-primary/60" />
        <div className="absolute bottom-3 left-3 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-primary/60" />
        <div className="absolute bottom-3 right-3 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-primary/60" />

        {totalCount > 0 && (
          <div className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {totalCount} captured
          </div>
        )}

        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Camera className="h-7 w-7 text-primary" />
        </div>
        <span className="text-sm font-semibold text-foreground">
          Tap to capture
        </span>
        <span className="text-xs text-muted-foreground">
          Tap again after each shot to add more
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <Button className="mt-4 w-full" onClick={() => navigate("/fabrics")}>
        Done
      </Button>

      {items.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Processing queue
            </p>
            <p className="text-xs text-muted-foreground">
              {doneCount}/{totalCount} saved
            </p>
          </div>
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.clientId}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2.5"
              >
                <img
                  src={item.preview}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  {item.status === "done" ? (
                    <>
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.name ?? "Fabric"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Saved to collection
                      </p>
                    </>
                  ) : item.status === "error" ? (
                    <>
                      <p className="truncate text-sm font-medium text-destructive">
                        Upload failed
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Could not save this fabric
                      </p>
                    </>
                  ) : item.status === "queued" ? (
                    <>
                      <p className="truncate text-sm font-medium text-muted-foreground">
                        Queued…
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Waiting to process
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium text-muted-foreground">
                        Analysing…
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        AI cataloguing in progress
                      </p>
                    </>
                  )}
                </div>
                {item.status === "done" && (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                )}
                {(item.status === "processing" ||
                  item.status === "queued") && (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                )}
                {item.status === "error" && (
                  <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
