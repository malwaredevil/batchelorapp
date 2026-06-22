import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Loader2, ScanSearch, RotateCcw } from "lucide-react";
import type { PotteryCompareResult as CompareResult, PotteryMatchResult as MatchResult } from "@workspace/api-client-react";
import { useUploadCompare } from "@/hooks/use-pottery";
import { ImagePicker } from "@/components/image-picker";
import { ImageEditor } from "@/components/image-editor";
import { VerdictPill, type Verdict } from "@/components/verdict";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

const EXACT_PIECE_COPY: Record<Verdict, string> = {
  yes: "This looks like a piece you already have.",
  maybe: "This could be a piece you already have — worth a closer look.",
  no: "This exact piece doesn't appear to be in your collection.",
};

function MatchRow({ match }: { match: MatchResult }) {
  const pct = Math.round(match.similarity * 100);
  return (
    <Link
      href={`/piece/${match.item.id}`}
      className="flex gap-3 rounded-xl border border-card-border bg-card p-3 transition hover:shadow-md"
      data-testid={`match-${match.item.id}`}
    >
      <img
        src={match.item.imageUrl}
        alt={match.item.name}
        className="h-20 w-20 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium">{match.item.name}</p>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {pct}% match
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Pattern <VerdictPill verdict={match.samePattern} />
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Same piece <VerdictPill verdict={match.exactPiece} />
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
          title="Own this exact piece?"
          verdict={result.ownsExactPiece}
          copy={EXACT_PIECE_COPY[result.ownsExactPiece]}
        />
      </div>

      {(result.candidate.dominantColors.length > 0 ||
        result.candidate.motifs.length > 0) && (
        <div className="rounded-xl border border-card-border bg-card p-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            In this photo
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {result.candidate.dominantColors.map((c, i) => (
              <span
                key={`c-${i}`}
                className="flex items-center gap-1.5 rounded-full border border-card-border py-1 pl-1.5 pr-2.5 text-xs"
              >
                <span
                  className="h-3 w-3 rounded-full border border-black/10"
                  style={{ backgroundColor: c }}
                />
                {c}
              </span>
            ))}
            {result.candidate.motifs.map((m, i) => (
              <Badge key={`m-${i}`} variant="secondary">
                {m}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-bold tracking-tight">
          {result.matches.length > 0
            ? "Closest pieces you own"
            : "No close matches found"}
        </h2>
        <div className="space-y-2">
          {result.matches.map((m) => (
            <MatchRow key={m.item.id} match={m} />
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
  const compare = useUploadCompare();
  const result = compare.data;

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
    compare.mutate(
      { image: file },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Comparison failed.",
          ),
      },
    );
  }

  function reset() {
    setFile(null);
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
          <h1 className="text-2xl font-bold tracking-tight">Compare a photo</h1>
          <p className="text-sm text-muted-foreground">
            Check whether you already own a piece or its pattern before you buy
          </p>
        </div>

        {result ? (
          <Results result={result} onReset={reset} />
        ) : compare.isPending ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-card-border bg-card py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-medium">Analyzing photo…</p>
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
