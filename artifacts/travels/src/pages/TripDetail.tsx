import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetTrip,
  useUpdateTrip,
  useDeleteTrip,
  useGenerateItinerary,
  useDeleteTripDocument,
  useSendTripMessage,
  useClearTripChat,
  useGetHighlights,
  useListTripPhotos,
  useUploadTripPhoto,
  useDeleteTripPhoto,
  useListReminders,
  useCreateReminder,
  useUpdateReminder,
  useDeleteReminder,
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
  type ChatMessage,
  type TripPhoto,
  type Reminder,
} from "@workspace/api-client-react";
import { OneThingInput } from "@/components/OneThingInput";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Plus,
  ExternalLink,
  MessageCircle,
  Bot,
  Send,
  Camera,
  Bell,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItineraryActivity = {
  time: string;
  name: string;
  description: string;
  proximity: string;
  tip: string;
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
  planning:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  booked:    "bg-orange-50 text-orange-700 border-orange-200",
  active:    "bg-orange-50 text-orange-700 border-orange-200",
  completed: "bg-green-50  text-green-700  border-green-200",
};

const INTERESTS_OPTIONS = [
  "food", "history", "nature", "art", "adventure",
  "shopping", "culture", "beaches", "nightlife", "architecture",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
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
  const ext = doc.originalFilename?.split(".").pop()?.toLowerCase();
  const ed = doc.extractedData as Record<string, unknown> | null;

  const keyFields: Array<{ key: string; label: string }> = [
    { key: "referenceNumber", label: "Ref" },
    { key: "confirmationNumber", label: "Confirmation" },
    { key: "departureDateTime", label: "Departure" },
    { key: "checkInDate", label: "Check-in" },
    { key: "checkOutDate", label: "Check-out" },
    { key: "flightNumber", label: "Flight" },
    { key: "airline", label: "Airline" },
    { key: "hotelName", label: "Hotel" },
  ];

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
        {ed &&
          keyFields
            .filter(({ key }) => ed[key] != null)
            .map(({ key, label }) => (
              <p key={key} className="text-xs text-muted-foreground">
                {label}: <span className="text-foreground">{String(ed[key])}</span>
              </p>
            ))}
      </div>
      <div className="flex items-center gap-1 shrink-0">
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
  onRefresh,
  refreshing,
  onAddActivity,
  onDeleteActivity,
  onDeleteDay,
}: {
  day: ItineraryDay;
  index: number;
  onRefresh: (dayIndex: number) => void;
  refreshing: boolean;
  onAddActivity?: (activity: ItineraryActivity) => void;
  onDeleteActivity?: (activityIndex: number) => void;
  onDeleteDay?: () => void;
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/50 transition-colors text-left"
      >
        <div>
          <p className="font-medium text-foreground">
            Day {index + 1} — {day.title}
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
      </button>

      {open && (
        <div className="bg-card/50">
          <div className="divide-y divide-border/50">
            {day.activities.map((a, ai) => (
              <div key={ai} className="px-4 py-3 space-y-1 group relative">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{a.name}</p>
                    {a.time && <p className="text-xs text-muted-foreground">{a.time}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.proximity && <span className="text-sm">{a.proximity}</span>}
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
                  <p className="text-xs italic text-muted-foreground border-l-2 border-primary/30 pl-2">{a.tip}</p>
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

// ─── Photos Section ───────────────────────────────────────────────────────────

function PhotosSection({ tripId }: { tripId: number }) {
  const qc = useQueryClient();
  const { data: photos = [], isLoading } = useListTripPhotos(tripId);
  const uploadPhoto = useUploadTripPhoto({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTripPhotosQueryKey(tripId) });
        toast.success("Photo uploaded");
      },
      onError: () => toast.error("Upload failed"),
    },
  });
  const deletePhoto = useDeleteTripPhoto({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTripPhotosQueryKey(tripId) });
        toast.success("Photo deleted");
      },
      onError: () => toast.error("Failed to delete photo"),
    },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<TripPhoto | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("photo", file);
    uploadPhoto.mutate({ tripId, formData });
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
          <Camera className="w-5 h-5" />
          Photos
          {photos.length > 0 && (
            <span className="text-sm font-sans font-normal text-muted-foreground">({photos.length})</span>
          )}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploadPhoto.isPending}
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          {uploadPhoto.isPending ? "Uploading..." : "Add photo"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
            <p className="text-sm text-muted-foreground">No photos yet — add some memories</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group aspect-square">
              <img
                src={getTripPhotoImageUrl(tripId, photo.id)}
                alt={photo.caption ?? "Trip photo"}
                className="w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setLightbox(photo)}
              />
              <button
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); deletePhoto.mutate({ tripId, photoId: photo.id }); }}
              >
                <X className="w-3 h-3" />
              </button>
              {photo.caption && (
                <p className="absolute bottom-0 left-0 right-0 text-[10px] text-white bg-black/50 px-1 py-0.5 rounded-b-lg truncate">
                  {photo.caption}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(open) => { if (!open) setLightbox(null); }}>
        <DialogContent className="max-w-3xl">
          {lightbox && (
            <>
              <img
                src={getTripPhotoImageUrl(tripId, lightbox.id)}
                alt={lightbox.caption ?? "Trip photo"}
                className="w-full rounded-lg max-h-[70vh] object-contain"
              />
              {lightbox.caption && (
                <p className="text-sm text-muted-foreground text-center">{lightbox.caption}</p>
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
  const createReminder = useCreateReminder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListRemindersQueryKey(tripId) });
        setNewTitle("");
        setNewDue("");
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
            <div className="flex gap-2">
              <Input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                className="flex-1"
                placeholder="Due date (optional)"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (!newTitle.trim()) return;
                  createReminder.mutate({
                    tripId,
                    body: { title: newTitle.trim(), dueDate: newDue || undefined },
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
                    onDelete={() => deleteReminder.mutate({ tripId, reminderId: r.id })}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ReminderRow({
  reminder,
  tripId,
  onToggle,
  onDelete,
}: {
  reminder: Reminder;
  tripId: number;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const overdue = !reminder.done && reminder.dueDate && new Date(reminder.dueDate) < new Date();
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border group ${reminder.done ? "bg-muted/30 border-border/30" : "bg-card border-border/50"}`}>
      <button onClick={onToggle} className="shrink-0">
        {reminder.done ? (
          <CheckSquare className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Square className="w-4 h-4 text-muted-foreground hover:text-foreground" />
        )}
      </button>
      <p className={`flex-1 text-sm ${reminder.done ? "line-through text-muted-foreground" : overdue ? "text-red-700 font-medium" : "text-foreground"}`}>
        {reminder.title}
      </p>
      {reminder.dueDate && (
        <span className={`text-xs shrink-0 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
          {overdue ? "Overdue · " : ""}
          {new Date(reminder.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      )}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
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
  const deleteTrip = useDeleteTrip();
  const generateItinerary = useGenerateItinerary();
  const deleteTripDocument = useDeleteTripDocument();
  const sendMessage = useSendTripMessage();
  const clearChat = useClearTripChat();
  const { data: allHighlights = [] } = useGetHighlights();

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<UpdateTripBody>>({});
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itinStyle, setItinStyle] = useState<"relaxed" | "balanced" | "packed">("balanced");
  const [itinInterests, setItinInterests] = useState<string[]>(["food", "history", "culture"]);
  const [refreshingDay, setRefreshingDay] = useState<number | null>(null);
  const [localItinerary, setLocalItinerary] = useState<Itinerary | null>(null);
  const [itineraryDirty, setItineraryDirty] = useState(false);
  const [addingDay, setAddingDay] = useState(false);
  const [dayForm, setDayForm] = useState({ date: "", title: "" });
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInitialized, setChatInitialized] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (trip && !chatInitialized) {
      setChatMessages((trip.chatHistory as ChatMessage[] | null) ?? []);
      setChatInitialized(true);
    }
  }, [trip, chatInitialized]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
  };

  const startEdit = () => {
    if (!trip) return;
    setEditForm({
      title: trip.title,
      destination: trip.destination,
      status: trip.status,
      startDate: trip.startDate ?? undefined,
      endDate: trip.endDate ?? undefined,
      transportTo: trip.transportTo ?? undefined,
      transportDetails: trip.transportDetails ?? undefined,
      hasRentalCar: trip.hasRentalCar,
      accommodationName: trip.accommodationName ?? undefined,
      accommodationArea: trip.accommodationArea ?? undefined,
      notes: trip.notes ?? undefined,
      funFact: trip.funFact ?? undefined,
      travellerCount: trip.travellerCount,
      travelers: (trip.travelers as string[] | null) ?? [],
      theOneThing: (trip.theOneThing as string[] | null) ?? [],
    });
    setEditing(true);
  };

  const saveEdit = () => {
    updateTrip.mutate(
      { id, body: editForm },
      {
        onSuccess: () => {
          invalidate();
          setEditing(false);
          toast.success("Trip updated");
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

  const handleSendMessage = () => {
    const text = chatInput.trim();
    if (!text || sendMessage.isPending) return;
    setChatInput("");
    const withUser: ChatMessage[] = [...chatMessages, { role: "user", content: text }];
    setChatMessages(withUser);
    sendMessage.mutate(
      { tripId: id, message: text },
      {
        onSuccess: (data) => setChatMessages(data.history),
        onError: () => {
          setChatMessages(chatMessages);
          toast.error("Failed to get a response. Please try again.");
        },
      },
    );
  };

  const handleClearChat = () => {
    clearChat.mutate(id, {
      onSuccess: () => {
        setChatMessages([]);
        toast.success("Chat cleared");
      },
      onError: () => toast.error("Failed to clear chat"),
    });
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-serif text-2xl text-foreground">{trip.title}</h1>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${STATUS_COLORS[trip.status]}`}
            >
              {STATUS_LABELS[trip.status]}
            </span>
          </div>
          <p className="text-muted-foreground flex items-center gap-1 mt-1">
            <MapPin className="w-4 h-4 shrink-0" />
            {trip.destination}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Edit2 className="w-4 h-4 mr-1.5" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Edit Trip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Trip name</Label>
                <Input
                  value={editForm.title ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Destination</Label>
                <Input
                  value={editForm.destination ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, destination: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editForm.status ?? trip.status}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, status: v as TripStatus }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Travellers (count)</Label>
                <Input
                  type="number"
                  min={1}
                  value={editForm.travellerCount ?? trip.travellerCount}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, travellerCount: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Who came along</Label>
                <div className="flex flex-wrap gap-3">
                  {(["John", "Ashley", "Karis", "Angela"] as const).map((name) => {
                    const checked = ((editForm.travelers as string[] | undefined) ?? []).includes(name);
                    return (
                      <label key={name} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={checked}
                          className="w-4 h-4 rounded border-border accent-primary"
                          onChange={(e) =>
                            setEditForm((f) => {
                              const cur = (f.travelers as string[] | undefined) ?? [];
                              return {
                                ...f,
                                travelers: e.target.checked
                                  ? [...cur, name]
                                  : cur.filter((n) => n !== name),
                              };
                            })
                          }
                        />
                        <span className="text-sm">{name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={editForm.startDate ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, startDate: e.target.value || undefined }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>End date</Label>
                <Input
                  type="date"
                  value={editForm.endDate ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, endDate: e.target.value || undefined }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Transport to destination</Label>
                <Select
                  value={editForm.transportTo ?? "none"}
                  onValueChange={(v) =>
                    setEditForm((f) => ({ ...f, transportTo: v === "none" ? undefined : (v as TransportTo) }))
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
              {editForm.transportTo && editForm.transportTo !== "drove" && (
                <div className="space-y-2">
                  <Label>
                    {editForm.transportTo === "flew" ? "Airline & flight number" : "Train line & train number"}
                  </Label>
                  <Input
                    placeholder={editForm.transportTo === "flew" ? "e.g. Delta DL 405" : "e.g. Eurostar 9025"}
                    value={editForm.transportDetails ?? ""}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, transportDetails: e.target.value || undefined }))
                    }
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Rental car?</Label>
                <Select
                  value={editForm.hasRentalCar ? "yes" : "no"}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, hasRentalCar: v === "yes" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Accommodation name</Label>
                <Input
                  value={editForm.accommodationName ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, accommodationName: e.target.value || undefined }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Accommodation area</Label>
                <Input
                  value={editForm.accommodationArea ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, accommodationArea: e.target.value || undefined }))
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={editForm.notes ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, notes: e.target.value || undefined }))
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>The One Thing (highlights)</Label>
                <OneThingInput
                  value={(editForm.theOneThing as string[] | undefined) ?? []}
                  onChange={(tags) => setEditForm((f) => ({ ...f, theOneThing: tags }))}
                  existingValues={allHighlights}
                  destination={editForm.destination ?? trip.destination}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Fun fact / memory</Label>
                <Textarea
                  rows={2}
                  placeholder="A memorable fact, story, or highlight about this trip..."
                  value={editForm.funFact ?? ""}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, funFact: e.target.value || undefined }))
                  }
                />
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Delete trip
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  <X className="w-4 h-4 mr-1.5" />
                  Cancel
                </Button>
                <Button onClick={saveEdit} disabled={updateTrip.isPending}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {updateTrip.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trip info */}
      {!editing && (
        <Card className="border-border/50">
          <CardContent className="py-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {(trip.startDate || trip.endDate) && (
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Dates</p>
                  <p className="text-sm text-foreground">
                    {formatDate(trip.startDate)}
                    {trip.endDate && <><br />{formatDate(trip.endDate)}</>}
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Travellers</p>
                {(trip.travelers as string[] | null)?.length ? (
                  <p className="text-sm text-foreground">
                    {(trip.travelers as string[]).join(", ")}
                  </p>
                ) : (
                  <p className="text-sm text-foreground">{trip.travellerCount}</p>
                )}
              </div>
            </div>
            {trip.transportTo && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground mt-0.5 shrink-0">
                  <TransportIcon transport={trip.transportTo} />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">Getting there</p>
                  <p className="text-sm text-foreground capitalize">
                    {trip.transportTo === "flew" ? "Flying" : trip.transportTo === "train" ? "Train" : "Driving"}
                    {trip.hasRentalCar ? " + rental car" : ""}
                  </p>
                  {trip.transportDetails && (
                    <p className="text-xs text-muted-foreground mt-0.5">{trip.transportDetails}</p>
                  )}
                </div>
              </div>
            )}
            {trip.accommodationName && (
              <div className="flex items-start gap-2 col-span-2 sm:col-span-1">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Accommodation</p>
                  <p className="text-sm text-foreground">
                    {trip.accommodationName}
                    {trip.accommodationArea ? `, ${trip.accommodationArea}` : ""}
                  </p>
                </div>
              </div>
            )}
            {trip.notes && (
              <div className="col-span-2 sm:col-span-3 pt-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Notes</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{trip.notes}</p>
              </div>
            )}
            {(trip.theOneThing as string[] | null)?.length ? (
              <div className="col-span-2 sm:col-span-3 pt-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground mb-2">The One Thing</p>
                <div className="flex flex-wrap gap-1.5">
                  {(trip.theOneThing as string[]).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {trip.funFact && (
              <div className="col-span-2 sm:col-span-3 pt-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Fun fact / memory</p>
                <p className="text-sm text-foreground italic whitespace-pre-wrap">"{trip.funFact}"</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Photos */}
      {!editing && trip && <PhotosSection tripId={trip.id} />}

      {/* Reminders */}
      {!editing && trip && <RemindersSection tripId={trip.id} />}

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
            {localItinerary.days.map((day, i) => (
              <DayCard
                key={i}
                day={day}
                index={i}
                onRefresh={handleRefreshDay}
                refreshing={refreshingDay === i}
                onAddActivity={(act) => handleAddActivity(i, act)}
                onDeleteActivity={(ai) => handleDeleteActivity(i, ai)}
                onDeleteDay={() => handleDeleteDay(i)}
              />
            ))}
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

      {/* AI Chat Assistant */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            AI Travel Assistant
          </h2>
          {chatMessages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-8"
              onClick={handleClearChat}
              disabled={clearChat.isPending}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Clear chat
            </Button>
          )}
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto px-4 py-4 space-y-3">
              {chatMessages.length === 0 && !sendMessage.isPending && (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Bot className="w-8 h-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Ask me anything about {trip.destination} — things to do, local customs, transport, packing tips, and more.
                  </p>
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-muted text-foreground rounded-tl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {sendMessage.isPending && (
                <div className="flex gap-2.5 justify-start">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-3 text-muted-foreground">
                    <span className="inline-flex gap-1 text-lg leading-none">
                      <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
                      <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
                      <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
                    </span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-border/50 p-3 flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`Ask about ${trip.destination}…`}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={sendMessage.isPending}
              />
              <Button
                size="icon"
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || sendMessage.isPending}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
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
