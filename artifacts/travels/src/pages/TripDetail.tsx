import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetTrip,
  useUpdateTrip,
  useDeleteTrip,
  useGenerateItinerary,
  useDeleteTripDocument,
  useUpdateTripDocument,
  useRescanTripDocument,
  useGetHighlights,
  useListTripPhotos,
  useUploadTripPhoto,
  useDeleteTripPhoto,
  useSetTripIcon,
  useListReminders,
  useCreateReminder,
  useUpdateReminder,
  useDeleteReminder,
  useListTravelsAppUsers,
  useGetCalendarStatus,
  getTripDocumentDownloadUrl,
  getTripPhotoImageUrl,
  getListTripsQueryKey,
  getGetTripQueryKey,
  getGetTravelsStatsQueryKey,
  getListTripPhotosQueryKey,
  getListRemindersQueryKey,
  type UpdateTripBody,
  type TripStatus,
  type TransportTo,
  type TripDocument,
  type TripPhoto,
  type PhotoType,
  type Reminder,
  type TravelsAppUser,
} from "@workspace/api-client-react";
import { OneThingInput } from "@/components/OneThingInput";
import { MagnetCheckDialog } from "@/components/MagnetCheckDialog";
import { ReminderEditDialog } from "@/components/ReminderEditDialog";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Users,
  Car,
  Plane,
  Train,
  FileText,
  Upload,
  Trash2,
  Edit2,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  RefreshCw,
  CheckSquare,
  Square,
  Mail,
  Plus,
  ExternalLink,
  Camera,
  Bell,
  Image as ImageIcon,
  Lock,
  LockOpen,
  ScanSearch,
  Magnet,
  Star,
  CalendarCheck,
  CalendarPlus,
} from "lucide-react";
import { toast } from "sonner";
import { InlineField, InlineTextField, InlineTextareaField, InlineDateField } from "@/components/InlineField";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItineraryActivity = {
  time: string;
  name: string;
  description: string;
  proximity: string;
  tip: string;
  status?: "tentative" | "confirmed";
  sourceDocumentId?: number;
  sourceField?: string;
};

type ItineraryDay = {
  date: string;
  title: string;
  activities: ItineraryActivity[];
};

type Itinerary = { days: ItineraryDay[] };

type PackingItem = { item: string; packed: boolean };
type TodoItem = { item: string; done: boolean };

const ALL_STATUSES: TripStatus[] = ["wishlist", "planning", "booked", "active", "completed"];
const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist: "Wishlist",
  planning: "Planning",
  booked: "Booked",
  active: "Active",
  completed: "Completed",
};
const STATUS_COLORS: Record<TripStatus, string> = {
  wishlist:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  planning:  "bg-orange-50 text-orange-700 border-orange-200",
  booked:    "bg-green-50  text-green-700  border-green-200",
  active:    "bg-orange-50 text-orange-700 border-orange-200",
  completed: "bg-red-50    text-red-700    border-red-200",
};

const INTERESTS_OPTIONS = [
  "food", "history", "nature", "art", "adventure",
  "shopping", "culture", "beaches", "nightlife", "architecture",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  // Append noon to avoid UTC-to-local-timezone shift flipping the date by one day
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Formats a raw extracted date/date-time string (e.g. "2026-08-14T10:30:00")
// into a readable form (e.g. "14 August 2026, 10:30 am") instead of the raw
// ISO string with the date and time smashed together.
function formatExtractedValue(raw: string): string {
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?/);
  if (!isoMatch) return raw;
  const [, datePart, timePart] = isoMatch;
  const parsed = new Date(`${datePart}T${timePart ?? "12:00"}:00`);
  if (isNaN(parsed.getTime())) return raw;
  const dateStr = parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  if (!timePart) return dateStr;
  const timeStr = parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateStr}, ${timeStr}`;
}

// Itinerary activity tips can contain raw embedded ISO date/time strings
// (e.g. "Arrives 2026-08-14T14:20:00 — some note") copied straight from
// document extraction. Reformat any such substrings the same way Documents
// displays them (e.g. "Arrives 14 August 2026, 2:20 pm — some note").
function formatTipText(tip: string): string {
  return tip.replace(
    /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g,
    (match) => formatExtractedValue(match),
  );
}

// Formats a bare "HH:MM" (24-hour) time string into the same 12-hour style
// used for documents' extracted date/time values (e.g. "10:30" -> "10:30 AM").
function formatTimeOfDay(time: string): string {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time;
  const parsed = new Date(`2000-01-01T${match[1]!.padStart(2, "0")}:${match[2]}:00`);
  if (isNaN(parsed.getTime())) return time;
  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildCalendarUrl(
  title: string,
  destination: string,
  startDate: string,
  endDate: string,
  notes?: string | null,
) {
  const fmt = (d: string) => d.replace(/-/g, "");
  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${fmt(startDate)}/${fmt(endDate || startDate)}` +
    `&location=${encodeURIComponent(destination)}` +
    (notes ? `&details=${encodeURIComponent(notes)}` : "")
  );
}

function buildReminderCalendarUrl(title: string, dueDate: string, details?: string) {
  const fmt = (d: string) => d.replace(/-/g, "");
  const next = new Date(`${dueDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10);
  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${fmt(dueDate)}/${fmt(end)}` +
    (details ? `&details=${encodeURIComponent(details)}` : "")
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TransportIcon({ transport }: { transport?: TransportTo | null }) {
  if (transport === "flew") return <Plane className="w-4 h-4" />;
  if (transport === "train") return <Train className="w-4 h-4" />;
  return <Car className="w-4 h-4" />;
}

function DocumentRow({
  doc,
  tripId,
  onDelete,
}: {
  doc: TripDocument;
  tripId: number;
  onDelete: (docId: number) => void;
}) {
  const qc = useQueryClient();
  const updateTripDocument = useUpdateTripDocument();
  const rescanTripDocument = useRescanTripDocument();
  const ext = doc.originalFilename?.split(".").pop()?.toLowerCase();
  const ed = doc.extractedData as Record<string, unknown> | null;
  const lockedFields = doc.lockedFields ?? [];

  const toggleFieldLock = (key: string) => {
    const isLocked = lockedFields.includes(key);
    const next = isLocked
      ? lockedFields.filter((f) => f !== key)
      : [...lockedFields, key];
    updateTripDocument.mutate(
      { tripId, docId: doc.id, body: { lockedFields: next } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
        },
        onError: () => toast.error("Failed to update lock"),
      },
    );
  };

  const handleRescan = () => {
    rescanTripDocument.mutate(
      { tripId, docId: doc.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
          toast.success("Document re-scanned");
        },
        onError: () => toast.error("Failed to re-scan document"),
      },
    );
  };

  const keyFields: Array<{ key: string; label: string }> = [
    { key: "referenceNumber", label: "Ref" },
    { key: "confirmationNumber", label: "Confirmation" },
    { key: "departureDateTime", label: "Departure" },
    { key: "checkInDate", label: "Check-in" },
    { key: "checkOutDate", label: "Check-out" },
    { key: "flightNumber", label: "Flight" },
    { key: "airline", label: "Airline" },
    { key: "hotelName", label: "Hotel" },
    { key: "returnDepartureDateTime", label: "Return" },
    { key: "returnFlightNumber", label: "Return flight" },
  ];

  const saveExtractedField = (key: string, rawValue: string) => {
    const value = rawValue.trim();
    const extractedData: Record<string, unknown> = { ...(ed ?? {}), [key]: value ? value : null };
    updateTripDocument.mutate(
      { tripId, docId: doc.id, body: { extractedData } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
          toast.success("Document details updated");
        },
        onError: () => toast.error("Failed to update document details"),
      },
    );
  };

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0 text-muted-foreground text-xs font-mono uppercase">
        {ext ?? "doc"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {doc.originalFilename ?? "Document"}
        </p>
        {doc.documentType && (
          <p className="text-xs text-muted-foreground capitalize">{doc.documentType}</p>
        )}
        <div className="mt-1.5 space-y-1">
          {keyFields.map(({ key, label }) => {
            const isLocked = lockedFields.includes(key);
            const isDateField = key.toLowerCase().includes("date");
            const rawValue = ed?.[key] != null ? String(ed[key]) : "";
            return (
              <div key={key} className="flex items-start gap-1">
                <div className="flex-1 min-w-0">
                  <InlineTextField
                    label={label}
                    value={rawValue}
                    onSave={(v) => saveExtractedField(key, v)}
                    saving={updateTripDocument.isPending}
                    placeholder={isDateField ? "e.g. 2026-08-14T10:30:00" : undefined}
                    displayValue={(v) => formatExtractedValue(v)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => toggleFieldLock(key)}
                  className={`p-1 shrink-0 transition-colors mt-4 ${
                    isLocked
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-muted-foreground/50 hover:text-foreground"
                  }`}
                  title={isLocked ? "Locked — AI rescan won't overwrite" : "Unlocked — AI rescan may update"}
                >
                  {isLocked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleRescan}
          disabled={rescanTripDocument.isPending}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Re-scan document with AI (locked fields are preserved)"
        >
          <ScanSearch className={`w-4 h-4 ${rescanTripDocument.isPending ? "animate-pulse" : ""}`} />
        </button>
        <a
          href={getTripDocumentDownloadUrl(tripId, doc.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <button
          onClick={() => onDelete(doc.id)}
          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function DayCard({
  day,
  index,
  dayNumber,
  onRefresh,
  refreshing,
  onAddActivity,
  onDeleteActivity,
  onDeleteDay,
  onConfirmActivity,
}: {
  day: ItineraryDay;
  index: number;
  dayNumber: number;
  onRefresh: (dayIndex: number) => void;
  refreshing: boolean;
  onAddActivity?: (activity: ItineraryActivity) => void;
  onDeleteActivity?: (activityIndex: number) => void;
  onDeleteDay?: () => void;
  onConfirmActivity?: (activityIndex: number) => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const [addingActivity, setAddingActivity] = useState(false);
  const [actForm, setActForm] = useState({ time: "", name: "", description: "", proximity: "", tip: "" });

  const submitActivity = () => {
    if (!actForm.name.trim()) return;
    onAddActivity?.({ ...actForm, name: actForm.name.trim(), description: actForm.description.trim(), tip: actForm.tip.trim(), proximity: actForm.proximity.trim() });
    setActForm({ time: "", name: "", description: "", proximity: "", tip: "" });
    setAddingActivity(false);
  };

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); }
        }}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/50 transition-colors text-left cursor-pointer"
      >
        <div>
          <p className="font-medium text-foreground">
            Day {dayNumber} — {day.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(day.date)} · {day.activities.length} {day.activities.length === 1 ? "activity" : "activities"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {onDeleteDay && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteDay(); }}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete this day"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRefresh(index); }}
            disabled={refreshing}
            className="p-1 text-muted-foreground hover:text-primary transition-colors"
            title="Regenerate this day with AI"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          {open ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {open && (
        <div className="bg-card/50">
          <div className="divide-y divide-border/50">
            {day.activities.map((a, ai) => (
              <div key={ai} className="px-4 py-3 space-y-1 group relative">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{a.name}</p>
                      {a.status === "tentative" && (
                        <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
                          Tentative
                        </span>
                      )}
                    </div>
                    {a.time && <p className="text-xs text-muted-foreground">{formatTimeOfDay(a.time)}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.proximity && <span className="text-sm">{a.proximity}</span>}
                    {a.status === "tentative" && onConfirmActivity && (
                      <button
                        onClick={() => onConfirmActivity(ai)}
                        className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
                        title="Mark this as firm/confirmed"
                      >
                        Mark as firm
                      </button>
                    )}
                    {onDeleteActivity && (
                      <button
                        onClick={() => onDeleteActivity(ai)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                        title="Remove activity"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
                {a.tip && (
                  <p className="text-xs italic text-muted-foreground border-l-2 border-primary/30 pl-2">{formatTipText(a.tip)}</p>
                )}
              </div>
            ))}
          </div>

          {/* Add activity form */}
          {onAddActivity && (
            <div className="px-4 py-3 border-t border-border/50">
              {addingActivity ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Activity name *"
                      value={actForm.name}
                      onChange={(e) => setActForm((f) => ({ ...f, name: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && submitActivity()}
                    />
                    <Input
                      placeholder="Time (e.g. 9:00 AM)"
                      value={actForm.time}
                      onChange={(e) => setActForm((f) => ({ ...f, time: e.target.value }))}
                    />
                  </div>
                  <Input
                    placeholder="Description"
                    value={actForm.description}
                    onChange={(e) => setActForm((f) => ({ ...f, description: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Tip (optional)"
                      value={actForm.tip}
                      onChange={(e) => setActForm((f) => ({ ...f, tip: e.target.value }))}
                    />
                    <Input
                      placeholder="Proximity (optional)"
                      value={actForm.proximity}
                      onChange={(e) => setActForm((f) => ({ ...f, proximity: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={submitActivity} disabled={!actForm.name.trim()}>
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingActivity(false); setActForm({ time: "", name: "", description: "", proximity: "", tip: "" }); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingActivity(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add activity
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PackingList({
  items,
  tripId,
  onSave,
}: {
  items: PackingItem[];
  tripId: number;
  onSave: (items: PackingItem[]) => void;
}) {
  const [list, setList] = useState<PackingItem[]>(items);
  const [newItem, setNewItem] = useState("");
  const [dirty, setDirty] = useState(false);

  const toggle = (i: number) => {
    setList((l) => l.map((it, idx) => (idx === i ? { ...it, packed: !it.packed } : it)));
    setDirty(true);
  };
  const add = () => {
    if (!newItem.trim()) return;
    setList((l) => [...l, { item: newItem.trim(), packed: false }]);
    setNewItem("");
    setDirty(true);
  };
  const remove = (i: number) => {
    setList((l) => l.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Add item..."
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          className="flex-1"
        />
        <Button variant="outline" size="icon" onClick={add}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nothing on the packing list yet.
        </p>
      ) : (
        <div className="space-y-1">
          {list.map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors group"
            >
              <button onClick={() => toggle(i)} className="shrink-0">
                {it.packed ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              <span
                className={`flex-1 text-sm ${it.packed ? "line-through text-muted-foreground" : "text-foreground"}`}
              >
                {it.item}
              </span>
              <button
                onClick={() => remove(i)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {dirty && (
        <Button
          size="sm"
          onClick={() => {
            onSave(list);
            setDirty(false);
          }}
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save packing list
        </Button>
      )}
    </div>
  );
}

// ─── Todo List ────────────────────────────────────────────────────────────────

function TodoList({
  items,
  onSave,
}: {
  items: TodoItem[];
  onSave: (items: TodoItem[]) => void;
}) {
  const [list, setList] = useState<TodoItem[]>(items);
  const [newItem, setNewItem] = useState("");
  const [dirty, setDirty] = useState(false);

  const toggle = (i: number) => {
    setList((l) => l.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
    setDirty(true);
  };
  const add = () => {
    if (!newItem.trim()) return;
    setList((l) => [...l, { item: newItem.trim(), done: false }]);
    setNewItem("");
    setDirty(true);
  };
  const remove = (i: number) => {
    setList((l) => l.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Add task..."
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          className="flex-1"
        />
        <Button variant="outline" size="icon" onClick={add}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nothing on the to-do list yet.
        </p>
      ) : (
        <div className="space-y-1">
          {list.map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors group"
            >
              <button onClick={() => toggle(i)} className="shrink-0">
                {it.done ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              <span
                className={`flex-1 text-sm ${it.done ? "line-through text-muted-foreground" : "text-foreground"}`}
              >
                {it.item}
              </span>
              <button
                onClick={() => remove(i)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {dirty && (
        <Button
          size="sm"
          onClick={() => {
            onSave(list);
            setDirty(false);
          }}
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save to-do list
        </Button>
      )}
    </div>
  );
}

// ─── Photos / Magnets Section ─────────────────────────────────────────────────

function PhotoGridSection({
  tripId,
  photoType,
  title,
  icon,
  emptyText,
  addLabel,
  iconPhotoId,
  onSetIcon,
  settingIcon,
}: {
  tripId: number;
  photoType: PhotoType;
  title: string;
  icon: React.ReactNode;
  emptyText: string;
  addLabel: string;
  iconPhotoId?: number | null;
  onSetIcon?: (photoId: number) => void;
  settingIcon?: boolean;
}) {
  const qc = useQueryClient();
  const { data: photos = [], isLoading } = useListTripPhotos(tripId, photoType);
  const uploadPhoto = useUploadTripPhoto({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTripPhotosQueryKey(tripId, photoType) });
        toast.success(`${photoType === "magnet" ? "Magnet" : "Photo"} uploaded`);
      },
      onError: () => toast.error("Upload failed"),
    },
  });
  const deletePhoto = useDeleteTripPhoto({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTripPhotosQueryKey(tripId, photoType) });
        qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
        toast.success("Deleted");
      },
      onError: () => toast.error("Failed to delete"),
    },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<TripPhoto | null>(null);
  const [bulkUploading, setBulkUploading] = useState<{ done: number; total: number } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    if (files.length === 1) {
      const formData = new FormData();
      formData.append("photo", files[0]);
      formData.append("type", photoType);
      uploadPhoto.mutate({ tripId, formData });
      return;
    }

    setBulkUploading({ done: 0, total: files.length });
    let failures = 0;
    for (const file of files) {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("type", photoType);
      try {
        await uploadPhoto.mutateAsync({ tripId, formData });
      } catch {
        failures++;
      }
      setBulkUploading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }
    setBulkUploading(null);
    if (failures > 0) {
      toast.error(`${failures} of ${files.length} uploads failed`);
    } else {
      toast.success(`${files.length} ${photoType === "magnet" ? "magnets" : "photos"} uploaded`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
          {icon}
          {title}
          {photos.length > 0 && (
            <span className="text-sm font-sans font-normal text-muted-foreground">({photos.length})</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {photoType === "magnet" && <MagnetCheckDialog />}
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploadPhoto.isPending || bulkUploading !== null}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {bulkUploading
              ? `Uploading ${bulkUploading.done}/${bulkUploading.total}...`
              : uploadPhoto.isPending
                ? "Uploading..."
                : addLabel}
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="aspect-square rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <Card className="border-dashed border-2 border-border/60">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {photos.map((photo) => {
            const isIcon = onSetIcon && iconPhotoId === photo.id;
            return (
              <div key={photo.id} className="relative group aspect-square">
                <img
                  src={getTripPhotoImageUrl(tripId, photo.id)}
                  alt={photo.caption ?? title}
                  className={`w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity ${isIcon ? "ring-2 ring-primary ring-offset-2" : ""}`}
                  onClick={() => setLightbox(photo)}
                />
                <button
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); deletePhoto.mutate({ tripId, photoId: photo.id }); }}
                >
                  <X className="w-3 h-3" />
                </button>
                {onSetIcon && (
                  <button
                    className={`absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center transition-opacity ${
                      isIcon
                        ? "bg-primary text-primary-foreground opacity-100"
                        : "bg-black/60 text-white opacity-0 group-hover:opacity-100"
                    }`}
                    disabled={settingIcon}
                    title={isIcon ? "Current cover photo" : "Set as cover photo"}
                    onClick={(e) => { e.stopPropagation(); onSetIcon(photo.id); }}
                  >
                    <Star className={`w-3 h-3 ${isIcon ? "fill-current" : ""}`} />
                  </button>
                )}
                {photo.caption && (
                  <p className="absolute bottom-0 left-0 right-0 text-[10px] text-white bg-black/50 px-1 py-0.5 rounded-b-lg truncate">
                    {photo.caption}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(open) => { if (!open) setLightbox(null); }}>
        <DialogContent className="max-w-3xl">
          {lightbox && (
            <>
              <img
                src={getTripPhotoImageUrl(tripId, lightbox.id)}
                alt={lightbox.caption ?? title}
                className="w-full rounded-lg max-h-[70vh] object-contain"
              />
              {lightbox.caption && (
                <p className="text-sm text-muted-foreground text-center">{lightbox.caption}</p>
              )}
              {onSetIcon && (
                <Button
                  size="sm"
                  variant={iconPhotoId === lightbox.id ? "secondary" : "outline"}
                  disabled={settingIcon || iconPhotoId === lightbox.id}
                  onClick={() => onSetIcon(lightbox.id)}
                >
                  <Star className={`w-3.5 h-3.5 mr-1.5 ${iconPhotoId === lightbox.id ? "fill-current" : ""}`} />
                  {iconPhotoId === lightbox.id ? "Current cover photo" : "Set as cover photo"}
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reminders Section ────────────────────────────────────────────────────────

function RemindersSection({ tripId }: { tripId: number }) {
  const qc = useQueryClient();
  const { data: reminders = [], isLoading } = useListReminders(tripId);
  const { data: appUsers = [] } = useListTravelsAppUsers();
  const createReminder = useCreateReminder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRemindersQueryKey(tripId) });
        setNewTitle("");
        setNewDue("");
        setNewRecipients([]);
        setCustomEmail("");
        setAdding(false);
        toast.success("Reminder added");
      },
      onError: () => toast.error("Failed to add reminder"),
    },
  });
  const updateReminder = useUpdateReminder({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListRemindersQueryKey(tripId) }),
      onError: () => toast.error("Failed to update"),
    },
  });
  const deleteReminder = useDeleteReminder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRemindersQueryKey(tripId) });
        toast.success("Reminder deleted");
      },
      onError: () => toast.error("Failed to delete"),
    },
  });

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newRecipients, setNewRecipients] = useState<string[]>([]);
  const [customEmail, setCustomEmail] = useState("");
  const [newSync, setNewSync] = useState(true);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const { data: calendarStatus } = useGetCalendarStatus();
  const familyCalendarConnected = !!calendarStatus?.connected && !!calendarStatus?.calendarId;

  function toggleRecipient(email: string) {
    setNewRecipients((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  }

  function addCustomEmail() {
    const email = customEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (!newRecipients.includes(email)) setNewRecipients((prev) => [...prev, email]);
    setCustomEmail("");
  }

  const pending = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Reminders
          {pending.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold">
              {pending.length}
            </span>
          )}
        </h2>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add
        </Button>
      </div>

      {adding && (
        <Card className="border-border/50">
          <CardContent className="py-3 space-y-2">
            <Input
              placeholder="Reminder title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
            <Input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              placeholder="Due date (optional)"
            />

            <div className="space-y-1.5 pt-1">
              <Label className="text-xs text-muted-foreground">Send alerts to</Label>
              {appUsers.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {appUsers.map((u: TravelsAppUser) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={newRecipients.includes(u.email)}
                        onCheckedChange={() => toggleRecipient(u.email)}
                      />
                      {u.displayName ? (
                        <span>
                          {u.displayName}{" "}
                          <span className="text-muted-foreground">({u.email})</span>
                        </span>
                      ) : (
                        u.email
                      )}
                    </label>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Input
                  type="email"
                  placeholder="Add another email address"
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addCustomEmail(); }
                  }}
                  className="flex-1"
                />
                <Button size="sm" variant="outline" type="button" onClick={addCustomEmail}>
                  Add
                </Button>
              </div>

              {newRecipients.filter((e) => !appUsers.some((u: TravelsAppUser) => u.email === e)).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {newRecipients
                    .filter((e) => !appUsers.some((u: TravelsAppUser) => u.email === e))
                    .map((email) => (
                      <Badge key={email} variant="secondary" className="gap-1">
                        {email}
                        <button type="button" onClick={() => toggleRecipient(email)} aria-label={`Remove ${email}`}>
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                </div>
              )}
            </div>

            {familyCalendarConnected && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer pt-1">
                <Checkbox checked={newSync} onCheckedChange={(v) => setNewSync(!!v)} />
                Add to the family Google Calendar
              </label>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => {
                  if (!newTitle.trim()) return;
                  createReminder.mutate({
                    tripId,
                    body: {
                      title: newTitle.trim(),
                      dueDate: newDue || undefined,
                      recipientEmails: newRecipients,
                      syncToCalendar: newSync,
                    },
                  });
                }}
                disabled={!newTitle.trim() || createReminder.isPending}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : reminders.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No reminders yet.</p>
      ) : (
        <div className="space-y-1.5">
          {pending.map((r: Reminder) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              tripId={tripId}
              onToggle={() => updateReminder.mutate({ tripId, reminderId: r.id, body: { done: true } })}
              onEdit={() => setEditingReminder(r)}
              onDelete={() => deleteReminder.mutate({ tripId, reminderId: r.id })}
            />
          ))}
          {done.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                {done.length} completed
              </summary>
              <div className="space-y-1 mt-1.5">
                {done.map((r: Reminder) => (
                  <ReminderRow
                    key={r.id}
                    reminder={r}
                    tripId={tripId}
                    onToggle={() => updateReminder.mutate({ tripId, reminderId: r.id, body: { done: false } })}
                    onEdit={() => setEditingReminder(r)}
                    onDelete={() => deleteReminder.mutate({ tripId, reminderId: r.id })}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <ReminderEditDialog
        reminder={editingReminder}
        open={!!editingReminder}
        onOpenChange={(open) => { if (!open) setEditingReminder(null); }}
      />
    </div>
  );
}

function ReminderRow({
  reminder,
  tripId,
  onToggle,
  onEdit,
  onDelete,
}: {
  reminder: Reminder;
  tripId: number;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const overdue = !reminder.done && reminder.dueDate && new Date(reminder.dueDate) < new Date();
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${reminder.done ? "bg-muted/30 border-border/30" : "bg-card border-border/50"}`}>
      <button onClick={onToggle} className="shrink-0" title={reminder.done ? "Mark as not done" : "Mark as done"}>
        {reminder.done ? (
          <CheckSquare className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Square className="w-4 h-4 text-muted-foreground hover:text-foreground" />
        )}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className={`flex-1 text-sm text-left hover:underline ${reminder.done ? "line-through text-muted-foreground" : overdue ? "text-red-700 font-medium" : "text-foreground"}`}
      >
        {reminder.title}
      </button>
      {reminder.syncToCalendar && reminder.googleEventId && (
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
          title="Synced to the family Google Calendar"
        >
          <CalendarCheck className="w-3 h-3" />
        </span>
      )}
      {reminder.recipientEmails.length > 0 && (
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
          title={`Alerts sent to: ${reminder.recipientEmails.join(", ")}`}
        >
          <Mail className="w-3 h-3" />
          {reminder.recipientEmails.length}
        </span>
      )}
      {reminder.dueDate && (
        <span className={`text-xs shrink-0 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
          {overdue ? "Overdue · " : ""}
          {new Date(reminder.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      )}
      {reminder.dueDate && (
        <a
          href={buildReminderCalendarUrl(reminder.title, reminder.dueDate, "Trip reminder")}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground/70 hover:text-foreground"
          title="Add to my own Google Calendar"
        >
          <CalendarPlus className="w-3.5 h-3.5" />
        </a>
      )}
      <button
        onClick={onEdit}
        className="shrink-0 text-muted-foreground/70 hover:text-foreground"
        title="Edit reminder"
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="shrink-0 text-muted-foreground/70 hover:text-destructive"
        title="Delete reminder"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TripDetail({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: trip, isLoading } = useGetTrip(id);
  const updateTrip = useUpdateTrip();
  const setTripIcon = useSetTripIcon();
  const deleteTrip = useDeleteTrip();
  const generateItinerary = useGenerateItinerary();
  const deleteTripDocument = useDeleteTripDocument();
  const { data: allHighlights = [] } = useGetHighlights();

  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itinStyle, setItinStyle] = useState<"relaxed" | "balanced" | "packed">("balanced");
  const [itinInterests, setItinInterests] = useState<string[]>(["food", "history", "culture"]);
  const [refreshingDay, setRefreshingDay] = useState<number | null>(null);
  const [localItinerary, setLocalItinerary] = useState<Itinerary | null>(null);
  const [itineraryDirty, setItineraryDirty] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const [dayForm, setDayForm] = useState({ date: "", title: "" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
  };

  const saveField = (body: Partial<UpdateTripBody>, successMsg = "Trip updated") => {
    updateTrip.mutate(
      { id, body },
      {
        onSuccess: () => {
          invalidate();
          toast.success(successMsg);
        },
        onError: () => toast.error("Failed to update trip"),
      },
    );
  };

  const handleDelete = () => {
    deleteTrip.mutate(id, {
      onSuccess: () => {
        invalidate();
        toast.success("Trip deleted");
        setLocation("/trips");
      },
      onError: () => toast.error("Failed to delete trip"),
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/travels/trips/${id}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      invalidate();
      toast.success("Document uploaded");
    } catch {
      toast.error("Failed to upload document");
    } finally {
      setUploadingDoc(false);
      e.target.value = "";
    }
  };

  const handleDeleteDocument = (docId: number) => {
    deleteTripDocument.mutate(
      { tripId: id, docId },
      {
        onSuccess: () => {
          invalidate();
          toast.success("Document removed");
        },
        onError: () => toast.error("Failed to remove document"),
      },
    );
  };

  const handleGenerateItinerary = () => {
    generateItinerary.mutate(
      { id, body: { style: itinStyle, interests: itinInterests } },
      {
        onSuccess: () => {
          invalidate();
          toast.success("Itinerary generated");
        },
        onError: () => toast.error("Failed to generate itinerary"),
      },
    );
  };

  const handleRefreshDay = (dayIndex: number) => {
    setRefreshingDay(dayIndex);
    generateItinerary.mutate(
      { id, body: { style: itinStyle, interests: itinInterests, regenerateDay: dayIndex } },
      {
        onSuccess: () => {
          invalidate();
          toast.success(`Day ${dayIndex + 1} refreshed`);
        },
        onError: () => toast.error("Failed to refresh day"),
        onSettled: () => setRefreshingDay(null),
      },
    );
  };

  const handleSavePackingList = (items: PackingItem[]) => {
    updateTrip.mutate(
      { id, body: { packingList: items } },
      {
        onSuccess: () => {
          invalidate();
          toast.success("Packing list saved");
        },
        onError: () => toast.error("Failed to save packing list"),
      },
    );
  };

  const handleSaveTodoList = (items: TodoItem[]) => {
    updateTrip.mutate(
      { id, body: { todoList: items } },
      {
        onSuccess: () => {
          invalidate();
          toast.success("To-do list saved");
        },
        onError: () => toast.error("Failed to save to-do list"),
      },
    );
  };

  // Keep localItinerary in sync when trip data first loads (or after AI generation)
  useEffect(() => {
    if (trip) {
      const loaded = trip.itinerary as Itinerary | null;
      setLocalItinerary(loaded ?? null);
      setItineraryDirty(false);
    }
  }, [trip?.itinerary]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveItinerary = () => {
    updateTrip.mutate(
      { id, body: { itinerary: localItinerary } },
      {
        onSuccess: () => { invalidate(); toast.success("Itinerary saved"); setItineraryDirty(false); },
        onError: () => toast.error("Failed to save itinerary"),
      },
    );
  };

  const handleAddDay = () => {
    if (!dayForm.title.trim()) return;
    const newDay: ItineraryDay = { date: dayForm.date, title: dayForm.title.trim(), activities: [] };
    setLocalItinerary((prev) => ({ days: [...(prev?.days ?? []), newDay] }));
    setDayForm({ date: "", title: "" });
    setAddingDay(false);
    setItineraryDirty(true);
  };

  const handleDeleteDay = (dayIndex: number) => {
    setLocalItinerary((prev) => prev ? { days: prev.days.filter((_, i) => i !== dayIndex) } : prev);
    setItineraryDirty(true);
  };

  const handleAddActivity = (dayIndex: number, activity: ItineraryActivity) => {
    setLocalItinerary((prev) => {
      if (!prev) return prev;
      const days = prev.days.map((d, i) =>
        i === dayIndex ? { ...d, activities: [...d.activities, activity] } : d,
      );
      return { days };
    });
    setItineraryDirty(true);
  };

  const handleDeleteActivity = (dayIndex: number, activityIndex: number) => {
    setLocalItinerary((prev) => {
      if (!prev) return prev;
      const days = prev.days.map((d, i) =>
        i === dayIndex ? { ...d, activities: d.activities.filter((_, ai) => ai !== activityIndex) } : d,
      );
      return { days };
    });
    setItineraryDirty(true);
  };

  const handleConfirmActivity = (dayIndex: number, activityIndex: number) => {
    const base = localItinerary ?? (trip?.itinerary as Itinerary | null);
    if (!base) return;
    const days = base.days.map((d, i) =>
      i === dayIndex
        ? {
            ...d,
            activities: d.activities.map((a, ai) =>
              ai === activityIndex ? { ...a, status: "confirmed" as const } : a,
            ),
          }
        : d,
    );
    const updated: Itinerary = { days };
    setLocalItinerary(updated);
    updateTrip.mutate(
      { id, body: { itinerary: updated } },
      {
        onSuccess: () => { invalidate(); toast.success("Marked as firm"); },
        onError: () => toast.error("Failed to update activity"),
      },
    );
  };

  const toggleInterest = (interest: string) => {
    setItinInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest],
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 rounded bg-muted animate-pulse" />
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
        <div className="h-48 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Trip not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => setLocation("/trips")}>
          Back to trips
        </Button>
      </div>
    );
  }

  const packingList = (trip.packingList ?? []) as PackingItem[];
  const todoList = (trip.todoList ?? []) as TodoItem[];
  const documents = trip.documents ?? [];

  usePageAssistantContext(
    "trip-detail",
    `Viewing trip "${trip.title}" to ${trip.destination} (tripId: ${trip.id}, status: ${trip.status}${
      trip.startDate ? `, starts ${trip.startDate}` : ""
    }${trip.endDate ? `, ends ${trip.endDate}` : ""}). ` +
      `Packing list has ${packingList.length} item(s), ${packingList.filter((p) => p.packed).length} packed. ` +
      `To-do list has ${todoList.length} item(s). ${documents.length} document(s) attached.` +
      (addingDay ? ` User is currently adding a new itinerary day with title "${dayForm.title}" on ${dayForm.date}.` : ""),
  );
  const canCalendar =
    (trip.status === "booked" || trip.status === "active") &&
    trip.startDate;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 mt-0.5"
          onClick={() => setLocation("/trips")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            {trip.iconPhotoId != null && (
              <img
                src={getTripPhotoImageUrl(trip.id, trip.iconPhotoId)}
                alt=""
                className="w-8 h-8 rounded-full object-cover border border-border shrink-0"
              />
            )}
            <InlineField
              label="Trip name"
              value={trip.title}
              iconType="text"
              onSave={(v) => {
                if (v.trim()) saveField({ title: v.trim() });
              }}
              className="min-w-[10rem]"
              renderDisplay={(v) => <h1 className="font-serif text-2xl text-foreground">{v}</h1>}
              renderEditor={(draft, setDraft, commit, cancel) => (
                <Input
                  autoFocus
                  className="font-serif text-xl h-10"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") cancel();
                  }}
                />
              )}
            />
            <InlineField
              label="Status"
              value={trip.status}
              iconType="custom"
              onSave={(v) => saveField({ status: v })}
              renderDisplay={(v) => (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${STATUS_COLORS[v]}`}
                >
                  {STATUS_LABELS[v]}
                </span>
              )}
              renderEditor={(draft, setDraft) => (
                <Select value={draft} onValueChange={(v) => setDraft(v as TripStatus)}>
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <InlineField
            label="Destination"
            value={trip.destination}
            iconType="text"
            onSave={(v) => {
              if (v.trim()) saveField({ destination: v.trim() });
            }}
            layout="row"
            renderDisplay={(v) => (
              <p className="text-muted-foreground flex items-center gap-1">
                <MapPin className="w-4 h-4 shrink-0" />
                {v}
              </p>
            )}
            renderEditor={(draft, setDraft, commit, cancel) => (
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") cancel();
                }}
              />
            )}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            title="Delete trip"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Trip info — every field is independently editable via its contextual icon */}
      <Card className="border-border/50">
        <CardContent className="py-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <InlineDateField
            label="Start date"
            value={trip.startDate ?? ""}
            onSave={(v) => saveField({ startDate: v || undefined })}
            displayValue={(v) => formatDate(v)}
          />
          <InlineDateField
            label="End date"
            value={trip.endDate ?? ""}
            onSave={(v) => saveField({ endDate: v || undefined })}
            displayValue={(v) => formatDate(v)}
          />

          <InlineField
            label="Travellers"
            value={(trip.travelers as string[] | null) ?? []}
            iconType="custom"
            onSave={(v) => saveField({ travelers: v })}
            isEmpty={() => false}
            renderDisplay={(v) => (
              <p className="text-sm text-foreground">
                {v.length ? v.join(", ") : trip.travellerCount}
              </p>
            )}
            renderEditor={(draft, setDraft) => (
              <div className="flex flex-wrap gap-3">
                {(["John", "Ashley", "Karis", "Angela"] as const).map((name) => {
                  const checked = draft.includes(name);
                  return (
                    <label key={name} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        className="w-4 h-4 rounded border-border accent-primary"
                        onChange={(e) =>
                          setDraft(
                            e.target.checked ? [...draft, name] : draft.filter((n) => n !== name),
                          )
                        }
                      />
                      <span className="text-sm">{name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          />

          <InlineField
            label="Getting there"
            value={trip.transportTo ?? "none"}
            iconType="custom"
            onSave={(v: TransportTo | "none") =>
              saveField({ transportTo: v === "none" ? undefined : (v as TransportTo) })
            }
            isEmpty={(v: TransportTo | "none") => v === "none"}
            renderDisplay={(v) => (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground shrink-0">
                  <TransportIcon transport={v as TransportTo} />
                </span>
                <p className="text-sm text-foreground capitalize">
                  {v === "flew" ? "Flying" : v === "train" ? "Train" : "Driving"}
                  {trip.hasRentalCar ? " + rental car" : ""}
                </p>
              </div>
            )}
            renderEditor={(draft, setDraft) => (
              <Select value={draft} onValueChange={(v) => setDraft(v as TransportTo | "none")}>
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
            )}
          />

          {trip.transportTo && trip.transportTo !== "drove" && (
            <InlineTextField
              label={trip.transportTo === "flew" ? "Airline & flight number" : "Train line & train number"}
              value={trip.transportDetails ?? ""}
              placeholder={trip.transportTo === "flew" ? "e.g. Delta DL 405" : "e.g. Eurostar 9025"}
              onSave={(v) => saveField({ transportDetails: v || undefined })}
            />
          )}

          <InlineField
            label="Rental car?"
            value={trip.hasRentalCar}
            iconType="custom"
            onSave={(v) => saveField({ hasRentalCar: v })}
            isEmpty={() => false}
            renderDisplay={(v) => <p className="text-sm text-foreground">{v ? "Yes" : "No"}</p>}
            renderEditor={(draft, setDraft) => (
              <Select value={draft ? "yes" : "no"} onValueChange={(v) => setDraft(v === "yes")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            )}
          />

          <InlineTextField
            label="Accommodation name"
            value={trip.accommodationName ?? ""}
            onSave={(v) => saveField({ accommodationName: v || undefined })}
          />
          <InlineTextField
            label="Accommodation area"
            value={trip.accommodationArea ?? ""}
            onSave={(v) => saveField({ accommodationArea: v || undefined })}
          />

          <InlineTextareaField
            label="Notes"
            value={trip.notes ?? ""}
            onSave={(v) => saveField({ notes: v || undefined })}
            className="col-span-2 sm:col-span-3 pt-2 border-t border-border/50"
          />

          <InlineField
            label="The One Thing (highlights)"
            value={(trip.theOneThing as string[] | null) ?? []}
            iconType="custom"
            onSave={(v) => saveField({ theOneThing: v })}
            isEmpty={(v) => v.length === 0}
            emptyText="No highlights yet"
            className="col-span-2 sm:col-span-3 pt-2 border-t border-border/50"
            renderDisplay={(v) => (
              <div className="flex flex-wrap gap-1.5">
                {v.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            renderEditor={(draft, setDraft) => (
              <OneThingInput
                value={draft}
                onChange={setDraft}
                existingValues={allHighlights}
                destination={trip.destination}
              />
            )}
          />

          <InlineTextareaField
            label="Fun fact / memory"
            value={trip.funFact ?? ""}
            placeholder="A memorable fact, story, or highlight about this trip..."
            onSave={(v) => saveField({ funFact: v || undefined })}
            rows={2}
            displayValue={(v) => `"${v}"`}
            className="col-span-2 sm:col-span-3 pt-2 border-t border-border/50"
          />
        </CardContent>
      </Card>

      {/* Photos */}
      {trip && (
        <PhotoGridSection
          tripId={trip.id}
          photoType="photo"
          title="Photos"
          icon={<Camera className="w-5 h-5" />}
          emptyText="No photos yet — add some memories"
          addLabel="Add photo"
          iconPhotoId={trip.iconPhotoId}
          settingIcon={setTripIcon.isPending}
          onSetIcon={(photoId) =>
            setTripIcon.mutate(
              { tripId: trip.id, photoId },
              {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: getGetTripQueryKey(trip.id) });
                  toast.success("Trip cover photo updated");
                },
                onError: () => toast.error("Failed to set trip cover photo"),
              },
            )
          }
        />
      )}

      {/* Magnets */}
      {trip && (
        <PhotoGridSection
          tripId={trip.id}
          photoType="magnet"
          title="Magnets"
          icon={<Magnet className="w-5 h-5" />}
          emptyText="No magnets yet — add a photo to use as the trip icon"
          addLabel="Add magnet"
          iconPhotoId={trip.iconPhotoId}
          settingIcon={setTripIcon.isPending}
          onSetIcon={(photoId) =>
            setTripIcon.mutate(
              { tripId: trip.id, photoId },
              {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: getGetTripQueryKey(trip.id) });
                  toast.success("Trip cover photo updated");
                },
                onError: () => toast.error("Failed to set trip cover photo"),
              },
            )
          }
        />
      )}

      {/* Reminders */}
      {trip && <RemindersSection tripId={trip.id} />}

      {/* Google Calendar link */}
      {canCalendar && (
        <a
          href={buildCalendarUrl(
            trip.title,
            trip.destination,
            trip.startDate!,
            trip.endDate ?? trip.startDate!,
            trip.notes,
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Calendar className="w-4 h-4" />
          Add to Google Calendar
        </a>
      )}

      {/* Itinerary Builder */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-serif text-xl text-foreground">Itinerary</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {itineraryDirty && (
              <Button
                size="sm"
                onClick={handleSaveItinerary}
                disabled={updateTrip.isPending}
              >
                Save itinerary
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingDay(true)}
              disabled={addingDay}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add day
            </Button>
            {localItinerary && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateItinerary}
                disabled={generateItinerary.isPending}
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${generateItinerary.isPending ? "animate-spin" : ""}`} />
                AI regenerate
              </Button>
            )}
          </div>
        </div>

        {/* Days list */}
        {localItinerary?.days && localItinerary.days.length > 0 && (
          <div className="space-y-2">
            {(() => {
              const validDates = localItinerary.days
                .map((d) => d.date)
                .filter((d): d is string => !!d)
                .sort();
              const earliestDate = validDates[0];
              return localItinerary.days.map((day, i) => {
                const dayNumber = day.date && earliestDate
                  ? Math.round(
                      (new Date(`${day.date}T12:00:00`).getTime() -
                        new Date(`${earliestDate}T12:00:00`).getTime()) /
                        86400000,
                    ) + 1
                  : i + 1;
                return (
                  <DayCard
                    key={i}
                    day={day}
                    index={i}
                    dayNumber={dayNumber}
                    onRefresh={handleRefreshDay}
                    refreshing={refreshingDay === i}
                    onAddActivity={(act) => handleAddActivity(i, act)}
                    onDeleteActivity={(ai) => handleDeleteActivity(i, ai)}
                    onDeleteDay={() => handleDeleteDay(i)}
                    onConfirmActivity={(ai) => handleConfirmActivity(i, ai)}
                  />
                );
              });
            })()}
          </div>
        )}

        {/* Add day inline form */}
        {addingDay && (
          <Card className="border-border/50">
            <CardContent className="py-4 space-y-3">
              <p className="text-sm font-medium text-foreground">New day</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Title *</Label>
                  <Input
                    placeholder="e.g. Arrival & Old Town"
                    value={dayForm.title}
                    onChange={(e) => setDayForm((f) => ({ ...f, title: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleAddDay()}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Date (optional)</Label>
                  <Input
                    type="date"
                    value={dayForm.date}
                    onChange={(e) => setDayForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddDay} disabled={!dayForm.title.trim()}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add day
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAddingDay(false); setDayForm({ date: "", title: "" }); }}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI generator — shown when no itinerary yet */}
        {!localItinerary && !addingDay && (
          <Card className="border-border/50">
            <CardContent className="py-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a day-by-day itinerary with AI, or add days manually with the button above.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Trip style</Label>
                  <Select
                    value={itinStyle}
                    onValueChange={(v) => setItinStyle(v as typeof itinStyle)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relaxed">Relaxed — slow, few activities</SelectItem>
                      <SelectItem value="balanced">Balanced — good mix</SelectItem>
                      <SelectItem value="packed">Packed — see everything</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Interests</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {INTERESTS_OPTIONS.map((interest) => (
                      <button
                        key={interest}
                        onClick={() => toggleInterest(interest)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                          itinInterests.includes(interest)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-muted-foreground border-border hover:border-primary/50"
                        }`}
                      >
                        {interest}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Button
                onClick={handleGenerateItinerary}
                disabled={generateItinerary.isPending}
                className="w-full sm:w-auto"
              >
                <Sparkles className={`w-4 h-4 mr-2 ${generateItinerary.isPending ? "animate-pulse" : ""}`} />
                {generateItinerary.isPending ? "Building your itinerary..." : "Generate itinerary"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Style/interests controls when AI-generated itinerary exists but user wants to regenerate */}
        {localItinerary && !addingDay && generateItinerary.isPending && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Building your itinerary…
          </div>
        )}
      </div>

      {/* Documents */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-foreground">Documents</h2>
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleFileUpload}
              disabled={uploadingDoc}
            />
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium transition-colors ${
                uploadingDoc
                  ? "opacity-50 cursor-not-allowed bg-card text-muted-foreground"
                  : "bg-card text-foreground hover:bg-muted cursor-pointer"
              }`}
            >
              <Upload className="w-4 h-4" />
              {uploadingDoc ? "Uploading..." : "Upload"}
            </span>
          </label>
        </div>

        <Card className="border-border/50">
          <CardContent className="py-2">
            {documents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <FileText className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No documents yet. Upload bookings, boarding passes, or confirmations.
                </p>
              </div>
            ) : (
              documents.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  tripId={id}
                  onDelete={handleDeleteDocument}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Packing List + To-Do List side by side */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-serif text-xl text-foreground">Packing List</h2>
          <Card className="border-border/50">
            <CardContent className="py-4">
              <PackingList
                items={packingList}
                tripId={id}
                onSave={handleSavePackingList}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="font-serif text-xl text-foreground">To-Do List</h2>
          <Card className="border-border/50">
            <CardContent className="py-4">
              <TodoList
                items={todoList}
                onSave={handleSaveTodoList}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete trip?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            This will permanently delete "{trip.title}" and all its documents, photos, and reminders. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteTrip.isPending}
            >
              {deleteTrip.isPending ? "Deleting..." : "Delete trip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
