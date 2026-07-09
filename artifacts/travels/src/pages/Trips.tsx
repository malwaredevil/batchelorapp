import { useState, useRef, useEffect } from "react";
import { Link, useSearch, useLocation } from "wouter";
import {
  useListTrips,
  useCreateTrip,
  useUpdateTrip,
  useCreateReminder,
  useGetTrip,
  getListTripsQueryKey,
  getGetTripQueryKey,
  getGetTravelsStatsQueryKey,
  getTripPhotoImageUrl,
  type TripStatus,
  type TravelsCreateTripBody as CreateTripBody,
  type CreateReminderBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MapPin,
  Plus,
  Plane,
  ArrowRight,
  Filter,
  X,
  Sparkles,
  Loader2,
  CalendarCheck,
} from "lucide-react";
import { toast } from "sonner";
import { MagnetCheckDialog } from "@/components/MagnetCheckDialog";
import { usePageAssistantContext } from "@/lib/assistant-context";

// ---------------------------------------------------------------------------
// AI Trip Planner dialog — streaming SSE response from POST /travels/trips/plan
// ---------------------------------------------------------------------------
type PlannerPhase = "idle" | "streaming" | "done" | "error";

type ItineraryActivity = {
  time?: string;
  name?: string;
  description?: string;
  proximity?: string;
  tip?: string;
  status?: "tentative" | "confirmed";
};

type ItineraryDay = {
  date?: string;
  title?: string;
  activities?: ItineraryActivity[];
};

type Itinerary = { days: ItineraryDay[] };

function parseItinerary(value: unknown): Itinerary | null {
  if (!value || typeof value !== "object") return null;
  const days = (value as Record<string, unknown>)["days"];
  if (!Array.isArray(days)) return null;
  return { days: days as ItineraryDay[] };
}

// ---------------------------------------------------------------------------
// Itinerary merge/diff dialog — lets a user apply an AI-generated itinerary
// onto an existing trip without silently clobbering manually-edited days.
// ---------------------------------------------------------------------------
type MergeMode = "merge" | "replace";

function ItineraryMergeDialog({
  open,
  onOpenChange,
  targetTripId,
  targetTripTitle,
  newItinerary,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetTripId: number | null;
  targetTripTitle: string;
  newItinerary: Itinerary | null;
  onApplied: () => void;
}) {
  const updateTrip = useUpdateTrip();
  const {
    data: targetTrip,
    isLoading: isTargetLoading,
    isError: isTargetError,
    isSuccess: isTargetLoaded,
  } = useGetTrip(targetTripId ?? 0, {
    query: {
      enabled: open && !!targetTripId,
      queryKey: getGetTripQueryKey(targetTripId ?? 0),
    },
  });
  const existingItinerary = parseItinerary(
    (targetTrip as { itinerary?: unknown } | undefined)?.itinerary,
  );
  // Until we've confirmed the target trip's current itinerary, we must not
  // let "Apply" run — otherwise a not-yet-loaded existingItinerary (null)
  // looks identical to "trip has no itinerary" and would silently fall into
  // replace behavior, overwriting manually-edited days we haven't seen yet.
  const canApply = !!targetTripId && isTargetLoaded;

  const [mode, setMode] = useState<MergeMode>("merge");
  const [included, setIncluded] = useState<boolean[]>([]);

  useEffect(() => {
    if (open && newItinerary) {
      setIncluded(newItinerary.days.map(() => true));
    }
  }, [open, newItinerary]);

  useEffect(() => {
    if (open && isTargetLoaded) {
      setMode(existingItinerary?.days?.length ? "merge" : "replace");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isTargetLoaded, targetTrip]);

  if (!newItinerary) return null;

  const existingDates = new Set(
    (existingItinerary?.days ?? [])
      .map((d) => d.date)
      .filter((d): d is string => !!d),
  );

  const handleApply = () => {
    if (targetTripId == null || !canApply) return;
    const selectedNewDays = newItinerary.days.filter((_, i) => included[i]);

    let finalItinerary: Itinerary;
    if (mode === "replace" || !existingItinerary?.days?.length) {
      finalItinerary = { days: selectedNewDays };
    } else {
      const mergedDays = [...existingItinerary.days];
      const appended: ItineraryDay[] = [];
      for (const newDay of selectedNewDays) {
        const idx = newDay.date
          ? mergedDays.findIndex((d) => d.date === newDay.date)
          : -1;
        if (idx >= 0) {
          mergedDays[idx] = newDay;
        } else {
          appended.push(newDay);
        }
      }
      finalItinerary = { days: [...mergedDays, ...appended] };
    }

    updateTrip.mutate(
      { id: targetTripId, data: { itinerary: finalItinerary } },
      {
        onSuccess: () => {
          toast.success("Itinerary applied to trip");
          onApplied();
        },
        onError: () => toast.error("Failed to apply itinerary"),
      },
    );
  };

  const selectedCount = included.filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-primary" />
            Apply itinerary to &quot;{targetTripTitle}&quot;
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isTargetLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg p-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading this trip&apos;s current itinerary…
            </div>
          )}
          {isTargetError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t load this trip&apos;s current itinerary. Try closing
              and reopening this dialog before applying, so we don't risk
              overwriting anything.
            </p>
          )}

          {!!existingItinerary?.days?.length && (
            <div className="space-y-2">
              <Label>
                This trip already has {existingItinerary.days.length} day(s)
                planned.
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("merge")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                    mode === "merge"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <span className="font-medium block">Merge</span>
                  Matching dates get replaced; other existing days stay
                  untouched.
                </button>
                <button
                  type="button"
                  onClick={() => setMode("replace")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                    mode === "replace"
                      ? "border-destructive bg-destructive/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-destructive/50"
                  }`}
                >
                  <span className="font-medium block">Replace all</span>
                  Discards the existing itinerary entirely.
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>
              Days to apply ({selectedCount} of {newItinerary.days.length}{" "}
              selected)
            </Label>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {newItinerary.days.map((day, i) => {
                const collides = !!day.date && existingDates.has(day.date);
                return (
                  <label
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg border border-border/60 p-2.5 text-sm cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={included[i] ?? true}
                      onCheckedChange={(v) =>
                        setIncluded((prev) => {
                          const next = [...prev];
                          next[i] = v === true;
                          return next;
                        })
                      }
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {day.title || `Day ${i + 1}`}
                        </span>
                        {day.date && (
                          <span className="text-xs text-muted-foreground">
                            {day.date}
                          </span>
                        )}
                        {mode === "merge" && collides && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-amber-300 text-amber-700 bg-amber-50"
                          >
                            replaces existing day
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {day.activities?.length ?? 0} activit
                        {day.activities?.length === 1 ? "y" : "ies"}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={
              updateTrip.isPending ||
              selectedCount === 0 ||
              !canApply ||
              isTargetError
            }
          >
            {(updateTrip.isPending || isTargetLoading) && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Apply to trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AiPlannerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();
  const createReminder = useCreateReminder();
  const { data: existingTrips = [] } = useListTrips();

  const [prompt, setPrompt] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [travellerCount, setTravellerCount] = useState(2);
  const [phase, setPhase] = useState<PlannerPhase>("idle");
  const [streamText, setStreamText] = useState("");
  const [scaffold, setScaffold] = useState<Record<string, unknown> | null>(
    null,
  );
  const [applyTarget, setApplyTarget] = useState<"new" | number>("new");
  const [mergeOpen, setMergeOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll streaming text
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamText]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setPhase("idle");
      setStreamText("");
      setScaffold(null);
      setPrompt("");
      setStartDate("");
      setEndDate("");
      setTravellerCount(2);
      setApplyTarget("new");
      setMergeOpen(false);
    }
  }, [open]);

  const handlePlan = async () => {
    if (!prompt.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");
    setStreamText("");
    setScaffold(null);

    try {
      const res = await fetch("/api/travels/trips/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          travellerCount,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: chunk")) continue;
          if (line.startsWith("event: done")) continue;
          if (line.startsWith("event: error")) {
            setPhase("error");
            return;
          }
          if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            try {
              const parsed = JSON.parse(raw) as {
                text?: string;
                scaffold?: Record<string, unknown>;
                error?: string;
              };
              if (parsed.text != null) {
                setStreamText((t) => t + parsed.text);
              }
              if (parsed.scaffold) {
                setScaffold(parsed.scaffold);
              }
              if (parsed.error) {
                setPhase("error");
                return;
              }
            } catch {
              // not JSON — ignore
            }
          }
        }
      }

      setPhase("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setPhase("error");
      toast.error("AI planner failed — please try again");
    }
  };

  const handleCreate = () => {
    if (!scaffold) return;

    // Parse transportTo — AI may return "flew", "drove", "train" or synonyms
    const transportRaw = String(
      scaffold["transportTo"] ?? scaffold["transport"] ?? "",
    );
    const transportTo = (["drove", "flew", "train"] as const).includes(
      transportRaw as "drove" | "flew" | "train",
    )
      ? (transportRaw as "drove" | "flew" | "train")
      : undefined;

    // Parse theOneThing — may be an array or a single string from the AI
    const rawOne = scaffold["theOneThing"];
    const theOneThing: string[] | undefined = Array.isArray(rawOne)
      ? (rawOne as unknown[]).filter((x): x is string => typeof x === "string")
      : typeof rawOne === "string" && rawOne.trim()
        ? [rawOne.trim()]
        : undefined;

    const body: CreateTripBody = {
      title: String(scaffold["title"] ?? prompt.slice(0, 60)),
      destination: String(scaffold["destination"] ?? ""),
      status: "planning",
      startDate:
        ((scaffold["startDate"] as string | undefined) ?? startDate) ||
        undefined,
      endDate:
        ((scaffold["endDate"] as string | undefined) ?? endDate) || undefined,
      travellerCount,
      hasRentalCar: false,
      notes: scaffold["notes"] as string | undefined,
      transportTo,
      theOneThing,
    };

    createTrip.mutate(
      { data: body },
      {
        onSuccess: (newTrip) => {
          const itinerary = scaffold["itinerary"];
          const finish = () => {
            qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
            toast.success("Trip created from AI plan");
            onOpenChange(false);
            navigate(`/trips/${newTrip.id}`);
          };
          // Persist reminders from scaffold (fire-and-forget, non-blocking)
          const scaffoldReminders = scaffold["reminders"];
          if (Array.isArray(scaffoldReminders)) {
            for (const rem of scaffoldReminders as unknown[]) {
              if (rem === null || typeof rem !== "object") continue;
              const r = rem as Record<string, unknown>;
              const title =
                typeof r["title"] === "string" ? r["title"].trim() : "";
              if (!title) continue;
              const body: CreateReminderBody = {
                title,
                description:
                  typeof r["description"] === "string"
                    ? r["description"]
                    : null,
                dueDate:
                  typeof r["dueDate"] === "string" ? r["dueDate"] : undefined,
              };
              createReminder.mutate({ tripId: newTrip.id, body });
            }
          }

          // Persist itinerary scaffold if the AI generated day-by-day plan
          if (itinerary) {
            updateTrip.mutate(
              { id: newTrip.id, data: { itinerary } },
              { onSettled: finish },
            );
          } else {
            finish();
          }
        },
        onError: () => toast.error("Failed to create trip"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Plan a trip with AI
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {phase === "idle" || phase === "error" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="ai-prompt">Describe your trip idea</Label>
                <Textarea
                  id="ai-prompt"
                  placeholder="e.g. A week in southern Japan — temples, food, and nature. We love hiking and authentic local experiences."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[100px] resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-start">Start date (optional)</Label>
                  <Input
                    id="ai-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-end">End date (optional)</Label>
                  <Input
                    id="ai-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-travellers">Travellers</Label>
                <Input
                  id="ai-travellers"
                  type="number"
                  min={1}
                  max={20}
                  value={travellerCount}
                  onChange={(e) => setTravellerCount(Number(e.target.value))}
                  className="w-24"
                />
              </div>
              {phase === "error" && (
                <p className="text-sm text-destructive">
                  Something went wrong. Try again.
                </p>
              )}
            </>
          ) : phase === "streaming" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Planning your trip…
              </div>
              <div
                ref={scrollRef}
                className="bg-muted/40 rounded-lg p-3 text-sm text-foreground whitespace-pre-wrap max-h-72 overflow-y-auto font-mono leading-relaxed"
              >
                {streamText || (
                  <span className="text-muted-foreground">Thinking…</span>
                )}
              </div>
            </div>
          ) : (
            /* done */
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 font-medium">
                <Sparkles className="w-4 h-4" />
                Trip plan ready!
              </div>
              <div
                ref={scrollRef}
                className="bg-muted/40 rounded-lg p-3 text-sm text-foreground whitespace-pre-wrap max-h-72 overflow-y-auto font-mono leading-relaxed"
              >
                {streamText}
              </div>
              {scaffold && (
                <div className="bg-card border border-border/60 rounded-lg p-3 space-y-1 text-sm">
                  <p className="font-medium text-foreground">
                    {String(scaffold["title"] ?? "")}
                  </p>
                  {!!scaffold["destination"] && (
                    <p className="text-muted-foreground">
                      {String(scaffold["destination"])}
                    </p>
                  )}
                  {!!(scaffold["startDate"] ?? startDate) && (
                    <p className="text-muted-foreground text-xs">
                      {String(scaffold["startDate"] ?? startDate)}
                      {!!(scaffold["endDate"] ?? endDate)
                        ? ` → ${String(scaffold["endDate"] ?? endDate)}`
                        : ""}
                    </p>
                  )}
                </div>
              )}
              {!!scaffold?.["itinerary"] && (
                <div className="space-y-1.5">
                  <Label htmlFor="ai-apply-target">Apply to</Label>
                  <Select
                    value={String(applyTarget)}
                    onValueChange={(v) =>
                      setApplyTarget(v === "new" ? "new" : Number(v))
                    }
                  >
                    <SelectTrigger id="ai-apply-target">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Create a new trip</SelectItem>
                      {existingTrips.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.title} — {t.destination}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {(phase === "idle" || phase === "error") && (
            <Button onClick={() => void handlePlan()} disabled={!prompt.trim()}>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate plan
            </Button>
          )}
          {phase === "streaming" && (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          )}
          {phase === "done" && (
            <>
              <Button variant="outline" onClick={() => setPhase("idle")}>
                Regenerate
              </Button>
              {applyTarget === "new" ? (
                <Button onClick={handleCreate} disabled={createTrip.isPending}>
                  {createTrip.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  Create trip
                </Button>
              ) : (
                <Button
                  onClick={() => setMergeOpen(true)}
                  disabled={!scaffold?.["itinerary"]}
                >
                  <CalendarCheck className="w-4 h-4 mr-2" />
                  Review &amp; apply
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
      <ItineraryMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        targetTripId={typeof applyTarget === "number" ? applyTarget : null}
        targetTripTitle={
          typeof applyTarget === "number"
            ? (existingTrips.find((t) => t.id === applyTarget)?.title ?? "trip")
            : ""
        }
        newItinerary={parseItinerary(scaffold?.["itinerary"])}
        onApplied={() => {
          qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
          if (typeof applyTarget === "number") {
            qc.invalidateQueries({ queryKey: getGetTripQueryKey(applyTarget) });
          }
          setMergeOpen(false);
          onOpenChange(false);
          if (typeof applyTarget === "number") {
            navigate(`/trips/${applyTarget}`);
          }
        }}
      />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

const ALL_STATUSES: TripStatus[] = [
  "wishlist",
  "planning",
  "booked",
  "active",
  "completed",
];

const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist: "Wishlist",
  planning: "Planning",
  booked: "Booked",
  active: "Active",
  completed: "Completed",
};

const STATUS_COLORS: Record<TripStatus, string> = {
  wishlist: "bg-yellow-50 text-yellow-700 border-yellow-200",
  planning: "bg-orange-50 text-orange-700 border-orange-200",
  booked: "bg-green-50  text-green-700  border-green-200",
  active: "bg-orange-50 text-orange-700 border-orange-200",
  completed: "bg-red-50    text-red-700    border-red-200",
};

const READINESS_STATUSES: TripStatus[] = ["planning", "booked", "active"];

function tripReadinessScore(trip: {
  startDate?: string | null;
  accommodationName?: string | null;
  notes?: string | null;
  todoList?: unknown;
  itinerary?: unknown;
}): number {
  let score = 0;
  if (trip.startDate) score++;
  if (trip.accommodationName) score++;
  if (trip.notes && (trip.notes as string).trim().length > 0) score++;
  const todos = trip.todoList as Array<unknown> | null | undefined;
  if (Array.isArray(todos) && todos.length > 0) score++;
  const itin = trip.itinerary as { days?: Array<unknown> } | null | undefined;
  if (itin && Array.isArray(itin.days) && itin.days.length > 0) score++;
  return score;
}

function ReadinessPips({ score }: { score: number }) {
  return (
    <span
      className="flex items-center gap-0.5"
      title={`Trip readiness: ${score}/5`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full transition-colors ${
            i < score
              ? score >= 4
                ? "bg-emerald-500"
                : score >= 2
                  ? "bg-amber-400"
                  : "bg-red-400"
              : "bg-muted-foreground/20"
          }`}
        />
      ))}
    </span>
  );
}

function CreateTripDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const createTrip = useCreateTrip();
  const [form, setForm] = useState<Partial<CreateTripBody>>({
    status: "wishlist",
    travellerCount: 2,
    hasRentalCar: false,
  });

  const set = (k: keyof CreateTripBody, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  usePageAssistantContext(
    "trip-create-dialog",
    open
      ? `User has the "New Trip" dialog open, currently filling in: title="${form.title ?? ""}", destination="${form.destination ?? ""}", status=${form.status ?? "wishlist"}, travellers=${form.travellerCount ?? ""}.`
      : undefined,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.destination) return;
    createTrip.mutate(
      { data: form as CreateTripBody },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
          toast.success("Trip created");
          onOpenChange(false);
          setForm({
            status: "wishlist",
            travellerCount: 2,
            hasRentalCar: false,
          });
        },
        onError: () => toast.error("Failed to create trip"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">New Trip</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">Trip name</Label>
            <Input
              id="title"
              required
              placeholder="Summer in Italy"
              value={form.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="destination">Destination</Label>
            <Input
              id="destination"
              required
              placeholder="Rome, Italy"
              value={form.destination ?? ""}
              onChange={(e) => set("destination", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status ?? "wishlist"}
                onValueChange={(v) => set("status", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="travellerCount">Travellers</Label>
              <Input
                id="travellerCount"
                type="number"
                min={1}
                value={form.travellerCount ?? 2}
                onChange={(e) => set("travellerCount", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                value={form.startDate ?? ""}
                onChange={(e) => set("startDate", e.target.value || undefined)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End date</Label>
              <Input
                id="endDate"
                type="date"
                value={form.endDate ?? ""}
                onChange={(e) => set("endDate", e.target.value || undefined)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Transport to destination</Label>
            <Select
              value={form.transportTo ?? "none"}
              onValueChange={(v) =>
                set("transportTo", v === "none" ? undefined : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                <SelectItem value="flew">Flight</SelectItem>
                <SelectItem value="drove">Drove</SelectItem>
                <SelectItem value="train">Train</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createTrip.isPending}>
              {createTrip.isPending ? "Creating..." : "Create trip"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const FAMILY_MEMBERS = ["John", "Ashley", "Karis", "Angela"] as const;

export default function Trips() {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const initialStatus = (searchParams.get("status") ?? "all") as
    | TripStatus
    | "all";
  const initialYear = searchParams.get("year");
  const initialDestination = searchParams.get("destination");
  const { data: trips = [], isLoading } = useListTrips();
  const [filterStatus, setFilterStatus] = useState<TripStatus | "all">(
    initialStatus,
  );
  const [filterYear, setFilterYear] = useState<number | "all">(
    initialYear ? Number(initialYear) : "all",
  );
  const [filterPerson, setFilterPerson] = useState<string[]>([]);
  const [filterDestination, setFilterDestination] = useState<string | null>(
    initialDestination,
  );
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);

  const availableYears = Array.from(
    new Set(
      trips
        .filter((t) => t.startDate)
        .map((t) => new Date(t.startDate!).getFullYear()),
    ),
  ).sort((a, b) => b - a);

  const filtered = trips.filter((t) => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterYear !== "all") {
      if (!t.startDate) return false;
      if (new Date(t.startDate).getFullYear() !== filterYear) return false;
    }
    if (filterDestination && t.destination !== filterDestination) return false;
    if (filterPerson.length > 0) {
      const travelers = t.travelers as string[] | null;
      if (!filterPerson.every((p) => travelers?.includes(p))) return false;
    }
    return true;
  });

  const grouped = ALL_STATUSES.reduce<Record<TripStatus, typeof trips>>(
    (acc, s) => {
      const bucket = filtered.filter((t) => t.status === s);
      if (s === "completed") {
        bucket.sort((a, b) =>
          (b.startDate ?? "").localeCompare(a.startDate ?? ""),
        );
      }
      acc[s] = bucket;
      return acc;
    },
    { active: [], booked: [], planning: [], wishlist: [], completed: [] },
  );

  const hasActiveFilters =
    filterStatus !== "all" ||
    filterYear !== "all" ||
    filterPerson.length > 0 ||
    !!filterDestination;
  const clearFilters = () => {
    setFilterStatus("all");
    setFilterYear("all");
    setFilterPerson([]);
    setFilterDestination(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Trips</h1>
          <p className="text-muted-foreground mt-1">
            Your full travel pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <MagnetCheckDialog />
          <Button variant="outline" onClick={() => setPlanning(true)}>
            <Sparkles className="w-4 h-4 mr-2" />
            Plan with AI
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New trip
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="space-y-2">
        {/* Status pills */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              filterStatus === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            All ({trips.length})
          </button>
          {ALL_STATUSES.map((s) => {
            const count = trips.filter((t) => t.status === s).length;
            if (count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                  filterStatus === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {STATUS_LABELS[s]} ({count})
              </button>
            );
          })}
        </div>

        {/* Year + Person filters */}
        <div className="flex flex-wrap items-center gap-2">
          {availableYears.length > 0 && (
            <Select
              value={String(filterYear)}
              onValueChange={(v) =>
                setFilterYear(v === "all" ? "all" : Number(v))
              }
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex flex-wrap gap-1.5">
            {FAMILY_MEMBERS.map((name) => {
              const active = filterPerson.includes(name);
              return (
                <button
                  key={name}
                  onClick={() =>
                    setFilterPerson((prev) =>
                      active ? prev.filter((n) => n !== name) : [...prev, name],
                    )
                  }
                  className={`h-8 px-2.5 rounded-md text-xs font-medium border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {filterDestination && (
            <span className="h-8 flex items-center gap-1.5 px-2.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20">
              <MapPin className="w-3 h-3" />
              {filterDestination}
              <button
                onClick={() => setFilterDestination(null)}
                className="ml-0.5 hover:text-primary/70"
                aria-label="Clear destination filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-2 border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Plane className="w-10 h-10 text-muted-foreground/40" />
            <p className="font-medium text-foreground">No trips here yet</p>
            <p className="text-sm text-muted-foreground">
              {filterStatus === "all"
                ? "Create your first trip above."
                : `No ${STATUS_LABELS[filterStatus].toLowerCase()} trips.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {ALL_STATUSES.filter((s) => grouped[s].length > 0).map((status) => (
            <div key={status}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                {STATUS_LABELS[status]}
              </h2>
              <div className="flex flex-col gap-2">
                {grouped[status].map((trip) => (
                  <Link
                    key={trip.id}
                    href={`/trips/${trip.id}`}
                    className="block"
                  >
                    <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
                      <CardContent className="flex items-center gap-4 py-4 px-4">
                        {(status === "active" || status === "completed") &&
                          (trip.iconPhotoId != null ? (
                            <img
                              src={getTripPhotoImageUrl(
                                trip.id,
                                trip.iconPhotoId,
                              )}
                              alt=""
                              className="w-12 h-12 rounded-lg object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                              <Plane className="w-5 h-5 text-muted-foreground/40" />
                            </div>
                          ))}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {trip.title}
                          </p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {trip.destination}
                          </p>
                          {trip.startDate && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(trip.startDate).toLocaleDateString(
                                "en-GB",
                                {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                },
                              )}
                              {trip.endDate && (
                                <>
                                  {" "}
                                  —{" "}
                                  {new Date(trip.endDate).toLocaleDateString(
                                    "en-GB",
                                    {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric",
                                    },
                                  )}
                                </>
                              )}{" "}
                              &middot; {trip.travellerCount} traveller
                              {trip.travellerCount !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {READINESS_STATUSES.includes(
                            trip.status as TripStatus,
                          ) && (
                            <ReadinessPips score={tripReadinessScore(trip)} />
                          )}
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[trip.status]}`}
                          >
                            {STATUS_LABELS[trip.status]}
                          </span>
                          <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateTripDialog open={creating} onOpenChange={setCreating} />
      <AiPlannerDialog open={planning} onOpenChange={setPlanning} />
    </div>
  );
}
