import { useId, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/ui/dialog";
import { Input } from "@workspace/ui/input";
import { Label } from "@workspace/ui/label";
import { Textarea } from "@workspace/ui/textarea";
import { Button } from "@workspace/ui/button";

// ---------------------------------------------------------------------------
// Generic "create a reminder about this record" dialog (issue #522, EPIC
// #511). Talks directly to the generic POST /api/reminders endpoint
// (routes/reminders.ts) — entirely self-contained so it can be dropped into
// any page with just `entityType`/`entityId`/`defaultTitle`, no per-page
// mutation wiring. Reused as-is (not reimplemented) by both the shared
// collection-ui detail layout (below) and the direct Office Notes / Travel
// Wishlist integrations in issue #523.
// ---------------------------------------------------------------------------

export interface CreateReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  entityId: number;
  /** Prefilled, editable title — e.g. `Reminder: <record title>`. */
  defaultTitle: string;
  onCreated?: () => void;
}

export function CreateReminderDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  defaultTitle,
  onCreated,
}: CreateReminderDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dueId = useId();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setTitle(defaultTitle);
    setDescription("");
    setDueDate("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          entityType,
          entityId,
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          // Bare `YYYY-MM-DD` from <input type="date"> — resolve to
          // midnight local-ish (server treats it the same as every other
          // date-only reminder due date in this app).
          dueAt: dueDate
            ? new Date(`${dueDate}T09:00:00`).toISOString()
            : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      toast.success("Reminder created");
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't create the reminder",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Create reminder
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor={titleId}>Title</Label>
              <Input
                id={titleId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                autoFocus
                data-testid="input-reminder-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={descriptionId}>Description (optional)</Label>
              <Textarea
                id={descriptionId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="input-reminder-description"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={dueId}>Due date (optional)</Label>
              <Input
                id={dueId}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="input-reminder-due-date"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to just keep this on the record for later — manage
                timing, channels, and recurrence from the Reminders page in
                Office.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              data-testid="button-save-reminder"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create reminder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface ReminderBellButtonProps {
  entityType: string;
  entityId: number;
  defaultTitle: string;
  className?: string;
}

/**
 * Self-contained bell icon + dialog: drop this into any detail view with
 * only the three identifying props and it handles everything else. This is
 * what CollectionDetailLayout renders automatically when its `reminder`
 * prop is set, so shared-library consumers get the action for free with no
 * separate wiring (issue #522) — and it's reused directly by Office Notes /
 * Travel Wishlist, which don't use CollectionDetailLayout (issue #523).
 */
export function ReminderBellButton({
  entityType,
  entityId,
  defaultTitle,
  className,
}: ReminderBellButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Create a reminder about this"
        className={
          className ??
          "flex h-8 w-8 items-center justify-center rounded-md border border-card-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        }
        data-testid="button-create-reminder"
      >
        <Bell className="h-4 w-4" />
      </button>
      <CreateReminderDialog
        open={open}
        onOpenChange={setOpen}
        entityType={entityType}
        entityId={entityId}
        defaultTitle={defaultTitle}
      />
    </>
  );
}
