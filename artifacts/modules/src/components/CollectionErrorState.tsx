import { useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CollectionErrorStateProps {
  onRetry: () => Promise<unknown>;
  message?: string;
}

export function CollectionErrorState({
  onRetry,
  message = "Couldn't load your collection.",
}: CollectionErrorStateProps) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <p className="text-center text-sm">{message}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
        disabled={retrying}
      >
        <RefreshCw
          className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`}
        />
        Try again
      </Button>
    </div>
  );
}
