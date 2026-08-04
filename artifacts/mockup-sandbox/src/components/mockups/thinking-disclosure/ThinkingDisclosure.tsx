import { useRef, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

// ── Inline replica of the ThinkingDisclosure from lib/elaine-ui ──────────────
// Copied exactly from ElaineChatPanel.tsx so this mockup reflects production code.

function formatThinkingDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function ThinkingDisclosure({
  summary,
  streaming = false,
  durationMs,
}: {
  summary: string;
  streaming?: boolean;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(streaming);
  const userToggledRef = useRef(false);
  const wasStreamingRef = useRef(streaming);

  useEffect(() => {
    if (streaming) {
      setOpen(true);
    } else if (wasStreamingRef.current && !userToggledRef.current) {
      setOpen(false);
    }
    wasStreamingRef.current = streaming;
  }, [streaming]);

  const label = streaming
    ? "Thinking…"
    : durationMs !== undefined
      ? `Thought for ${formatThinkingDuration(durationMs)}`
      : "Thinking";

  return (
    <div className="rounded-xl border border-border/50 bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <span className="font-medium transition-opacity duration-150">
          {label}
        </span>
      </button>
      {/* Grid-row height animation: 0fr → 1fr */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="px-3 pb-3 pt-0 text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {summary}
            {streaming && (
              <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-muted-foreground" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Streaming simulation ──────────────────────────────────────────────────────

const FULL_SUMMARY =
  "The user is asking about their upcoming trip to Barcelona. I should check the itinerary and look for relevant details: flight times, hotel check-in, any confirmed activities. I'll also check if there are any reminders set for this trip before composing my response.";

function StreamingDemo() {
  const [phase, setPhase] = useState<"streaming" | "done" | "idle">("idle");
  const [summary, setSummary] = useState("");

  function startDemo() {
    setPhase("streaming");
    setSummary("");
    let i = 0;
    const interval = setInterval(() => {
      i += 4;
      if (i >= FULL_SUMMARY.length) {
        setSummary(FULL_SUMMARY);
        clearInterval(interval);
        // After 600ms simulate turn-complete → auto-collapse
        setTimeout(() => setPhase("done"), 600);
      } else {
        setSummary(FULL_SUMMARY.slice(0, i));
      }
    }, 30);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        Streaming → auto-collapse on finish
      </p>
      {phase !== "idle" && (
        <ThinkingDisclosure
          summary={summary}
          streaming={phase === "streaming"}
          durationMs={phase === "done" ? 4200 : undefined}
        />
      )}
      {phase === "idle" && (
        <button
          onClick={startDemo}
          className="self-start rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          ▶ Run streaming demo
        </button>
      )}
      {phase === "done" && (
        <button
          onClick={() => setPhase("idle")}
          className="self-start rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          ↩ Reset
        </button>
      )}
    </div>
  );
}

// ── Full preview page ─────────────────────────────────────────────────────────

export default function Preview() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            ThinkingDisclosure – visual QA
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verifies the grid-row animation across all states and both
            narrow (widget ~320 px) and wide (full-page ~640 px) containers.
          </p>
        </div>

        {/* ── Narrow container (floating widget width) ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">
            Narrow container · 320 px (floating widget)
          </h2>
          <div className="w-80 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Closed (default after finish)</p>
            <ThinkingDisclosure
              summary={FULL_SUMMARY}
              durationMs={3100}
            />

            <p className="text-xs text-muted-foreground mt-4">Open (user-expanded)</p>
            <OpenedDisclosure summary={FULL_SUMMARY} durationMs={3100} />

            <p className="text-xs text-muted-foreground mt-4">Live streaming</p>
            <ThinkingDisclosure
              summary="I should check what trips are coming up…"
              streaming={true}
            />
          </div>
        </section>

        {/* ── Wide container (full-page chat) ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">
            Wide container · full width (full-page chat)
          </h2>
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Closed</p>
            <ThinkingDisclosure
              summary={FULL_SUMMARY}
              durationMs={8500}
            />

            <p className="text-xs text-muted-foreground mt-4">Open</p>
            <OpenedDisclosure summary={FULL_SUMMARY} durationMs={8500} />

            <p className="text-xs text-muted-foreground mt-4">Streaming</p>
            <ThinkingDisclosure
              summary="The user wants to know about pottery glazing techniques. Let me think about what I know from their collection and any relevant resources I can surface…"
              streaming={true}
            />
          </div>
        </section>

        {/* ── Interactive streaming demo ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">
            Interactive demo
          </h2>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <StreamingDemo />
          </div>
        </section>

        {/* ── Layout-overflow check ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">
            No overflow · long summary text
          </h2>
          <div className="w-64 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <OpenedDisclosure
              summary={FULL_SUMMARY + "\n\n" + FULL_SUMMARY}
              durationMs={12000}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Helper: renders a ThinkingDisclosure that starts open (simulates user-expanded). */
function OpenedDisclosure({
  summary,
  durationMs,
}: {
  summary: string;
  durationMs?: number;
}) {
  // We initialise streaming=true so the component starts open,
  // then immediately flip it to false to simulate a finished turn
  // where the user has "already toggled" (open stays).
  const [key] = useState(() => Math.random());
  return (
    <_OpenedDisclosureInner key={key} summary={summary} durationMs={durationMs} />
  );
}

function _OpenedDisclosureInner({
  summary,
  durationMs,
}: {
  summary: string;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(true);

  const label =
    durationMs !== undefined
      ? `Thought for ${formatThinkingDuration(durationMs)}`
      : "Thinking";

  return (
    <div className="rounded-xl border border-border/50 bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <span className="font-medium transition-opacity duration-150">{label}</span>
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="px-3 pb-3 pt-0 text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {summary}
          </div>
        </div>
      </div>
    </div>
  );
}
