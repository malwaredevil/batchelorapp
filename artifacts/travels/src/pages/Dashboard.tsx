import { Link } from "wouter";
import {
  useGetTravelsStats,
  useListTrips,
  useListAllReminders,
  useUpdateReminder,
  getListAllRemindersQueryKey,
  type Trip,
  type TripStatus,
  type Reminder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plane, MapPin, CheckCircle, Calendar, Clock, ArrowRight, Moon, Bell, Check } from "lucide-react";

const STATUS_ORDER: TripStatus[] = ["active", "booked", "planning", "wishlist", "completed"];

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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card className="border-border/50">
      <CardContent className="flex items-center gap-4 py-5">
        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-primary shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-semibold text-foreground leading-none">{value}</p>
          <p className="text-sm text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TripRow({ trip }: { trip: Trip }) {
  return (
    <Link href={`/trips/${trip.id}`}>
      <div className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-muted/60 transition-colors cursor-pointer group">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{trip.title}</p>
            <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              {trip.destination}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          {trip.startDate && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {new Date(trip.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[trip.status]}`}>
            {STATUS_LABELS[trip.status]}
          </span>
          <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </Link>
  );
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useGetTravelsStats();
  const { data: trips = [], isLoading: tripsLoading } = useListTrips();
  const { data: pendingReminders = [] } = useListAllReminders(true);
  const updateReminder = useUpdateReminder();

  const groupedTrips = STATUS_ORDER.reduce<Record<TripStatus, Trip[]>>(
    (acc, status) => {
      acc[status] = trips.filter((t) => t.status === status);
      return acc;
    },
    { active: [], booked: [], planning: [], wishlist: [], completed: [] },
  );

  const activeStatuses: TripStatus[] = STATUS_ORDER.filter(
    (s) => groupedTrips[s].length > 0 && s !== "completed",
  );

  const nextTripCountdown =
    stats?.nextTrip?.startDate ? daysUntil(stats.nextTrip.startDate) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Your Travels</h1>
        <p className="text-muted-foreground mt-1">
          {statsLoading ? "Loading..." : "A quiet record of adventures past and future."}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Plane className="w-5 h-5" />}
          label="Total trips"
          value={statsLoading ? "—" : (stats?.totalTrips ?? 0)}
        />
        <StatCard
          icon={<CheckCircle className="w-5 h-5" />}
          label="Completed"
          value={statsLoading ? "—" : (stats?.completedTrips ?? 0)}
        />
        <StatCard
          icon={<Calendar className="w-5 h-5" />}
          label="Upcoming"
          value={statsLoading ? "—" : (stats?.upcomingTrips ?? 0)}
        />
        <StatCard
          icon={<MapPin className="w-5 h-5" />}
          label="Destinations"
          value={statsLoading ? "—" : (stats?.uniqueDestinations ?? 0)}
        />
      </div>

      {/* Reminders alert */}
      {pendingReminders.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <Bell className="w-4 h-4" />
              {pendingReminders.length} pending reminder{pendingReminders.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-1.5">
            {pendingReminders.slice(0, 5).map((r: Reminder) => {
              const trip = trips.find((t) => t.id === r.tripId);
              const overdue = r.dueDate && new Date(r.dueDate) < new Date();
              return (
                <div key={r.id} className="flex items-center gap-2 group">
                  <button
                    className="w-4 h-4 rounded border border-amber-400 shrink-0 flex items-center justify-center hover:bg-amber-200 transition-colors"
                    onClick={() => {
                      updateReminder.mutate(
                        { tripId: r.tripId, reminderId: r.id, body: { done: true } },
                        { onSuccess: () => qc.invalidateQueries({ queryKey: getListAllRemindersQueryKey(true) }) },
                      );
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${overdue ? "text-red-700 font-medium" : "text-amber-900 dark:text-amber-200"}`}>
                      {r.title}
                    </span>
                    {trip && (
                      <Link href={`/trips/${trip.id}`}>
                        <span className="text-xs text-muted-foreground ml-2 hover:text-primary hover:underline">
                          {trip.destination}
                        </span>
                      </Link>
                    )}
                  </div>
                  {r.dueDate && (
                    <span className={`text-xs shrink-0 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                      {overdue ? "Overdue · " : ""}
                      {new Date(r.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </div>
              );
            })}
            {pendingReminders.length > 5 && (
              <p className="text-xs text-muted-foreground pt-1">
                +{pendingReminders.length - 5} more — check individual trips
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Next trip countdown */}
      {stats?.nextTrip && nextTripCountdown !== null && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center gap-4 py-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground">
                {nextTripCountdown === 0
                  ? "Today is the day!"
                  : nextTripCountdown === 1
                    ? "Tomorrow!"
                    : `${nextTripCountdown} days until your next trip`}
              </p>
              <p className="text-sm text-muted-foreground">
                {stats.nextTrip.destination} &middot;{" "}
                {new Date(stats.nextTrip.startDate).toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline */}
      {tripsLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : trips.length === 0 ? (
        <Card className="border-dashed border-2 border-border/60">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Plane className="w-10 h-10 text-muted-foreground/40" />
            <p className="font-medium text-foreground">No trips yet</p>
            <p className="text-sm text-muted-foreground">
              Start planning your first adventure.
            </p>
            <Link href="/trips">
              <Button className="mt-2">Plan a trip</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {activeStatuses.map((status) => (
            <div key={status}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {STATUS_LABELS[status]}
                  <span className="ml-2 font-normal normal-case">
                    ({groupedTrips[status].length})
                  </span>
                </h2>
              </div>
              <Card className="border-border/50 divide-y divide-border/50">
                <CardContent className="p-0">
                  {groupedTrips[status].map((trip) => (
                    <TripRow key={trip.id} trip={trip} />
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}

          {groupedTrips.completed.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Completed ({groupedTrips.completed.length})
              </h2>
              <Card className="border-border/50 divide-y divide-border/50">
                <CardContent className="p-0">
                  {groupedTrips.completed.slice(0, 5).map((trip) => (
                    <TripRow key={trip.id} trip={trip} />
                  ))}
                  {groupedTrips.completed.length > 5 && (
                    <div className="px-4 py-3">
                      <Link href="/trips?status=completed">
                        <span className="text-sm text-primary hover:underline">
                          View all {groupedTrips.completed.length} completed trips
                        </span>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Year-by-year summary */}
      {(() => {
        const completed = trips.filter((t) => t.status === "completed" && t.startDate);
        if (completed.length === 0) return null;

        const byYear: Record<number, { trips: Trip[]; nights: number }> = {};
        for (const t of completed) {
          const year = new Date(t.startDate!).getFullYear();
          if (!byYear[year]) byYear[year] = { trips: [], nights: 0 };
          byYear[year].trips.push(t);
          if (t.endDate && t.startDate) {
            const nights = Math.round(
              (new Date(t.endDate).getTime() - new Date(t.startDate).getTime()) / 86400000,
            );
            if (nights > 0) byYear[year].nights += nights;
          }
        }
        const years = Object.keys(byYear)
          .map(Number)
          .sort((a, b) => b - a);

        return (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Year in Review
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {years.map((year) => {
                const { trips: yTrips, nights } = byYear[year];
                const destinations = [...new Set(yTrips.map((t) => t.destination))];
                return (
                  <Card key={year} className="border-border/50">
                    <CardContent className="py-4">
                      <p className="font-semibold text-foreground text-lg">{year}</p>
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Plane className="w-3.5 h-3.5" />
                          {yTrips.length} {yTrips.length === 1 ? "trip" : "trips"}
                        </span>
                        {nights > 0 && (
                          <span className="flex items-center gap-1">
                            <Moon className="w-3.5 h-3.5" />
                            {nights} {nights === 1 ? "night" : "nights"}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2.5">
                        {destinations.map((d) => (
                          <span
                            key={d}
                            className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border/50"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
