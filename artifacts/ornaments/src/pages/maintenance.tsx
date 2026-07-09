import { useState } from "react";
import { Link } from "wouter";
import {
  Loader2,
  Wrench,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import {
  useGetOrnamentStragglers,
  useBulkReanalyzeOrnaments,
  getGetOrnamentStragglersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export default function Maintenance() {
  const { data: stragglers, isLoading } = useGetOrnamentStragglers();
  const bulkReanalyze = useBulkReanalyzeOrnaments();
  const queryClient = useQueryClient();

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const items = stragglers?.items || [];

  usePageAssistantContext(
    "ornaments-maintenance",
    `Maintenance page. Shows items missing descriptions or photos. Currently ${items.length} items need attention.`,
  );

  const handleBulkReanalyze = async () => {
    if (items.length === 0) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      const ids = items.map((i) => i.id);

      // Since it could be a lot of items, let's chunk them conceptually or just show a spinner
      // For now, we'll just send them all to the bulk endpoint which handles its own logic
      await bulkReanalyze.mutateAsync({ data: { ids } });

      toast.success(`Started reanalysis for ${ids.length} items`);
      queryClient.invalidateQueries({
        queryKey: getGetOrnamentStragglersQueryKey(),
      });
    } catch (err) {
      toast.error("Failed to start bulk reanalysis");
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">
          Maintenance
        </h1>
        <p className="text-muted-foreground mt-1">
          Keep your collection data rich and searchable
        </p>
      </div>

      <Card className="border-card-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 font-serif text-xl">
                <Wrench className="h-5 w-5 text-primary" />
                AI Re-analysis
              </CardTitle>
              <CardDescription className="mt-1.5">
                Automatically extract motifs, dominant colors, and generate
                descriptions for items missing them.
              </CardDescription>
            </div>

            {items.length > 0 ? (
              <div className="flex items-center gap-2 text-amber-600 bg-amber-500/10 px-3 py-1.5 rounded-full text-sm font-medium">
                <AlertCircle className="h-4 w-4" />
                {items.length} need attention
              </div>
            ) : (
              <div className="flex items-center gap-2 text-green-600 bg-green-500/10 px-3 py-1.5 rounded-full text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" />
                All up to date
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {items.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                These items are missing AI descriptions, embedded features, or
                attributes that help them show up in searches and suggestions.
              </p>

              <Button
                onClick={handleBulkReanalyze}
                disabled={isProcessing || bulkReanalyze.isPending}
                className="gap-2"
              >
                {isProcessing || bulkReanalyze.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Analyze {items.length} items
              </Button>

              {(isProcessing || progress === 100) && (
                <div className="space-y-2 mt-4">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-right">
                    {progress < 100 ? "Processing on server..." : "Finished"}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {items.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-foreground">
            Items needing attention
          </h2>
          <div className="rounded-xl border border-card-border bg-card overflow-hidden divide-y divide-card-border shadow-sm">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/ornament/${item.id}`}
                className="flex items-center justify-between p-4 hover:bg-muted/40 transition-colors group"
              >
                <div>
                  <p className="font-medium">Ornament #{item.id}</p>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">
                    Missing: {item.reasons.join(", ")}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
