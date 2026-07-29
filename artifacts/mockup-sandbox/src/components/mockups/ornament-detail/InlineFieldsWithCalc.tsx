import {
  ArrowLeft,
  RefreshCw,
  Download,
  Pencil,
  Trash2,
  Lock,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";

// ── Calculations from real data ──────────────────────────────────────────────
const BOOK_VALUE = 16.99; // HooH collector catalog
const EBAY_LOW = 13.99; // eBay "For Sale Now" low
const EBAY_HIGH = 16.99; // eBay "For Sale Now" high
const AI_LOW = 10; // AI appraisal range low
const AI_HIGH = 18; // AI appraisal range high

const ebayMid = (EBAY_LOW + EBAY_HIGH) / 2; // $15.49
const aiMid = (AI_LOW + AI_HIGH) / 2; // $14.00
const consensus = (ebayMid + aiMid + BOOK_VALUE) / 3; // $15.49
const vsBook = ebayMid - BOOK_VALUE; // -$1.50
const vsBookPct = ((ebayMid - BOOK_VALUE) / BOOK_VALUE) * 100; // -8.8%

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function Field({
  label,
  value,
  locked,
  empty,
}: {
  label: string;
  value: React.ReactNode;
  locked?: boolean;
  empty?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/60 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
          {label}
        </p>
        <p
          className={`text-sm break-words ${empty ? "text-muted-foreground/60 italic" : ""}`}
        >
          {value}
        </p>
      </div>
      {locked !== undefined && (
        <button className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted text-muted-foreground/40">
          <Lock className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function SectionSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-0.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/50 shrink-0">
        {label}
      </p>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}

// A calculated (read-only) field row — visually identical to CollectionDetailField
// but with a subtle "calc" indicator to signal it's derived, not stored
function CalcField({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/60 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40 border border-border/50 rounded px-1 leading-tight">
            calc
          </span>
        </div>
        <p className="text-sm break-words">{value}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

export function InlineFieldsWithCalc() {
  const aboveBook = vsBook > 0.5;
  const belowBook = vsBook < -0.5;

  return (
    <div className="min-h-screen bg-background px-6 py-6">
      <div className="mx-auto max-w-3xl">
        {/* Back nav */}
        <button className="mb-4 -ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Ornaments
        </button>

        {/* Hero: two-column grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* ── Left: gallery ── */}
          <div className="space-y-4">
            <div className="aspect-square w-full rounded-2xl overflow-hidden bg-gradient-to-br from-rose-50 to-amber-50 flex items-center justify-center shadow-sm">
              <p className="text-muted-foreground/30 text-xs uppercase tracking-widest">
                Primary Photo
              </p>
            </div>
            <div className="flex gap-2">
              {[
                "from-red-100 to-pink-100",
                "from-amber-100 to-yellow-50",
                "from-emerald-50 to-teal-100",
              ].map((g, i) => (
                <div
                  key={i}
                  className={`h-16 w-16 rounded-lg bg-gradient-to-br ${g} border border-border/40`}
                />
              ))}
              <div className="h-16 w-16 rounded-lg border-2 border-dashed border-border/40 flex items-center justify-center text-muted-foreground/40 text-lg">
                +
              </div>
            </div>
          </div>

          {/* ── Right: info + actions ── */}
          <div className="flex flex-col gap-4">
            {/* Title + action buttons */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  HALLMARK · 2016
                </p>
                <h1 className="text-2xl font-bold tracking-tight leading-tight">
                  2016 Sweet Decade Snowman
                </h1>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-muted-foreground hover:bg-accent transition-colors">
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-muted-foreground hover:bg-accent transition-colors">
                  <Download className="h-4 w-4" />
                </button>
                <button className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-muted-foreground hover:bg-accent transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <button className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-muted-foreground hover:bg-accent transition-colors">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </button>
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-1">
              <Field label="Brand" value="Hallmark" locked />
              <Field label="Year" value="2016" locked />
              <Field label="Series / Collection" value="Sweet Decade" locked />
              <Field label="Condition" value="Mint in Box" />
              <Field label="Dimensions" value="3.5 in" />
              <Field label="Barcode / UPC" value="661127022308" />

              {/* ── Source data separator ── */}
              <SectionSeparator label="Market Valuations" />

              <Field
                label="Book Value"
                value={
                  <span>
                    {fmt(BOOK_VALUE)}{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      · HooH
                    </span>
                  </span>
                }
              />
              <Field
                label="eBay — For Sale Now"
                value={
                  <span>
                    {fmt(EBAY_LOW)} – {fmt(EBAY_HIGH)}{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      · 7/28/2026
                    </span>
                  </span>
                }
              />
              <Field
                label="AI Collector Appraisal"
                value={
                  <span>
                    ~{fmt(AI_LOW)} – {fmt(AI_HIGH)} est.{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      · 7/28/2026
                    </span>
                  </span>
                }
              />

              {/* ── Calculated fields separator ── */}
              <SectionSeparator label="Calculated" />

              {/*
                eBay Midpoint — simple average of the for-sale range.
                Gives a single representative market price instead of a range.
              */}
              <CalcField
                label="eBay Midpoint"
                value={fmt(ebayMid)}
                sub={`(${fmt(EBAY_LOW)} + ${fmt(EBAY_HIGH)}) ÷ 2`}
              />

              {/*
                vs. Book — how current eBay market compares to the catalog book value.
                Negative = selling below book (possible deal). Positive = above book (high demand).
              */}
              <CalcField
                label="vs. Book Value"
                value={
                  <span className="flex items-center gap-1.5">
                    {belowBook && (
                      <TrendingDown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    )}
                    {aboveBook && (
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    )}
                    {!aboveBook && !belowBook && (
                      <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={
                        belowBook
                          ? "text-amber-600"
                          : aboveBook
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                      }
                    >
                      {vsBook >= 0 ? "+" : ""}
                      {fmt(vsBook)} ({vsBookPct.toFixed(1)}%)
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {belowBook
                        ? "below book"
                        : aboveBook
                          ? "above book"
                          : "at book"}
                    </span>
                  </span>
                }
                sub={`eBay mid ${fmt(ebayMid)} − book ${fmt(BOOK_VALUE)}`}
              />

              {/*
                Consensus Est. Value — average across all three valuation sources
                (eBay mid, AI appraisal mid, book value). Gives a single number
                that balances all available data.
              */}
              <CalcField
                label="Consensus Est. Value"
                value={<span className="font-medium">{fmt(consensus)}</span>}
                sub={`avg of eBay mid ${fmt(ebayMid)}, AI mid ${fmt(aiMid)}, book ${fmt(BOOK_VALUE)}`}
              />

              {/* Categories */}
              <div className="py-1.5 border-b border-border/60 last:border-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  Categories
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["Snowmen", "Christmas", "Hallmark Keepsake"].map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-normal text-secondary-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Description panel */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-2">AI Description</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                This whimsical ornament features a festive snowman surrounded by
                sparkling, candy-like numbers forming "2016". The snowman sports
                a red hat and a colorful striped scarf. Part of the Sweet Decade
                series.
              </p>
            </div>

            {/* Color + motif tags */}
            <div className="flex flex-wrap gap-2">
              {[
                { color: "white", bg: "#ffffff" },
                { color: "red", bg: "#ef4444" },
                { color: "green", bg: "#22c55e" },
                { color: "yellow", bg: "#eab308" },
                { color: "purple", bg: "#a855f7" },
              ].map(({ color, bg }) => (
                <span
                  key={color}
                  className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-xs font-normal"
                >
                  <span
                    className="h-2 w-2 rounded-full inline-block border border-border/30"
                    style={{ background: bg }}
                  />
                  {color}
                </span>
              ))}
              {["snowman", "numbers", "candy", "hat", "scarf"].map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-normal text-secondary-foreground"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
