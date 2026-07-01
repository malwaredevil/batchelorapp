import { useState } from "react";
import { Link } from "wouter";
import {
  useListTrips,
  useCreateTrip,
  getListTripsQueryKey,
  getGetTravelsStatsQueryKey,
  type TripStatus,
  type CreateTripBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MapPin, Plus, Plane, ArrowRight, Filter } from "lucide-react";
import { toast } from "sonner";

const ALL_STATUSES: TripStatus[] = ["wishlist", "planning", "booked", "active", "completed"];

const STATUS_LABELS: Record<TripStatus, string> = {
  wishlist: "Wishlist",
  planning: "Planning",
  booked: "Booked",
  active: "Active",
  completed: "Completed",
};

const STATUS_COLORS: Record<TripStatus, string> = {
  wishlist: "bg-slate-100 text-slate-700 border-slate-200",
  planning: "bg-blue-50 text-blue-700 border-blue-200",
  booked: "bg-green-50 text-green-700 border-green-200",
  active: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-gray-100 text-gray-500 border-gray-200",
};

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.destination) return;
    createTrip.mutate(form as CreateTripBody, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetTravelsStatsQueryKey() });
        toast.success("Trip created");
        onOpenChange(false);
        setForm({ status: "wishlist", travellerCount: 2, hasRentalCar: false });
      },
      onError: () => toast.error("Failed to create trip"),
    });
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
              onValueChange={(v) => set("transportTo", v === "none" ? undefined : v)}
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
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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

export default function Trips() {
  const { data: trips = [], isLoading } = useListTrips();
  const [filterStatus, setFilterStatus] = useState<TripStatus | "all">("all");
  const [creating, setCreating] = useState(false);

  const filtered =
    filterStatus === "all"
      ? trips
      : trips.filter((t) => t.status === filterStatus);

  const grouped = ALL_STATUSES.reduce<Record<TripStatus, typeof trips>>(
    (acc, s) => {
      acc[s] = filtered.filter((t) => t.status === s);
      return acc;
    },
    { active: [], booked: [], planning: [], wishlist: [], completed: [] },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Trips</h1>
          <p className="text-muted-foreground mt-1">Your full travel pipeline.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="w-4 h-4 mr-2" />
          New trip
        </Button>
      </div>

      {/* Filter pills */}
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
              <div className="space-y-2">
                {grouped[status].map((trip) => (
                  <Link key={trip.id} href={`/trips/${trip.id}`}>
                    <Card className="border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group">
                      <CardContent className="flex items-center gap-4 py-4 px-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{trip.title}</p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {trip.destination}
                          </p>
                          {trip.startDate && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(trip.startDate).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                              {trip.endDate && (
                                <>
                                  {" "}—{" "}
                                  {new Date(trip.endDate).toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })}
                                </>
                              )}
                              {" "}
                              &middot; {trip.travellerCount} traveller{trip.travellerCount !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
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
    </div>
  );
}
