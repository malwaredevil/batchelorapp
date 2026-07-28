import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface GalleryPaginatorProps {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  className?: string;
}

function getPageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | "…")[] = [1];
  const rangeStart = Math.max(2, page - 2);
  const rangeEnd = Math.min(totalPages - 1, page + 2);
  if (rangeStart > 2) pages.push("…");
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (rangeEnd < totalPages - 1) pages.push("…");
  pages.push(totalPages);
  return pages;
}

export function GalleryPaginator({
  page,
  totalPages,
  onPageChange,
  className,
}: GalleryPaginatorProps) {
  const [jumpVal, setJumpVal] = useState("");

  if (totalPages <= 1) return null;

  const pages = getPageNumbers(page, totalPages);

  function handleJump(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(jumpVal, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange(n);
      setJumpVal("");
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-1",
        className,
      )}
    >
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {pages.map((p, i) =>
        p === "…" ? (
          <span
            key={`ellipsis-${i}`}
            className="flex h-8 w-6 items-center justify-center text-sm text-muted-foreground select-none"
          >
            …
          </span>
        ) : (
          <Button
            key={p}
            variant={p === page ? "default" : "outline"}
            size="icon"
            className="h-8 w-8 text-sm"
            onClick={() => onPageChange(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </Button>
        ),
      )}

      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {totalPages > 5 && (
        <form
          onSubmit={handleJump}
          className="ml-2 flex items-center gap-1.5"
          aria-label="Go to page"
        >
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={jumpVal}
            onChange={(e) => setJumpVal(e.target.value)}
            placeholder={`/ ${totalPages}`}
            className="h-8 w-16 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-label="Jump to page number"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
          >
            Go
          </Button>
        </form>
      )}
    </div>
  );
}
