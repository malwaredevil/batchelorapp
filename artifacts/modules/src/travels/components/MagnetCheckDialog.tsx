import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  useCheckMagnet,
  getTripPhotoImageUrl,
  type MagnetCheckResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Camera,
  CheckCircle2,
  HelpCircle,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const VERDICT_COPY: Record<
  MagnetCheckResult["verdict"],
  { label: string; icon: React.ReactNode; className: string }
> = {
  likely_owned: {
    label: "You already have this magnet",
    icon: <CheckCircle2 className="w-5 h-5 text-green-600" />,
    className: "bg-green-50 border-green-200 text-green-800",
  },
  possible_match: {
    label: "Possible match — take a closer look",
    icon: <HelpCircle className="w-5 h-5 text-amber-600" />,
    className: "bg-amber-50 border-amber-200 text-amber-800",
  },
  no_match: {
    label: "No match found — looks new!",
    icon: <XCircle className="w-5 h-5 text-muted-foreground" />,
    className: "bg-muted border-border text-muted-foreground",
  },
};

export function MagnetCheckDialog({
  trigger,
}: {
  trigger?: (props: { onClick: () => void }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<MagnetCheckResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const checkMagnet = useCheckMagnet({
    mutation: {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Check failed"),
    },
  });

  const reset = () => {
    setPreview(null);
    setResult(null);
    checkMagnet.reset();
  };

  const handleOpen = () => {
    reset();
    setOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setResult(null);
    const formData = new FormData();
    formData.append("photo", file);
    checkMagnet.mutate(formData, { onSuccess: setResult });
  };

  return (
    <>
      {trigger ? (
        trigger({ onClick: handleOpen })
      ) : (
        <Button size="sm" variant="outline" onClick={handleOpen}>
          <Search className="w-3.5 h-3.5 mr-1.5" />
          Check a magnet
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Do I have this magnet?</DialogTitle>
            <DialogDescription>
              Snap or upload a photo to check it against your collection.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />

            {preview ? (
              <img
                src={preview}
                alt="Magnet to check"
                className="w-full aspect-square object-cover rounded-lg"
              />
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full aspect-square rounded-lg border-2 border-dashed border-border/60 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              >
                <Camera className="w-8 h-8" />
                <span className="text-sm">Take or choose a photo</span>
              </button>
            )}

            {preview && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="w-3.5 h-3.5 mr-1.5" />
                Try another photo
              </Button>
            )}

            {checkMagnet.isPending && (
              <p className="text-sm text-center text-muted-foreground">
                Checking your collection...
              </p>
            )}

            {result && (
              <div className="space-y-3">
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${VERDICT_COPY[result.verdict].className}`}
                >
                  {VERDICT_COPY[result.verdict].icon}
                  {VERDICT_COPY[result.verdict].label}
                </div>

                {result.matches.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      Closest matches
                    </p>
                    {result.matches.map((match) => (
                      <Link
                        key={match.photoId}
                        href={`/travels/trips/${match.tripId}`}
                        onClick={() => setOpen(false)}
                      >
                        <div className="flex items-center gap-3 rounded-lg border border-border/50 p-2 hover:border-primary/30 transition-colors cursor-pointer">
                          <img
                            src={getTripPhotoImageUrl(
                              match.tripId,
                              match.photoId,
                            )}
                            alt=""
                            className="w-12 h-12 rounded-md object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {match.tripTitle}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {Math.round(match.similarity * 100)}% similar
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
