import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Plus, CalendarHeart, Pencil, Trash2 } from "lucide-react";
import {
  useListOrnamentsHallmarkEvents,
  useCreateOrnamentsHallmarkEvent,
  useUpdateOrnamentsHallmarkEvent,
  useDeleteOrnamentsHallmarkEvent,
  type OrnamentsHallmarkEvent,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const eventSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(1000).optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

type EventFormValues = z.infer<typeof eventSchema>;

function EventFormDialog({
  open,
  onOpenChange,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: OrnamentsHallmarkEvent;
}) {
  const createEvent = useCreateOrnamentsHallmarkEvent();
  const updateEvent = useUpdateOrnamentsHallmarkEvent();
  const isEditing = !!event;

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title: event?.title ?? "",
      description: event?.description ?? "",
      startDate: event?.startDate ?? "",
      endDate: event?.endDate ?? "",
    },
  });

  const onSubmit = async (values: EventFormValues) => {
    try {
      if (isEditing && event) {
        await updateEvent.mutateAsync({ id: event.id, data: values });
        toast.success("Event updated");
      } else {
        await createEvent.mutateAsync(values);
        toast.success("Event added");
      }
      onOpenChange(false);
      form.reset();
    } catch {
      toast.error(isEditing ? "Failed to update event" : "Failed to add event");
    }
  };

  const isSaving = createEvent.isPending || updateEvent.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit event" : "Add Hallmark event"}</DialogTitle>
          <DialogDescription>
            Household-shared dates for Hallmark Keepsake events (Open House, etc.). Best-effort
            synced to the shared Hallmark Google Calendar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...form.register("title")} placeholder="Hallmark Open House" />
            {form.formState.errors.title && (
              <p className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start date</Label>
              <Input id="startDate" type="date" {...form.register("startDate")} />
              {form.formState.errors.startDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End date</Label>
              <Input id="endDate" type="date" {...form.register("endDate")} />
              {form.formState.errors.endDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.endDate.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Notes (optional)</Label>
            <Textarea id="description" {...form.register("description")} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? "Save changes" : "Add event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatRange(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  })}`;
}

export default function HallmarkEvents() {
  const { data: events, isLoading } = useListOrnamentsHallmarkEvents();
  const deleteEvent = useDeleteOrnamentsHallmarkEvent();

  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<OrnamentsHallmarkEvent | undefined>(
    undefined,
  );
  const [deleteTarget, setDeleteTarget] = useState<OrnamentsHallmarkEvent | null>(null);

  usePageAssistantContext(
    "ornaments-hallmark-events",
    `Hallmark events page: manage household-shared dates for Hallmark Keepsake events (Open House, etc.), best-effort synced to the shared Hallmark Google Calendar. Currently tracking ${
      events?.length ?? 0
    } event(s).`,
  );

  const sorted = [...(events ?? [])].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );

  const openCreate = () => {
    setEditingEvent(undefined);
    setFormOpen(true);
  };

  const openEdit = (event: OrnamentsHallmarkEvent) => {
    setEditingEvent(event);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEvent.mutateAsync(deleteTarget.id);
      toast.success("Event removed");
    } catch {
      toast.error("Failed to remove event");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Hallmark Events
          </h1>
          <p className="text-muted-foreground mt-1">
            Track Open House and other Hallmark Keepsake dates for the whole household
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          Add event
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border p-10 text-center text-muted-foreground">
          <CalendarHeart className="h-8 w-8 mx-auto mb-3 opacity-50" />
          No Hallmark events yet. Add one to see it countdown on the app launcher.
        </div>
      ) : (
        <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {sorted.map((event) => (
            <li
              key={event.id}
              className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
                <CalendarHeart className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium font-serif tracking-wide truncate">
                  {event.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatRange(event.startDate, event.endDate)}
                  {event.googleEventId ? "" : " · calendar sync pending"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openEdit(event)}
                aria-label="Edit event"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteTarget(event)}
                aria-label="Delete event"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <EventFormDialog open={formOpen} onOpenChange={setFormOpen} event={editingEvent} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be removed for the whole household. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
