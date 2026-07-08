import { useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Loader2, ScanSearch, RotateCcw, Camera } from "lucide-react";
import { useCompareFabric } from "@workspace/api-client-react";
import { ImagePicker } from "@/components/image-picker";
import { ImageEditor } from "@/components/image-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { usePageAssistantContext } from "@/lib/assistant-context";

type Verdict = "yes" | "maybe" | "no";

function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        verdict === "yes" &&
          "bg-green-500/15 text-green-700 dark:text-green-400",
        verdict === "maybe" &&
          "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        verdict === "no" && "bg-muted text-muted-foreground",
      )}
    >
      {verdict === "yes" && <CheckCircle2 className="h-3 w-3" />}
      {verdict === "maybe" && <AlertCircle className="h-3 w-3" />}
      {verdict === "no" && <XCircle className="h-3 w-3" />}
      {verdict === "yes" ? "Yes" : verdict === "maybe" ? "Maybe" : "No"}
    </span>
  );
}

function VerdictCard({
  title,
  verdict,
  copy,
}: {
  title: string;
  verdict: Verdict;
  copy: string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <VerdictPill verdict={verdict} />
      </div>
      <p className="mt-2 text-sm">{copy}</p>
    </div>
  );
}

const SAME_PATTERN_COPY: Record<Verdict, string> = {
  yes: "You very likely already own this pattern.",
  maybe:
    "You may own something with a similar pattern — check the matches below.",
  no: "This pattern looks new to your collection.",
};

const EXACT_FABRIC_COPY: Record<Verdict, string> = {
  yes: "This looks like a fabric you already have.",
  maybe: "This could be a fabric you already have — worth a closer look.",
  no: "This exact fabric doesn't appear to be in your collection.",
};

type CompareResult = {
  summary: string;
  ownsSamePattern: Verdict;
  ownsExactFabric: Verdict;
  matches: Array<{
    fabric: {
      id: number;
      name: string;
      imageUrl: string;
      designer?: string | null;
    };
    similarity: number;
    samePattern: Verdict;
    exactFabric: Verdict;
    explanation: string;
  }>;
};

function MatchRow({ match }: { match: CompareResult["matches"][number] }) {
  const pct = Math.round(match.similarity * 100);
  return (
    <Link
      href={`/fabrics/${match.fabric.id}`}
      className="flex gap-3 rounded-xl border border-card-border bg-card p-3 transition hover:shadow-md"
    >
      <img
        src={match.fabric.imageUrl}
        alt={match.fabric.name}
        className="h-20 w-20 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium">{match.fabric.name}</p>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {pct}% match
          </span>
        </div>
        {match.fabric.designer && (
          <p className="text-xs text-muted-foreground">
            {match.fabric.designer}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Pattern <VerdictPill verdict={match.samePattern} />
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Exact <VerdictPill verdict={match.exactFabric} />
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
          {match.explanation}
        </p>
      </div>
    </Link>
  );
}

function Results({
  result,
  onReset,
}: {
  result: CompareResult;
  onReset: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-sm" data-testid="text-summary">
          {result.summary}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <VerdictCard
          title="Own this pattern?"
          verdict={result.ownsSamePattern}
          copy={SAME_PATTERN_COPY[result.ownsSamePattern]}
        />
        <VerdictCard
          title="Own this exact fabric?"
          verdict={result.ownsExactFabric}
          copy={EXACT_FABRIC_COPY[result.ownsExactFabric]}
        />
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold tracking-tight">
          {result.matches.length > 0
            ? "Closest fabrics you own"
            : "No close matches found"}
        </h2>
        <div className="space-y-2">
          {result.matches.map((m) => (
            <MatchRow key={m.fabric.id} match={m} />
          ))}
        </div>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={onReset}
        data-testid="button-compare-again"
      >
        <RotateCcw className="h-4 w-4" />
        Check another photo
      </Button>
    </div>
  );
}

export default function Compare() {
  const [file, setFile] = useState<File | null>(null);
  const [editingFile, setEditingFile] = useState<File | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);

  usePageAssistantContext(
    "quilting-compare",
    "Compare page: upload a photo of a fabric to check whether it (or something with the same pattern) already exists in the stash. This is a photo-upload flow — you cannot run a comparison on the user's behalf from chat.",
  );

  const compare = useCompareFabric({
    mutation: {
      onSuccess: (data) => setResult(data as CompareResult),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Comparison failed."),
    },
  });

  function handleSelect(f: File | null) {
    if (f) {
      setEditingFile(f);
    } else {
      setFile(null);
    }
  }

  function handleEditorSave(edited: File) {
    setFile(edited);
    setEditingFile(null);
  }

  function run() {
    if (!file) {
      toast.error("Please choose a photo first.");
      return;
    }
    compare.mutate({ data: { image: file } });
  }

  function reset() {
    setFile(null);
    setResult(null);
    compare.reset();
  }

  return (
    <>
      {editingFile && (
        <ImageEditor
          file={editingFile}
          onSave={handleEditorSave}
          onCancel={() => setEditingFile(null)}
        />
      )}

      <div className="mx-auto max-w-xl">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">
            Do I own this fabric?
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload a photo to check whether you already own this fabric or its
            pattern
          </p>
        </div>

        {result ? (
          <Results result={result} onReset={reset} />
        ) : compare.isPending ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-card-border bg-card py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-medium">Analysing photo…</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Detecting the pattern and searching your collection. This can take
              a few seconds.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <ImagePicker file={file} onSelect={handleSelect} />
            <Button
              className="w-full"
              onClick={run}
              disabled={!file}
              data-testid="button-run-compare"
            >
              <ScanSearch className="h-4 w-4" />
              Check my collection
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
