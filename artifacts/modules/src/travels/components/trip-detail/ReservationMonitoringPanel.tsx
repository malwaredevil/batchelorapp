import { useState } from "react";
import {
  useTravelsListReservations,
  useTravelsListTripChanges,
  useTravelsCreateReservation,
  useTravelsDeleteReservation,
  useTravelsUpdateReservationMonitoring,
  useTravelsCheckReservationNow,
  useTravelsDecideChangeEvent,
  getTravelsListReservationsQueryKey,
  getTravelsListTripChangesQueryKey,
} from "@workspace/api-client-react";
import type {
  TravelsTravelsReservation,
  TravelsTravelsChangeEvent,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Plane,
  Hotel,
  Car,
  Train,
  Package,
  Bell,
  BellOff,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  CloudRain,
  Plus,
  Trash2,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  tripId: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const RESERVATION_TYPE_ICONS: Record<string, React.ReactNode> = {
  flight: <Plane className="w-4 h-4" />,
  hotel: <Hotel className="w-4 h-4" />,
  rental_car: <Car className="w-4 h-4" />,
  rail: <Train className="w-4 h-4" />,
  general: <Package className="w-4 h-4" />,
};

const RESERVATION_TYPE_LABELS: Record<string, string> = {
  flight: "Flight",
  hotel: "Hotel",
  rental_car: "Rental Car",
  rail: "Rail",
  general: "General",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  important: "bg-orange-50 text-orange-700 border-orange-200",
  attention: "bg-yellow-50 text-yellow-700 border-yellow-200",
  informational: "bg-blue-50 text-blue-700 border-blue-200",
};

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  critical: <AlertTriangle className="w-4 h-4 text-red-500" />,
  important: <AlertTriangle className="w-4 h-4 text-orange-500" />,
  attention: <Clock className="w-4 h-4 text-yellow-500" />,
  informational: <CloudRain className="w-4 h-4 text-blue-500" />,
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  weather_alert: "Weather Alert",
  check_in_window: "Check-in Reminder",
  cancellation: "Cancellation",
  schedule_shift: "Schedule Change",
  venue_change: "Venue Change",
  status_change: "Status Change",
  document_reminder: "Document Reminder",
  other: "Update",
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function isOpenState(state: string): boolean {
  return (
    state === "detected" || state === "notified" || state === "under_review"
  );
}

// ── Change event row ──────────────────────────────────────────────────────────

function ChangeEventRow({
  change,
  onDecision,
}: {
  change: TravelsTravelsChangeEvent;
  onDecision: (changeId: number, action: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const open = isOpenState(change.state);

  return (
    <div
      className={`rounded-lg border p-3 ${open ? (SEVERITY_COLORS[change.severity] ?? SEVERITY_COLORS["informational"]) : "bg-muted/30 border-border/40 text-muted-foreground"}`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {open ? (
            (SEVERITY_ICONS[change.severity] ?? SEVERITY_ICONS["informational"])
          ) : (
            <CheckCircle className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">
              {CHANGE_TYPE_LABELS[change.changeType] ?? change.changeType}
            </span>
            {!open && (
              <Badge variant="outline" className="text-xs">
                {change.state}
              </Badge>
            )}
          </div>
          {change.materialityReason && (
            <p className="text-xs mt-0.5 opacity-80 line-clamp-2">
              {change.materialityReason}
            </p>
          )}
          {change.fieldDiffs && change.fieldDiffs.length > 0 && (
            <button
              className="text-xs underline opacity-70 mt-1"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <span className="flex items-center gap-1">
                  Hide details <ChevronUp className="w-3 h-3" />
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  Show details <ChevronDown className="w-3 h-3" />
                </span>
              )}
            </button>
          )}
          {expanded && (
            <div className="mt-2 space-y-1">
              {(change.fieldDiffs ?? []).map((diff, i) => (
                <div key={i} className="text-xs bg-white/50 rounded p-2">
                  <span className="font-medium">{diff.field}:</span>{" "}
                  {diff.before !== null && diff.before !== undefined && (
                    <span className="line-through opacity-60 mr-1">
                      {String(diff.before)}
                    </span>
                  )}
                  <span>{String(diff.after ?? "")}</span>
                  {diff.reason && (
                    <span className="opacity-60 ml-1">— {diff.reason}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {open && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => onDecision(change.id, "accept")}
            >
              <CheckCircle className="w-3 h-3 mr-1" />
              OK
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => onDecision(change.id, "reject")}
            >
              <XCircle className="w-3 h-3 mr-1" />
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add reservation dialog ────────────────────────────────────────────────────

type ReservationType = "flight" | "hotel" | "rental_car" | "rail" | "general";

function AddReservationDialog({
  tripId,
  open,
  onClose,
}: {
  tripId: number;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useTravelsCreateReservation();

  const [form, setForm] = useState({
    reservationType: "general" as ReservationType,
    providerName: "",
    confirmationRef: "",
    checkInDate: "",
    checkOutDate: "",
  });

  const handleSubmit = () => {
    create.mutate(
      {
        tripId,
        data: {
          reservationType: form.reservationType,
          providerName: form.providerName || undefined,
          confirmationRef: form.confirmationRef || undefined,
          checkInDate: form.checkInDate || undefined,
          checkOutDate: form.checkOutDate || undefined,
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({
            queryKey: getTravelsListReservationsQueryKey(tripId),
          });
          void qc.invalidateQueries({
            queryKey: getTravelsListTripChangesQueryKey(tripId),
          });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Reservation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Type</Label>
            <Select
              value={form.reservationType}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  reservationType: v as ReservationType,
                }))
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flight">Flight</SelectItem>
                <SelectItem value="hotel">Hotel</SelectItem>
                <SelectItem value="rental_car">Rental Car</SelectItem>
                <SelectItem value="rail">Rail</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Provider / Carrier</Label>
            <Input
              className="mt-1"
              placeholder="e.g. United Airlines, Marriott…"
              value={form.providerName}
              onChange={(e) =>
                setForm((f) => ({ ...f, providerName: e.target.value }))
              }
            />
          </div>
          <div>
            <Label className="text-xs">Confirmation Reference</Label>
            <Input
              className="mt-1"
              placeholder="Booking reference or confirmation #"
              value={form.confirmationRef}
              onChange={(e) =>
                setForm((f) => ({ ...f, confirmationRef: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Check-in / Departure</Label>
              <Input
                className="mt-1"
                type="date"
                value={form.checkInDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, checkInDate: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs">Check-out / Arrival</Label>
              <Input
                className="mt-1"
                type="date"
                value={form.checkOutDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, checkOutDate: e.target.value }))
                }
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add Reservation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reservation row ───────────────────────────────────────────────────────────

function ReservationRow({
  reservation,
  changes,
  onDelete,
}: {
  reservation: TravelsTravelsReservation;
  changes: TravelsTravelsChangeEvent[];
  onDelete: (id: number) => void;
}) {
  const qc = useQueryClient();
  const toggleMonitoring = useTravelsUpdateReservationMonitoring();
  const checkNow = useTravelsCheckReservationNow();

  const openChanges = changes.filter(
    (c) => c.reservationId === reservation.id && isOpenState(c.state),
  );

  const handleToggleMonitoring = () => {
    toggleMonitoring.mutate(
      {
        id: reservation.id,
        data: { monitoringEnabled: !reservation.monitoringEnabled },
      },
      {
        onSuccess: () =>
          void qc.invalidateQueries({
            queryKey: getTravelsListReservationsQueryKey(reservation.tripId),
          }),
      },
    );
  };

  const handleCheckNow = () => {
    checkNow.mutate(
      { id: reservation.id },
      {
        onSuccess: () =>
          void qc.invalidateQueries({
            queryKey: getTravelsListTripChangesQueryKey(reservation.tripId),
          }),
      },
    );
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 text-muted-foreground shrink-0">
          {RESERVATION_TYPE_ICONS[reservation.reservationType] ?? (
            <Package className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">
              {reservation.providerName ||
                RESERVATION_TYPE_LABELS[reservation.reservationType] ||
                "Reservation"}
            </span>
            {reservation.confirmationRef && (
              <span className="text-xs text-muted-foreground font-mono">
                #{reservation.confirmationRef}
              </span>
            )}
            <Badge
              variant="outline"
              className={
                reservation.status === "confirmed"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : reservation.status === "cancelled"
                    ? "bg-red-50 text-red-700 border-red-200"
                    : "bg-muted text-muted-foreground"
              }
            >
              {reservation.status}
            </Badge>
            {openChanges.length > 0 && (
              <Badge
                variant="outline"
                className="bg-orange-50 text-orange-700 border-orange-200"
              >
                {openChanges.length} alert
                {openChanges.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          {(reservation.checkInDate ?? reservation.checkOutDate) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {reservation.checkInDate && formatDate(reservation.checkInDate)}
              {reservation.checkInDate && reservation.checkOutDate && " – "}
              {reservation.checkOutDate && formatDate(reservation.checkOutDate)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title={
              reservation.monitoringEnabled
                ? "Disable monitoring"
                : "Enable monitoring"
            }
            onClick={handleToggleMonitoring}
            disabled={toggleMonitoring.isPending}
          >
            {reservation.monitoringEnabled ? (
              <Bell className="w-3.5 h-3.5 text-blue-500" />
            ) : (
              <BellOff className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Check now"
            onClick={handleCheckNow}
            disabled={!reservation.monitoringEnabled || checkNow.isPending}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${checkNow.isPending ? "animate-spin" : ""}`}
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(reservation.id)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ReservationMonitoringPanel({ tripId }: Props) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: reservations = [], isLoading: loadingRes } =
    useTravelsListReservations(tripId);

  const { data: changes = [], isLoading: loadingChanges } =
    useTravelsListTripChanges(tripId);

  const deleteRes = useTravelsDeleteReservation();
  const decide = useTravelsDecideChangeEvent();

  const openChanges = (changes as TravelsTravelsChangeEvent[]).filter((c) =>
    isOpenState(c.state),
  );

  const handleDelete = (id: number) => {
    deleteRes.mutate(
      { id },
      {
        onSuccess: () =>
          void qc.invalidateQueries({
            queryKey: getTravelsListReservationsQueryKey(tripId),
          }),
      },
    );
  };

  const handleDecision = (changeId: number, action: string) => {
    decide.mutate(
      {
        id: changeId,
        data: {
          action: action as
            | "accept"
            | "reject"
            | "keep_current"
            | "mark_source_incorrect"
            | "disable_monitoring",
        },
      },
      {
        onSuccess: () =>
          void qc.invalidateQueries({
            queryKey: getTravelsListTripChangesQueryKey(tripId),
          }),
      },
    );
  };

  const loading = loadingRes || loadingChanges;
  const typedReservations = reservations as TravelsTravelsReservation[];
  const typedChanges = changes as TravelsTravelsChangeEvent[];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {typedReservations.length === 0
              ? "No reservations tracked"
              : `${typedReservations.length} reservation${typedReservations.length > 1 ? "s" : ""} monitored`}
          </span>
          {openChanges.length > 0 && (
            <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100">
              {openChanges.length} open alert
              {openChanges.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Reservation
        </Button>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Loading…
        </div>
      )}

      {/* Open alerts at top */}
      {openChanges.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Alerts Requiring Attention
          </p>
          {openChanges.map((c) => (
            <ChangeEventRow key={c.id} change={c} onDecision={handleDecision} />
          ))}
        </div>
      )}

      {/* Reservations */}
      {typedReservations.length > 0 && (
        <div className="space-y-2">
          {openChanges.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Reservations
            </p>
          )}
          {typedReservations.map((r) => (
            <ReservationRow
              key={r.id}
              reservation={r}
              changes={typedChanges}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Resolved / historical changes */}
      {typedChanges.filter(
        (c) =>
          c.state === "accepted" ||
          c.state === "rejected" ||
          c.state === "resolved",
      ).length > 0 && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
            <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
            Past alerts
          </summary>
          <div className="mt-2 space-y-2">
            {typedChanges
              .filter(
                (c) =>
                  c.state === "accepted" ||
                  c.state === "rejected" ||
                  c.state === "resolved",
              )
              .slice(0, 10)
              .map((c) => (
                <ChangeEventRow key={c.id} change={c} onDecision={() => {}} />
              ))}
          </div>
        </details>
      )}

      {!loading && typedReservations.length === 0 && (
        <div className="text-center py-6 text-muted-foreground">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No reservations tracked yet.</p>
          <p className="text-xs mt-1">
            Add reservations to receive weather alerts and check-in reminders.
          </p>
        </div>
      )}

      <AddReservationDialog
        tripId={tripId}
        open={showAdd}
        onClose={() => setShowAdd(false)}
      />
    </div>
  );
}
