import { useRef, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createOrnamentFromImage,
  uploadOrnamentImage,
  getListOrnamentsQueryKey,
  getGetOrnamentStatsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { usePageAssistantContext } from "@/ornaments/lib/assistant-context";
import {
  STANDARD_IMAGE_UPLOAD,
  validateClientUpload,
} from "@workspace/upload-policy";

type ItemStatus = "queued" | "processing" | "done" | "error";

interface CaptureItem {
  clientId: string;
  file: File;
  preview: string;
  status: ItemStatus;
  label?: string;
}

export default function CameraAddOrnament() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<CaptureItem[]>([]);

  const ornamentIdRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const waitlistRef = useRef<CaptureItem[]>([]);

  usePageAssistantContext(
    "ornaments-camera-add",
    `Camera Add Ornament: take photos to add a new ornament. First photo creates the ornament and AI identifies it automatically. Subsequent photos are added as supplemental images. ${items.length} photo(s) captured this session. This is a camera/photo-capture flow — you cannot add photos on the user's behalf from chat.`,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      fileInputRef.current?.click();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  async function processItem(item: CaptureItem) {
    processingRef.current = true;
    setItems((prev) =>
      prev.map((i) =>
        i.clientId === item.clientId ? { ...i, status: "processing" } : i,
      ),
    );

    try {
      const formData = new FormData();
      formData.append("image", item.file);

      if (ornamentIdRef.current === null) {
        const result = await createOrnamentFromImage(formData);
        ornamentIdRef.current = result.id;
        queryClient.invalidateQueries({ queryKey: getListOrnamentsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetOrnamentStatsQueryKey(),
        });
        setItems((prev) =>
          prev.map((i) =>
            i.clientId === item.clientId
              ? { ...i, status: "done", label: result.name ?? "Ornament" }
              : i,
          ),
        );
      } else {
        await uploadOrnamentImage(ornamentIdRef.current, formData);
        setItems((prev) =>
          prev.map((i) =>
            i.clientId === item.clientId
              ? { ...i, status: "done", label: item.label }
              : i,
          ),
        );
      }
    } catch {
      setItems((prev) =>
        prev.map((i) =>
          i.clientId === item.clientId ? { ...i, status: "error" } : i,
        ),
      );
      toast.error("Upload failed — try again.", { duration: 5000 });
    } finally {
      processingRef.current = false;
      const next = waitlistRef.current.shift();
      if (next) {
        processItem(next);
      }
    }
  }

  function scheduleItem(item: CaptureItem) {
    if (!processingRef.current) {
      processItem(item);
    } else {
      waitlistRef.current.push(item);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";

    const validation = validateClientUpload(f, STANDARD_IMAGE_UPLOAD);
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    const clientId = crypto.randomUUID();
    const preview = URL.createObjectURL(f);
    const photoNum = items.length + waitlistRef.current.length + 1;
    const label =
      ornamentIdRef.current !== null
        ? `Supplemental photo ${photoNum}`
        : undefined;
    const item: CaptureItem = {
      clientId,
      file: f,
      preview,
      status: "queued",
      label,
    };

    setItems((prev) => [...prev, item]);
    scheduleItem(item);
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const hasOrnament = ornamentIdRef.current !== null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/ornaments/")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Add Ornament</h1>
          <p className="text-sm text-muted-foreground">
            {hasOrnament
              ? "Keep tapping to add more angles"
              : "First photo — AI will identify and catalogue it"}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="relative flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-card py-10 transition-colors hover:border-primary hover:bg-muted/30"
      >
        <div className="absolute left-3 top-3 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-primary/60" />
        <div className="absolute right-3 top-3 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-primary/60" />
        <div className="absolute bottom-3 left-3 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-primary/60" />
        <div className="absolute bottom-3 right-3 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-primary/60" />

        {items.length > 0 && (
          <div className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            {items.length} captured
          </div>
        )}

        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Camera className="h-7 w-7 text-primary" />
        </div>
        <span className="text-sm font-semibold text-foreground">
          {items.length === 0
            ? "Tap to photograph ornament"
            : "Tap to add another photo"}
        </span>
        <span className="text-xs text-muted-foreground">
          {items.length === 0
            ? "AI will identify and catalogue it automatically"
            : "Tap again after each shot to add more angles"}
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

      <div className="mt-4 flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => navigate("/ornaments/")}
        >
          {hasOrnament ? "Done" : "Cancel"}
        </Button>
        {hasOrnament && (
          <Button
            className="flex-1"
            onClick={() =>
              navigate(`/ornaments/ornament/${ornamentIdRef.current}`)
            }
          >
            View Ornament →
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Processing queue
            </p>
            <p className="text-xs text-muted-foreground">
              {doneCount}/{items.length} saved
            </p>
          </div>
          <div className="space-y-2">
            {[...items].reverse().map((item) => (
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
                        {item.label ?? "Photo saved"}
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
                        Could not save this photo
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
                {(item.status === "processing" || item.status === "queued") && (
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
