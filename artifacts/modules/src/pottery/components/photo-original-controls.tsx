import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPotteryPhotoOriginalInfo,
  restorePotteryPhotoOriginal,
  getGetPotteryQueryKey,
  getListPotteryQueryKey,
} from "@workspace/api-client-react";
import { ImageLightbox } from "@workspace/collection-ui";
import { toast } from "sonner";
import { Eye, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface PhotoOriginalControlsProps {
  itemId: number;
  imageId: number | null;
  onRestored: () => void;
}

export function PhotoOriginalControls({
  itemId,
  imageId,
  onRestored,
}: PhotoOriginalControlsProps) {
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState("");
  const queryKey = ["pottery-photo-original", itemId, imageId] as const;

  const info = useQuery({
    queryKey,
    queryFn: () => getPotteryPhotoOriginalInfo(itemId, imageId),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const restore = useMutation({
    mutationFn: () =>
      restorePotteryPhotoOriginal(itemId, imageId, restoreVersion),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: getGetPotteryQueryKey(itemId),
        }),
        queryClient.invalidateQueries({ queryKey: getListPotteryQueryKey() }),
      ]);
      onRestored();
      toast.success("Original photo restored.");
    },
    onError: () => toast.error("Couldn't restore the original. Try again."),
  });

  if (info.isLoading) {
    return <Skeleton className="h-11 w-full rounded-xl" />;
  }

  if (info.isError || !info.data) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-card-border bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-muted-foreground">
          Couldn't check for a saved original.
        </span>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => void info.refetch()}
          disabled={info.isFetching}
        >
          {info.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Retry
        </Button>
      </div>
    );
  }

  const data = info.data;

  if (!data.available) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-card-border bg-card p-3 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          No original copy is saved yet. A safety copy will be kept the next
          time you edit this photo.
        </span>
      </p>
    );
  }

  const label =
    data.source === "existing" ? "Earliest saved copy" : "Protected original";
  const note =
    data.source === "existing"
      ? "Edits made before protection started can't be undone."
      : "Kept safe from edits.";
  const url = data.imageUrl;

  return (
    <div className="space-y-2 rounded-xl border border-card-border bg-card p-3">
      <div className="flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-muted-foreground">
            {data.isCurrentOriginal
              ? `${data.source === "existing" ? "This photo matches the earliest saved copy." : "This photo is the original."} ${note}`
              : note}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {url && (
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            onClick={() => setViewing(true)}
          >
            <Eye className="h-4 w-4" />
            {data.source === "existing" ? "View saved copy" : "View original"}
          </Button>
        )}
        {!data.isCurrentOriginal && (
          <Button
            variant="outline"
            className="min-h-11 flex-1"
            onClick={() => {
              setRestoreVersion(data.version);
              setConfirming(true);
            }}
            disabled={restore.isPending}
          >
            {restore.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            {data.source === "existing"
              ? "Restore saved copy"
              : "Restore original"}
          </Button>
        )}
      </div>

      {url && (
        <ImageLightbox
          src={url}
          alt={label}
          title={label}
          open={viewing}
          onClose={() => setViewing(false)}
        />
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the saved photo?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current edits to this photo will be replaced. The saved copy
              stays protected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => restore.mutate()}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
