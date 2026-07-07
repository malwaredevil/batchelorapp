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
  useGetTripDocumentWalletPass,
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
  useGetTravelCalendarStatus,
  useCreateTravelCalendarEvent,
  useListConnectedCalendars,
  useCreateConnectedCalendarEvent,
  useGetCardLayout,
  useUpdateCardLayout,
  useGetTripCardCollapse,
  useUpdateTripCardCollapse,
  useLinkGmailMessage,
  useListCustomDocumentTypes,
  useCreateCustomDocumentType,
  useSuggestDocumentType,
  getTripDocumentDownloadUrl,
  getTripPhotoImageUrl,
  getListTripsQueryKey,
  getGetTripQueryKey,
  getGetTravelsStatsQueryKey,
  getListTripPhotosQueryKey,
  getListRemindersQueryKey,
  getWeatherForecast,
  getAirQualityInfo,
  getPollenInfo,
  searchNearbyPlaces,
  type UpdateTripBody,
  type TripStatus,
  type TransportTo,
  type TripDocument,
  useGenerateTripShareToken,
  useRevokeTripShareToken,
  type TripPhoto,
  type PhotoType,
  type Reminder,
  type TravelsAppUser,
  type CustomDocumentType,
} from "@workspace/api-client-react";
import { OneThingInput } from "@/components/OneThingInput";
import { MagnetCheckDialog } from "@/components/MagnetCheckDialog";
import { ReminderEditDialog } from "@/components/ReminderEditDialog";
import { AttachmentPickerDialog } from "@/components/AttachmentPickerDialog";
import { usePageAssistantContext } from "@/lib/assistant-context";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableSection } from "@/components/trip-detail/sortable-section";
import {
  CardShell,
  DragHandle,
} from "@/components/trip-detail/section-controls";
import { PackingSection } from "@/components/trip-detail/PackingSection";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
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
  Share2,
  Printer,
  Copy,
  Camera,
  Bell,
  Image as ImageIcon,
  Lock,
  LockOpen,
  ScanSearch,
  Wallet,
  Magnet,
  Star,
  CalendarCheck,
  CalendarPlus,
  Cloud,
  Search,
  Globe,
  UtensilsCrossed,
  Wind,
  Flower2,
  Paperclip,
  BedDouble,
  Anchor,
  Shield,
  Compass,
  Ticket,
  Bus,
  Ship,
  Receipt,
  Package,
  CreditCard,
  Briefcase,
  Tag,
  Building2,
  Stamp,
  Leaf,
  AlertCircle,
  Rows2,
} from "lucide-react";
import { toast } from "sonner";
import {
  InlineField,
  InlineTextField,
  InlineTextareaField,
  InlineDateField,
} from "@/components/InlineField";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  WeatherIcon,
  formatTempRangeC,
  formatTempRangeF,
} from "@/lib/weather-icons";
import { TripLocationMap } from "@/components/TripLocationMap";
import { DocTypeTrainingDialog } from "@/components/DocTypeTrainingDialog";

// ─── ItineraryShareExportButtons ──────────────────────────────────────────────

function ItineraryShareExportButtons({
  tripId,
  shareToken,
}: {
  tripId: number;
  shareToken: string | null;
}) {
  const qc = useQueryClient();
  const generateShare = useGenerateTripShareToken();
  const revokeShare = useRevokeTripShareToken();
  const [localToken, setLocalToken] = useState<string | null>(shareToken);

  // keep localToken in sync if the trip data refreshes from the server
  useEffect(() => {
    setLocalToken(shareToken);
  }, [shareToken]);

  const shareUrl =
    localToken != null
      ? `${window.location.origin}/travels/trips/${tripId}/share?token=${localToken}`
      : null;

  const handleShare = () => {
    if (localToken) {
      // Already have a token — copy URL
      navigator.clipboard
        .writeText(shareUrl!)
        .then(() => toast.success("Share link copied to clipboard"))
        .catch(() => toast.error("Failed to copy link"));
      return;
    }
    generateShare.mutate(tripId, {
      onSuccess: (data) => {
        setLocalToken(data.shareToken);
        const url = `${window.location.origin}/travels/trips/${tripId}/share?token=${data.shareToken}`;
        navigator.clipboard
          .writeText(url)
          .then(() => toast.success("Share link copied to clipboard"))
          .catch(() => {});
        qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
      },
      onError: () => toast.error("Failed to generate share link"),
    });
  };

  const handleRevoke = () => {
    revokeShare.mutate(tripId, {
      onSuccess: () => {
        setLocalToken(null);
        toast.success("Share link revoked");
        qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
      },
      onError: () => toast.error("Failed to revoke share link"),
    });
  };

  const handlePrint = () => {
    // Open with ?print=1 so the share page auto-triggers window.print() on load
    if (localToken) {
      window.open(`${shareUrl}&print=1`, "_blank");
    } else {
      generateShare.mutate(tripId, {
        onSuccess: (data) => {
          setLocalToken(data.shareToken);
          const url = `${window.location.origin}/travels/trips/${tripId}/share?token=${data.shareToken}&print=1`;
          window.open(url, "_blank");
          qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
        },
        onError: () => toast.error("Failed to generate share link"),
      });
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleShare}
        disabled={generateShare.isPending}
        title={localToken ? "Copy share link" : "Generate share link"}
      >
        {localToken ? (
          <Copy className="w-4 h-4 mr-1.5" />
        ) : (
          <Share2 className="w-4 h-4 mr-1.5" />
        )}
        {localToken ? "Copy link" : "Share"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handlePrint}
        disabled={generateShare.isPending}
        title="Print / export itinerary"
      >
        <Printer className="w-4 h-4" />
      </Button>
      {localToken && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRevoke}
          disabled={revokeShare.isPending}
          title="Revoke share link"
          className="text-muted-foreground hover:text-destructive"
        >
          Revoke
        </Button>
      )}
    </div>
  );
}

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

type TodoItem = { item: string; done: boolean };

const ALL_STATUSES: TripStatus[] = [
  "wishlist",
  "planning",
  "booked",
  "active",
  "completed",
];
// Ids of the movable Trip Detail cards, in default display order. The top
// trip-info card is fixed and never included here. "packing-todo" is a
// single sortable unit even though it renders two independently-collapsible
// columns (see COLLAPSE_CARD_IDS below).
const DEFAULT_CARD_ORDER = [
  "reminders",
  "itinerary",
  "documents",
  "packing-todo",
  "photos",
  "magnets",
  "weather-nearby",
] as const;

function mergeCardOrder(saved: string[] | undefined): string[] {
  const known = new Set<string>(DEFAULT_CARD_ORDER);
  const cleaned = (saved ?? []).filter((cardId) => known.has(cardId));
  const missing = DEFAULT_CARD_ORDER.filter(
    (cardId) => !cleaned.includes(cardId),
  );
  return [...cleaned, ...missing];
}

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

const INTERESTS_OPTIONS = [
  "food",
  "history",
  "nature",
  "art",
  "adventure",
  "shopping",
  "culture",
  "beaches",
  "nightlife",
  "architecture",
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
  const isoMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?/,
  );
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
  const parsed = new Date(
    `2000-01-01T${match[1]!.padStart(2, "0")}:${match[2]}:00`,
  );
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

function buildReminderCalendarUrl(
  title: string,
  dueDate: string,
  details?: string,
) {
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

// ─── Document-type field lookup ───────────────────────────────────────────────
// Each known document type maps to an ordered list of (key, label) pairs shown
// in DocumentRow. To support a new document type, add an entry here — no other
// code change is needed.  Unknown types fall through to a smart generic fallback
// that auto-displays every non-empty extractedData field with a formatted label.

type FieldSpec = { key: string; label: string };

/** Keys that are never shown as editable inline fields. */
const SYSTEM_ED_KEYS = new Set(["documentType", "isTravelRelated"]);

/** camelCase / snake_case → "Sentence case with spaces" for the generic fallback. */
function edKeyToLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/**
 * Generic fallback — one editable row per non-null extractedData field that
 * isn't a system key.  Arrays (e.g. seatNumbers, passengerNames) are joined
 * so they render as readable comma-separated text.
 */
function genericFields(
  ed: Record<string, unknown> | null | undefined,
): FieldSpec[] {
  if (!ed) return [];
  return Object.entries(ed)
    .filter(([k, v]) => !SYSTEM_ED_KEYS.has(k) && v != null && v !== "")
    .map(([k]) => ({ key: k, label: edKeyToLabel(k) }));
}

const FLIGHT_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Airline" },
  { key: "referenceNumber", label: "Ref" },
  { key: "flightNumber", label: "Flight" },
  { key: "fromLocation", label: "From" },
  { key: "toLocation", label: "To" },
  { key: "departureDateTime", label: "Departure" },
  { key: "arrivalDateTime", label: "Arrival" },
  { key: "seatNumbers", label: "Seat(s)" },
  { key: "returnFlightNumber", label: "Return flight" },
  { key: "returnDepartureDateTime", label: "Return departure" },
];

const HOTEL_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Hotel / property" },
  { key: "referenceNumber", label: "Confirmation" },
  { key: "fromLocation", label: "Location" },
  { key: "checkInDate", label: "Check-in" },
  { key: "checkOutDate", label: "Check-out" },
];

const CAR_RENTAL_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Car company" },
  { key: "referenceNumber", label: "Ref" },
  { key: "vehicleClass", label: "Vehicle" },
  { key: "pickupDateTime", label: "Pickup" },
  { key: "pickupLocation", label: "Pickup location" },
  { key: "dropoffDateTime", label: "Drop-off" },
  { key: "dropoffLocation", label: "Drop-off location" },
];

const TRAIN_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Operator" },
  { key: "referenceNumber", label: "Ref" },
  { key: "trainNumber", label: "Train" },
  { key: "departureStation", label: "From station" },
  { key: "arrivalStation", label: "To station" },
  { key: "departureDateTime", label: "Departure" },
  { key: "arrivalDateTime", label: "Arrival" },
  { key: "coachNumber", label: "Coach" },
  { key: "seatNumbers", label: "Seat(s)" },
];

const BUS_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Operator" },
  { key: "referenceNumber", label: "Ref" },
  { key: "busNumber", label: "Service" },
  { key: "departureStation", label: "Departure point" },
  { key: "arrivalStation", label: "Arrival point" },
  { key: "departureDateTime", label: "Departure" },
  { key: "arrivalDateTime", label: "Arrival" },
  { key: "seatNumbers", label: "Seat(s)" },
];

const FERRY_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Ferry operator" },
  { key: "referenceNumber", label: "Ref" },
  { key: "ferryName", label: "Vessel" },
  { key: "departurePort", label: "Departure port" },
  { key: "arrivalPort", label: "Arrival port" },
  { key: "departureDateTime", label: "Departure" },
  { key: "arrivalDateTime", label: "Arrival" },
  { key: "cabinNumber", label: "Cabin" },
];

const CRUISE_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Cruise line" },
  { key: "referenceNumber", label: "Booking ref" },
  { key: "shipName", label: "Ship" },
  { key: "departurePort", label: "Home port" },
  { key: "departureDateTime", label: "Embarkation" },
  { key: "disembarkationDate", label: "Disembarkation" },
  { key: "cabinNumber", label: "Cabin" },
];

const INSURANCE_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Insurer" },
  { key: "policyNumber", label: "Policy number" },
  { key: "coverageType", label: "Coverage" },
  { key: "coverageStartDate", label: "Starts" },
  { key: "coverageEndDate", label: "Ends" },
  { key: "emergencyPhone", label: "Emergency line" },
];

const VISA_FIELDS: FieldSpec[] = [
  { key: "issuedBy", label: "Issuing country" },
  { key: "visaType", label: "Visa type" },
  { key: "entryType", label: "Entry type" },
  { key: "validFrom", label: "Valid from" },
  { key: "validTo", label: "Valid to" },
  { key: "referenceNumber", label: "Ref / visa number" },
];

const TOUR_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Provider" },
  { key: "referenceNumber", label: "Ref" },
  { key: "activityName", label: "Activity" },
  { key: "departureDateTime", label: "Date / time" },
  { key: "fromLocation", label: "Meeting point" },
  { key: "duration", label: "Duration" },
];

const EVENT_FIELDS: FieldSpec[] = [
  { key: "eventName", label: "Event" },
  { key: "providerName", label: "Venue / organiser" },
  { key: "referenceNumber", label: "Ticket ref" },
  { key: "departureDateTime", label: "Date / time" },
  { key: "venue", label: "Venue" },
  { key: "seatNumbers", label: "Seat(s)" },
];

const RESTAURANT_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Restaurant" },
  { key: "referenceNumber", label: "Reservation ref" },
  { key: "departureDateTime", label: "Reservation time" },
  { key: "partySize", label: "Party size" },
  { key: "fromLocation", label: "Address" },
];

const TRANSFER_FIELDS: FieldSpec[] = [
  { key: "providerName", label: "Provider" },
  { key: "referenceNumber", label: "Ref" },
  { key: "pickupLocation", label: "Pickup" },
  { key: "pickupDateTime", label: "Pickup time" },
  { key: "toLocation", label: "Drop-off" },
  { key: "vehicleClass", label: "Vehicle type" },
  { key: "transferType", label: "Transfer type" },
];

/**
 * Ordered lookup pairs: [predicate, field-array].
 * First match wins — put more specific patterns before more general ones.
 */
const DOC_TYPE_LOOKUP: Array<[(t: string) => boolean, FieldSpec[]]> = [
  // Ground transport — check before flight (avoids "air" in "airport transfer")
  [
    (t) =>
      t.includes("transfer") ||
      t.includes("taxi") ||
      t.includes("shuttle") ||
      t.includes("chauffeur") ||
      t.includes("airport_transfer"),
    TRANSFER_FIELDS,
  ],
  [
    (t) =>
      t.includes("car_rental") ||
      t.includes("car rental") ||
      t.includes("car hire"),
    CAR_RENTAL_FIELDS,
  ],
  // Water
  [(t) => t.includes("cruise") || t.includes("cruise ship"), CRUISE_FIELDS],
  [
    (t) =>
      t.includes("ferry") ||
      t.includes("catamaran") ||
      t.includes("hydrofoil") ||
      t.includes("water taxi"),
    FERRY_FIELDS,
  ],
  // Land — rail & road
  [
    (t) =>
      t.includes("train") ||
      t.includes("rail") ||
      t.includes("eurostar") ||
      t.includes("tgv") ||
      t.includes("intercity"),
    TRAIN_FIELDS,
  ],
  [
    (t) =>
      t.includes("bus") ||
      t.includes("coach") ||
      t.includes("flixbus") ||
      t.includes("megabus"),
    BUS_FIELDS,
  ],
  // Documents
  [(t) => t.includes("insurance"), INSURANCE_FIELDS],
  [
    (t) =>
      t.includes("visa") ||
      t.includes("entry permit") ||
      t.includes(" eta") ||
      t.startsWith("eta") ||
      t.includes("esta"),
    VISA_FIELDS,
  ],
  // Accommodation
  [
    (t) =>
      t.includes("hotel") ||
      t.includes("hostel") ||
      t.includes("airbnb") ||
      t.includes("accommodation") ||
      t.includes("apartment") ||
      t.includes("villa") ||
      t.includes("guesthouse") ||
      t.includes("bnb"),
    HOTEL_FIELDS,
  ],
  // Experiences
  [
    (t) =>
      t.includes("tour") ||
      t.includes("excursion") ||
      t.includes("activity") ||
      t.includes("experience") ||
      t.includes("safari"),
    TOUR_FIELDS,
  ],
  [
    (t) =>
      t.includes("concert") ||
      t.includes("show") ||
      t.includes("theatre") ||
      t.includes("theater") ||
      t.includes("museum") ||
      t.includes("event") ||
      t.includes("attraction") ||
      t.includes("exhibition") ||
      t.includes("opera") ||
      t.includes("ballet") ||
      t.includes("festival"),
    EVENT_FIELDS,
  ],
  [
    (t) =>
      t.includes("restaurant") ||
      t.includes("dining") ||
      t.includes("reservation") ||
      t.includes("bistro"),
    RESTAURANT_FIELDS,
  ],
  // Air — catch-all after ground alternatives
  [
    (t) =>
      t.includes("flight") ||
      t.includes("air") ||
      t.includes("airline") ||
      t.includes("boarding"),
    FLIGHT_FIELDS,
  ],
];

/** Keys whose values should render with an ISO date-time placeholder in the edit input. */
const DATE_LIKE_KEYS = new Set(["validFrom", "validTo"]);

// ─── Icon + colour lookup tables (DocTypeVisual, icon picker, training dialog) ─

const ICON_COMPONENTS: Record<string, React.ElementType> = {
  Plane,
  Train,
  Bus,
  Car,
  Ship,
  Anchor,
  BedDouble,
  Shield,
  Globe,
  Compass,
  Ticket,
  UtensilsCrossed,
  FileText,
  Receipt,
  Package,
  CreditCard,
  Briefcase,
  Tag,
  Building2,
  MapPin,
  Camera,
  Stamp,
  Leaf,
  Star,
  AlertCircle,
};

const COLOR_CLASSES: Record<string, { bg: string; fg: string }> = {
  blue: {
    bg: "bg-blue-100 dark:bg-blue-950",
    fg: "text-blue-600 dark:text-blue-400",
  },
  violet: {
    bg: "bg-violet-100 dark:bg-violet-950",
    fg: "text-violet-600 dark:text-violet-400",
  },
  teal: {
    bg: "bg-teal-100 dark:bg-teal-950",
    fg: "text-teal-600 dark:text-teal-400",
  },
  orange: {
    bg: "bg-orange-100 dark:bg-orange-950",
    fg: "text-orange-600 dark:text-orange-400",
  },
  green: {
    bg: "bg-green-100 dark:bg-green-950",
    fg: "text-green-600 dark:text-green-400",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-950",
    fg: "text-amber-600 dark:text-amber-400",
  },
  red: {
    bg: "bg-red-100 dark:bg-red-950",
    fg: "text-red-600 dark:text-red-400",
  },
  indigo: {
    bg: "bg-indigo-100 dark:bg-indigo-950",
    fg: "text-indigo-600 dark:text-indigo-400",
  },
  rose: {
    bg: "bg-rose-100 dark:bg-rose-950",
    fg: "text-rose-600 dark:text-rose-400",
  },
  emerald: {
    bg: "bg-emerald-100 dark:bg-emerald-950",
    fg: "text-emerald-600 dark:text-emerald-400",
  },
  sky: {
    bg: "bg-sky-100 dark:bg-sky-950",
    fg: "text-sky-600 dark:text-sky-400",
  },
  slate: {
    bg: "bg-slate-100 dark:bg-slate-800",
    fg: "text-slate-500 dark:text-slate-400",
  },
  pink: {
    bg: "bg-pink-100 dark:bg-pink-950",
    fg: "text-pink-600 dark:text-pink-400",
  },
  cyan: {
    bg: "bg-cyan-100 dark:bg-cyan-950",
    fg: "text-cyan-600 dark:text-cyan-400",
  },
};

const STANDARD_DOC_TYPES: { key: string; label: string }[] = [
  { key: "flight_ticket", label: "Flight Ticket" },
  { key: "boarding_pass", label: "Boarding Pass" },
  { key: "hotel_confirmation", label: "Hotel Confirmation" },
  { key: "car_rental", label: "Car Rental" },
  { key: "train_ticket", label: "Train Ticket" },
  { key: "bus_ticket", label: "Bus Ticket" },
  { key: "ferry", label: "Ferry Ticket" },
  { key: "cruise", label: "Cruise Confirmation" },
  { key: "travel_insurance", label: "Travel Insurance" },
  { key: "visa", label: "Visa / Entry Document" },
  { key: "tour", label: "Tour Booking" },
  { key: "activity", label: "Activity Booking" },
  { key: "event_ticket", label: "Event Ticket" },
  { key: "restaurant_reservation", label: "Restaurant Reservation" },
  { key: "airport_transfer", label: "Airport Transfer" },
];

function allDocTypeOptions(customTypes: CustomDocumentType[]) {
  const custom = customTypes.map((ct) => ({
    key: ct.typeKey,
    label: ct.typeName,
  }));
  return [...STANDARD_DOC_TYPES, ...custom, { key: "other", label: "Other" }];
}

function getFieldsForDocType(
  docType: string,
  ed: Record<string, unknown> | null | undefined,
): FieldSpec[] {
  const t = docType.toLowerCase();
  for (const [matches, fields] of DOC_TYPE_LOOKUP) {
    if (matches(t)) return fields;
  }
  return genericFields(ed);
}
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

type DocVisualStyle = {
  Icon: React.ElementType;
  bg: string;
  fg: string;
};

function getDocVisualStyle(
  documentType: string | null | undefined,
  ext: string | undefined,
): DocVisualStyle {
  const t = (documentType ?? "").toLowerCase();
  if (t.includes("flight") || t.includes("boarding"))
    return {
      Icon: Plane,
      bg: "bg-blue-100 dark:bg-blue-950",
      fg: "text-blue-600 dark:text-blue-400",
    };
  if (t.includes("hotel") || t === "accommodation")
    return {
      Icon: BedDouble,
      bg: "bg-green-100 dark:bg-green-950",
      fg: "text-green-600 dark:text-green-400",
    };
  if (t === "car_rental")
    return {
      Icon: Car,
      bg: "bg-orange-100 dark:bg-orange-950",
      fg: "text-orange-600 dark:text-orange-400",
    };
  if (t.includes("train"))
    return {
      Icon: Train,
      bg: "bg-violet-100 dark:bg-violet-950",
      fg: "text-violet-600 dark:text-violet-400",
    };
  if (t.includes("bus") || t.includes("coach"))
    return {
      Icon: Bus,
      bg: "bg-teal-100 dark:bg-teal-950",
      fg: "text-teal-600 dark:text-teal-400",
    };
  if (t.includes("ferry") || t.includes("cruise"))
    return {
      Icon: Anchor,
      bg: "bg-sky-100 dark:bg-sky-950",
      fg: "text-sky-600 dark:text-sky-400",
    };
  if (t.includes("insurance"))
    return {
      Icon: Shield,
      bg: "bg-amber-100 dark:bg-amber-950",
      fg: "text-amber-600 dark:text-amber-400",
    };
  if (
    t.includes("visa") ||
    t.includes("esta") ||
    t.includes("eta") ||
    t.includes("entry")
  )
    return {
      Icon: Globe,
      bg: "bg-indigo-100 dark:bg-indigo-950",
      fg: "text-indigo-600 dark:text-indigo-400",
    };
  if (t.includes("tour") || t.includes("activity") || t.includes("excursion"))
    return {
      Icon: Compass,
      bg: "bg-emerald-100 dark:bg-emerald-950",
      fg: "text-emerald-600 dark:text-emerald-400",
    };
  if (t.includes("event") || t.includes("concert") || t.includes("show"))
    return {
      Icon: Ticket,
      bg: "bg-rose-100 dark:bg-rose-950",
      fg: "text-rose-600 dark:text-rose-400",
    };
  if (t.includes("restaurant") || t.includes("dining"))
    return {
      Icon: UtensilsCrossed,
      bg: "bg-red-100 dark:bg-red-950",
      fg: "text-red-600 dark:text-red-400",
    };
  if (t.includes("transfer") || t.includes("taxi") || t.includes("shuttle"))
    return {
      Icon: Car,
      bg: "bg-slate-100 dark:bg-slate-800",
      fg: "text-slate-500 dark:text-slate-400",
    };
  // File-type fallbacks
  if (ext === "pdf")
    return {
      Icon: FileText,
      bg: "bg-red-50 dark:bg-red-950/60",
      fg: "text-red-500 dark:text-red-400",
    };
  return { Icon: FileText, bg: "bg-secondary", fg: "text-muted-foreground" };
}

function DocTypeVisual({
  doc,
  tripId,
  customTypes,
}: {
  doc: TripDocument;
  tripId: number;
  customTypes?: CustomDocumentType[];
}) {
  const [imgError, setImgError] = useState(false);
  const ext = doc.originalFilename?.split(".").pop()?.toLowerCase();
  const isImage = IMAGE_EXTS.has(ext ?? "") && !imgError;

  if (isImage) {
    return (
      <img
        src={getTripDocumentDownloadUrl(tripId, doc.id)}
        alt=""
        className="w-9 h-9 rounded-lg object-cover shrink-0 ring-1 ring-border/40"
        onError={() => setImgError(true)}
      />
    );
  }

  // Per-document icon override (user-chosen)
  if (doc.iconOverride && ICON_COMPONENTS[doc.iconOverride]) {
    const OverrideIcon = ICON_COMPONENTS[doc.iconOverride];
    const { bg, fg } = COLOR_CLASSES.slate;
    return (
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${bg}`}
      >
        <OverrideIcon className={`w-4 h-4 ${fg}`} />
      </div>
    );
  }

  // Custom document type with its own icon + colour
  if (customTypes && doc.documentType) {
    const ct = customTypes.find((t) => t.typeKey === doc.documentType);
    if (ct?.iconName && ICON_COMPONENTS[ct.iconName]) {
      const CtIcon = ICON_COMPONENTS[ct.iconName];
      const { bg, fg } =
        COLOR_CLASSES[ct.colorKey ?? "slate"] ?? COLOR_CLASSES.slate;
      return (
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${bg}`}
        >
          <CtIcon className={`w-4 h-4 ${fg}`} />
        </div>
      );
    }
  }

  const { Icon, bg, fg } = getDocVisualStyle(doc.documentType, ext);
  return (
    <div
      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${bg}`}
    >
      <Icon className={`w-4 h-4 ${fg}`} />
    </div>
  );
}

function DocumentRow({
  doc,
  tripId,
  onDelete,
  compact = false,
}: {
  doc: TripDocument;
  tripId: number;
  onDelete: (docId: number) => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const updateTripDocument = useUpdateTripDocument();
  const rescanTripDocument = useRescanTripDocument();
  const walletPass = useGetTripDocumentWalletPass();
  const linkGmail = useLinkGmailMessage();
  const [addMoreOpen, setAddMoreOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const ed = doc.extractedData as Record<string, unknown> | null;
  const lockedFields = doc.lockedFields ?? [];
  const titleLocked = lockedFields.includes("title");
  const docTypeLocked = lockedFields.includes("documentType");
  const [showTrainDialog, setShowTrainDialog] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [localExpanded, setLocalExpanded] = useState(!compact);
  useEffect(() => {
    setLocalExpanded(!compact);
  }, [compact]);
  const showFields = !compact || localExpanded;
  const { data: customTypes = [] } = useListCustomDocumentTypes();

  const saveDocumentType = (value: string) => {
    updateTripDocument.mutate(
      { tripId, docId: doc.id, body: { documentType: value } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
          if (value === "other") setShowTrainDialog(true);
        },
        onError: () => toast.error("Failed to update document type"),
      },
    );
  };

  const saveIconOverride = (iconName: string | null) => {
    updateTripDocument.mutate(
      { tripId, docId: doc.id, body: { iconOverride: iconName } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) }),
        onError: () => toast.error("Failed to save icon"),
      },
    );
  };

  const saveTitle = () => {
    const val = titleDraft.trim();
    setEditingTitle(false);
    if (val === (doc.title ?? "")) return;
    updateTripDocument.mutate(
      { tripId, docId: doc.id, body: { title: val || null } },
      {
        onSuccess: () =>
          qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) }),
        onError: () => toast.error("Failed to save title"),
      },
    );
  };

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

  const handleAddToWallet = () => {
    walletPass.mutate(
      { tripId, docId: doc.id },
      {
        onSuccess: ({ saveUrl }) => {
          window.open(saveUrl, "_blank", "noopener,noreferrer");
        },
        onError: () =>
          toast.error("Couldn't create a Google Wallet pass for this document"),
      },
    );
  };

  // Derive the field list from the document's AI-classified type using the
  // data-driven lookup table defined above DocumentRow.  Unknown / future types
  // fall through to a generic fallback that auto-displays every extracted field.
  const keyFields = getFieldsForDocType(doc.documentType ?? "", ed);

  const saveExtractedField = (key: string, rawValue: string) => {
    const value = rawValue.trim();
    const extractedData: Record<string, unknown> = {
      ...(ed ?? {}),
      [key]: value ? value : null,
    };
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
    <>
      <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
        <button
          type="button"
          onClick={() => setShowIconPicker(true)}
          className="shrink-0 rounded-lg transition-opacity hover:opacity-70"
          title="Click to change icon"
        >
          <DocTypeVisual doc={doc} tripId={tripId} customTypes={customTypes} />
        </button>
        <div className="flex-1 min-w-0">
          {/* Header row: title/doctype on the left, action icons on the right.
              Keeping action buttons here (not in the outer flex) means the
              fields section below gets the full content-column width and is
              never squeezed on narrow mobile screens. */}
          <div className="flex items-start gap-1">
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-0.5 -ml-0.5">
                {editingTitle ? (
                  <input
                    autoFocus
                    className="flex-1 text-sm font-medium bg-transparent border-b border-primary/60 outline-none pb-0.5 min-w-0"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => saveTitle()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveTitle();
                      if (e.key === "Escape") setEditingTitle(false);
                    }}
                    placeholder={doc.originalFilename ?? "Add a title…"}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTitleDraft(doc.title ?? "");
                      setEditingTitle(true);
                    }}
                    className="flex-1 text-left text-sm font-medium text-foreground truncate hover:text-primary transition-colors pl-0.5"
                    title="Click to edit title"
                  >
                    {doc.title || doc.originalFilename || "Untitled"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleFieldLock("title")}
                  className={`shrink-0 p-0.5 mt-0.5 transition-colors ${
                    titleLocked
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-muted-foreground/25 hover:text-muted-foreground"
                  }`}
                  title={
                    titleLocked
                      ? "Title locked — AI won't overwrite on rescan"
                      : "Click to lock title"
                  }
                >
                  {titleLocked ? (
                    <Lock className="w-3 h-3" />
                  ) : (
                    <LockOpen className="w-3 h-3" />
                  )}
                </button>
              </div>
              {doc.title &&
                doc.originalFilename &&
                doc.title !== doc.originalFilename && (
                  <p className="text-[11px] text-muted-foreground/50 truncate leading-tight pl-0.5">
                    {doc.originalFilename}
                  </p>
                )}
              <div className="flex items-center gap-1">
                <Select
                  value={doc.documentType ?? "other"}
                  onValueChange={saveDocumentType}
                  disabled={docTypeLocked}
                >
                  <SelectTrigger className="h-5 text-xs border-0 bg-transparent px-0.5 py-0 gap-0.5 text-muted-foreground hover:text-foreground focus:ring-0 w-auto max-w-[190px] [&>svg]:w-3 [&>svg]:h-3 [&>svg]:opacity-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allDocTypeOptions(customTypes).map((opt) => (
                      <SelectItem
                        key={opt.key}
                        value={opt.key}
                        className="text-xs"
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => toggleFieldLock("documentType")}
                  className={`shrink-0 p-0.5 transition-colors ${
                    docTypeLocked
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-muted-foreground/25 hover:text-muted-foreground"
                  }`}
                  title={
                    docTypeLocked
                      ? "Document type locked"
                      : "Click to lock document type"
                  }
                >
                  {docTypeLocked ? (
                    <Lock className="w-3 h-3" />
                  ) : (
                    <LockOpen className="w-3 h-3" />
                  )}
                </button>
                {(!ed || Object.keys(ed).length === 0) && (
                  <span
                    title="AI hasn't extracted details yet — click the scan icon to retry"
                    className="inline-flex items-center gap-1 text-xs text-amber-500"
                  >
                    <Sparkles className="w-3 h-3 animate-pulse" />
                    <span className="text-[11px]">Processing…</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
              {compact && (
                <button
                  type="button"
                  onClick={() => setLocalExpanded((v) => !v)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title={localExpanded ? "Collapse details" : "Expand details"}
                >
                  {localExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                onClick={handleRescan}
                disabled={rescanTripDocument.isPending}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Re-scan document with AI (locked fields are preserved)"
              >
                <ScanSearch
                  className={`w-4 h-4 ${rescanTripDocument.isPending ? "animate-pulse" : ""}`}
                />
              </button>
              <button
                onClick={handleAddToWallet}
                disabled={walletPass.isPending}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Add to Google Wallet"
              >
                <Wallet
                  className={`w-4 h-4 ${walletPass.isPending ? "animate-pulse" : ""}`}
                />
              </button>
              <a
                href={getTripDocumentDownloadUrl(tripId, doc.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Download"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
              {doc.gmailMessageId && (
                <button
                  type="button"
                  onClick={() => setAddMoreOpen(true)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Add more from this email"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => onDelete(doc.id)}
                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                title="Remove document"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {showFields && keyFields.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {keyFields.map(({ key, label }) => {
                const isLocked = lockedFields.includes(key);
                const isDateField =
                  key.toLowerCase().includes("date") || DATE_LIKE_KEYS.has(key);
                const rawValue = ed?.[key] != null ? String(ed[key]) : "";
                return (
                  <div key={key} className="flex items-start gap-1">
                    <div className="flex-1 min-w-0">
                      <InlineTextField
                        label={label}
                        value={rawValue}
                        onSave={(v) => saveExtractedField(key, v)}
                        saving={updateTripDocument.isPending}
                        placeholder={
                          isDateField ? "e.g. 2026-08-14" : undefined
                        }
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
                      title={
                        isLocked
                          ? "Locked — AI rescan won't overwrite"
                          : "Unlocked — AI rescan may update"
                      }
                    >
                      {isLocked ? (
                        <Lock className="w-3.5 h-3.5" />
                      ) : (
                        <LockOpen className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {addMoreOpen && doc.gmailMessageId && (
        <AttachmentPickerDialog
          messageId={doc.gmailMessageId}
          isLinking={linkGmail.isPending}
          defaultAllUnchecked
          onClose={() => setAddMoreOpen(false)}
          onConfirm={(attachmentIds, includeEmailBody, titles) => {
            linkGmail.mutate(
              {
                messageId: doc.gmailMessageId!,
                tripId,
                attachmentIds,
                includeEmailBody,
                titles,
              },
              {
                onSuccess: () => {
                  qc.invalidateQueries({
                    queryKey: getGetTripQueryKey(tripId),
                  });
                  setAddMoreOpen(false);
                  toast.success("Documents added from email");
                },
                onError: () =>
                  toast.error("Failed to add documents from email"),
              },
            );
          }}
        />
      )}

      {/* Icon picker dialog */}
      {showIconPicker && (
        <Dialog open onOpenChange={(open) => !open && setShowIconPicker(false)}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-sm">Choose icon</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-6 gap-1 py-1">
              {Object.entries(ICON_COMPONENTS).map(([name, IconComp]) => {
                const active = doc.iconOverride === name;
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    className={`p-2 rounded-lg flex items-center justify-center transition-colors ${
                      active
                        ? "bg-primary/10 ring-1 ring-primary/30 text-primary"
                        : "hover:bg-muted text-muted-foreground"
                    }`}
                    onClick={() => {
                      saveIconOverride(active ? null : name);
                      setShowIconPicker(false);
                    }}
                  >
                    <IconComp className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
            {doc.iconOverride && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground pt-1"
                onClick={() => {
                  saveIconOverride(null);
                  setShowIconPicker(false);
                }}
              >
                Reset to default
              </button>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Custom document type training dialog */}
      {showTrainDialog && (
        <DocTypeTrainingDialog
          onClose={() => setShowTrainDialog(false)}
          onSaved={() => setShowTrainDialog(false)}
        />
      )}
    </>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-px align-middle">
      {Array.from({ length: 5 }).map((_, i) => {
        const fillPct = Math.round(Math.max(0, Math.min(1, rating - i)) * 100);
        return (
          <span key={i} className="relative inline-block w-3 h-3 shrink-0">
            <Star className="absolute inset-0 w-3 h-3 text-muted-foreground/30" />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fillPct}%` }}
            >
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

const NEARBY_SEARCH_CATEGORIES = [
  "restaurants",
  "coffee",
  "bars",
  "museums",
  "pharmacy",
  "atm",
  "grocery store",
  "attractions",
];

function TripWeatherAndPlaces({
  tripId,
  lat,
  lng,
}: {
  tripId: number;
  lat: number;
  lng: number;
}) {
  const [placeQuery, setPlaceQuery] = useState("restaurants");
  const [searchTerm, setSearchTerm] = useState("restaurants");

  const weatherQuery = useQuery({
    queryKey: ["travels-weather", tripId],
    queryFn: () => getWeatherForecast(lat, lng),
    staleTime: 1000 * 60 * 30,
  });

  const placesQuery = useQuery({
    queryKey: ["travels-nearby-places", tripId, searchTerm],
    queryFn: () => searchNearbyPlaces(searchTerm, lat, lng),
    staleTime: 1000 * 60 * 10,
  });

  const airQualityQuery = useQuery({
    queryKey: ["travels-air-quality", tripId],
    queryFn: () => getAirQualityInfo(lat, lng),
    staleTime: 1000 * 60 * 30,
  });

  const pollenQuery = useQuery({
    queryKey: ["travels-pollen", tripId],
    queryFn: () => getPollenInfo(lat, lng),
    staleTime: 1000 * 60 * 60,
  });

  const airQuality = airQualityQuery.data?.airQuality;
  const pollen = pollenQuery.data?.pollen;

  return (
    <div className="space-y-4">
      <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
        <Cloud className="w-5 h-5" />
        Weather &amp; nearby
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 items-stretch">
        <TripLocationMap
          lat={lat}
          lng={lng}
          places={placesQuery.data?.places ?? []}
        />
        <div className="space-y-1.5">
          {weatherQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading forecast…</p>
          )}
          {weatherQuery.isError && (
            <p className="text-sm text-muted-foreground">
              Weather forecast unavailable
            </p>
          )}
          {weatherQuery.data?.forecast?.length === 0 &&
            !weatherQuery.isLoading && (
              <p className="text-sm text-muted-foreground">
                No forecast available (too far out)
              </p>
            )}
          <ul className="space-y-1.5">
            {weatherQuery.data?.forecast?.slice(0, 5).map((day) => (
              <li
                key={day.date}
                className="flex items-center gap-3 rounded-lg border-2 border-sky-100 bg-gradient-to-br from-sky-50/70 to-transparent p-2 dark:border-sky-900/40 dark:from-sky-950/20"
              >
                <WeatherIcon condition={day.conditionDescription} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {formatDate(day.date)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {day.conditionDescription ?? "Unknown"}
                  </p>
                </div>
                <div className="shrink-0 text-right leading-tight">
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {formatTempRangeC(day.maxTempC, day.minTempC)}
                  </p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {formatTempRangeF(day.maxTempC, day.minTempC)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {(airQuality || pollen) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {airQuality && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card px-2.5 py-1 text-xs">
                  <Wind className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    AQI {airQuality.aqi}
                  </span>
                  <span className="text-muted-foreground">
                    {airQuality.category}
                  </span>
                </span>
              )}
              {pollen && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card px-2.5 py-1 text-xs">
                  <Flower2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium text-foreground">Pollen</span>
                  <span className="text-muted-foreground">
                    {pollen.overallCategory}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-border/50 space-y-2">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            value={placeQuery}
            onChange={(e) => setPlaceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && placeQuery.trim())
                setSearchTerm(placeQuery.trim());
            }}
            placeholder="Search nearby (restaurants, museums, coffee...)"
            className="h-8"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!placeQuery.trim()}
            onClick={() => setSearchTerm(placeQuery.trim())}
          >
            Search
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {NEARBY_SEARCH_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => {
                setPlaceQuery(category);
                setSearchTerm(category);
              }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                searchTerm === category
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
        {placesQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Searching…</p>
        )}
        {placesQuery.isError && (
          <p className="text-sm text-muted-foreground">
            Couldn't search nearby places
          </p>
        )}
        {placesQuery.data?.places?.length === 0 && !placesQuery.isLoading && (
          <p className="text-sm text-muted-foreground">No results found</p>
        )}
        <ul className="space-y-2">
          {placesQuery.data?.places?.slice(0, 6).map((place) => (
            <li
              key={place.id}
              className="flex items-start justify-between gap-2 rounded-md border border-border/40 p-2 text-sm transition-colors hover:border-border"
            >
              <div className="min-w-0">
                {place.googleMapsUri ? (
                  <a
                    href={place.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {place.name}
                  </a>
                ) : (
                  <p className="truncate font-medium text-foreground">
                    {place.name}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {place.address}
                  {place.rating != null && (
                    <>
                      {" · "}
                      <StarRating rating={place.rating} /> {place.rating}
                      {place.userRatingCount != null
                        ? ` (${place.userRatingCount})`
                        : ""}
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {place.websiteUri && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={place.websiteUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${place.name} website`}
                        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                      >
                        <Globe className="h-4 w-4" />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>Visit website</TooltipContent>
                  </Tooltip>
                )}
                {place.googleMapsUri && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={place.googleMapsUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${place.name} menu on Google Maps`}
                        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                      >
                        <UtensilsCrossed className="h-4 w-4" />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>View menu on Google Maps</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </li>
          ))}
        </ul>
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
  const [actForm, setActForm] = useState({
    time: "",
    name: "",
    description: "",
    proximity: "",
    tip: "",
  });

  const submitActivity = () => {
    if (!actForm.name.trim()) return;
    onAddActivity?.({
      ...actForm,
      name: actForm.name.trim(),
      description: actForm.description.trim(),
      tip: actForm.tip.trim(),
      proximity: actForm.proximity.trim(),
    });
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
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/50 transition-colors text-left cursor-pointer"
      >
        <div>
          <p className="font-medium text-foreground">
            Day {dayNumber} — {day.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(day.date)} · {day.activities.length}{" "}
            {day.activities.length === 1 ? "activity" : "activities"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {onDeleteDay && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteDay();
              }}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete this day"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefresh(index);
            }}
            disabled={refreshing}
            className="p-1 text-muted-foreground hover:text-primary transition-colors"
            title="Regenerate this day with AI"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
            />
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
                      <p className="text-sm font-medium text-foreground">
                        {a.name}
                      </p>
                      {a.status === "tentative" && (
                        <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
                          Tentative
                        </span>
                      )}
                    </div>
                    {a.time && (
                      <p className="text-xs text-muted-foreground">
                        {formatTimeOfDay(a.time)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.proximity && (
                      <span className="text-sm">{a.proximity}</span>
                    )}
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
                {a.description && (
                  <p className="text-sm text-muted-foreground">
                    {a.description}
                  </p>
                )}
                {a.tip && (
                  <p className="text-xs italic text-muted-foreground border-l-2 border-primary/30 pl-2">
                    {formatTipText(a.tip)}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Add activity form */}
          {onAddActivity && (
            <div className="px-4 py-3 border-t border-border/50">
              {addingActivity ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Activity name *"
                      value={actForm.name}
                      onChange={(e) =>
                        setActForm((f) => ({ ...f, name: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && submitActivity()}
                    />
                    <Input
                      placeholder="Time (e.g. 9:00 AM)"
                      value={actForm.time}
                      onChange={(e) =>
                        setActForm((f) => ({ ...f, time: e.target.value }))
                      }
                    />
                  </div>
                  <Input
                    placeholder="Description"
                    value={actForm.description}
                    onChange={(e) =>
                      setActForm((f) => ({ ...f, description: e.target.value }))
                    }
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Tip (optional)"
                      value={actForm.tip}
                      onChange={(e) =>
                        setActForm((f) => ({ ...f, tip: e.target.value }))
                      }
                    />
                    <Input
                      placeholder="Proximity (optional)"
                      value={actForm.proximity}
                      onChange={(e) =>
                        setActForm((f) => ({ ...f, proximity: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={submitActivity}
                      disabled={!actForm.name.trim()}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingActivity(false);
                        setActForm({
                          time: "",
                          name: "",
                          description: "",
                          proximity: "",
                          tip: "",
                        });
                      }}
                    >
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
    setList((l) =>
      l.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)),
    );
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
        qc.invalidateQueries({
          queryKey: getListTripPhotosQueryKey(tripId, photoType),
        });
        toast.success(
          `${photoType === "magnet" ? "Magnet" : "Photo"} uploaded`,
        );
      },
      onError: () => toast.error("Upload failed"),
    },
  });
  const deletePhoto = useDeleteTripPhoto({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({
          queryKey: getListTripPhotosQueryKey(tripId, photoType),
        });
        qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
        toast.success("Deleted");
      },
      onError: () => toast.error("Failed to delete"),
    },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<TripPhoto | null>(null);
  const [bulkUploading, setBulkUploading] = useState<{
    done: number;
    total: number;
  } | null>(null);

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
      setBulkUploading((prev) =>
        prev ? { ...prev, done: prev.done + 1 } : prev,
      );
    }
    setBulkUploading(null);
    if (failures > 0) {
      toast.error(`${failures} of ${files.length} uploads failed`);
    } else {
      toast.success(
        `${files.length} ${photoType === "magnet" ? "magnets" : "photos"} uploaded`,
      );
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
          {icon}
          {title}
          {photos.length > 0 && (
            <span className="text-sm font-sans font-normal text-muted-foreground">
              ({photos.length})
            </span>
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
            <div
              key={i}
              className="aspect-square rounded-lg bg-muted animate-pulse"
            />
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
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePhoto.mutate({ tripId, photoId: photo.id });
                  }}
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
                    title={
                      isIcon ? "Current cover photo" : "Set as cover photo"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetIcon(photo.id);
                    }}
                  >
                    <Star
                      className={`w-3 h-3 ${isIcon ? "fill-current" : ""}`}
                    />
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
      <Dialog
        open={!!lightbox}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          {lightbox && (
            <>
              <img
                src={getTripPhotoImageUrl(tripId, lightbox.id)}
                alt={lightbox.caption ?? title}
                className="w-full rounded-lg max-h-[70vh] object-contain"
              />
              {lightbox.caption && (
                <p className="text-sm text-muted-foreground text-center">
                  {lightbox.caption}
                </p>
              )}
              {onSetIcon && (
                <Button
                  size="sm"
                  variant={
                    iconPhotoId === lightbox.id ? "secondary" : "outline"
                  }
                  disabled={settingIcon || iconPhotoId === lightbox.id}
                  onClick={() => onSetIcon(lightbox.id)}
                >
                  <Star
                    className={`w-3.5 h-3.5 mr-1.5 ${iconPhotoId === lightbox.id ? "fill-current" : ""}`}
                  />
                  {iconPhotoId === lightbox.id
                    ? "Current cover photo"
                    : "Set as cover photo"}
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
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: getListRemindersQueryKey(tripId) }),
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
  const [newAlertDays, setNewAlertDays] = useState<number[]>([0]);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const { data: calendarStatus } = useGetCalendarStatus();
  const travelCalendarConnected = !!calendarStatus?.connected;
  const ALERT_DAY_OPTIONS = [0, 1, 3, 7];

  function toggleNewAlertDay(day: number) {
    setNewAlertDays((prev) => {
      const next = prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day];
      return next.length > 0 ? next : [0];
    });
  }

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
    if (!newRecipients.includes(email))
      setNewRecipients((prev) => [...prev, email]);
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((v) => !v)}
        >
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
              <Label className="text-xs text-muted-foreground">
                Send alerts to
              </Label>
              {appUsers.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {appUsers.map((u: TravelsAppUser) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-1.5 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={newRecipients.includes(u.email)}
                        onCheckedChange={() => toggleRecipient(u.email)}
                      />
                      {u.displayName ? (
                        <span>
                          {u.displayName}{" "}
                          <span className="text-muted-foreground">
                            ({u.email})
                          </span>
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
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomEmail();
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={addCustomEmail}
                >
                  Add
                </Button>
              </div>

              {newRecipients.filter(
                (e) => !appUsers.some((u: TravelsAppUser) => u.email === e),
              ).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {newRecipients
                    .filter(
                      (e) =>
                        !appUsers.some((u: TravelsAppUser) => u.email === e),
                    )
                    .map((email) => (
                      <Badge key={email} variant="secondary" className="gap-1">
                        {email}
                        <button
                          type="button"
                          onClick={() => toggleRecipient(email)}
                          aria-label={`Remove ${email}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                </div>
              )}
            </div>

            {travelCalendarConnected && (
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={newSync}
                    onCheckedChange={(v) => setNewSync(!!v)}
                  />
                  Add to the Travel Calendar
                </label>
                {newSync && (
                  <div className="pl-6 flex flex-wrap gap-1.5">
                    {ALERT_DAY_OPTIONS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleNewAlertDay(day)}
                        className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                          newAlertDays.includes(day)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-card-border hover:border-primary/50"
                        }`}
                      >
                        {day === 0
                          ? "On the day"
                          : `${day} day${day > 1 ? "s" : ""} before`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                      alertDaysBefore: newAlertDays,
                    },
                  });
                }}
                disabled={!newTitle.trim() || createReminder.isPending}
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
          ))}
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
              onToggle={() =>
                updateReminder.mutate({
                  tripId,
                  reminderId: r.id,
                  body: { done: true },
                })
              }
              onEdit={() => setEditingReminder(r)}
              onDelete={() =>
                deleteReminder.mutate({ tripId, reminderId: r.id })
              }
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
                    onToggle={() =>
                      updateReminder.mutate({
                        tripId,
                        reminderId: r.id,
                        body: { done: false },
                      })
                    }
                    onEdit={() => setEditingReminder(r)}
                    onDelete={() =>
                      deleteReminder.mutate({ tripId, reminderId: r.id })
                    }
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
        onOpenChange={(open) => {
          if (!open) setEditingReminder(null);
        }}
        initialMode="edit"
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
  const overdue =
    !reminder.done &&
    reminder.dueDate &&
    new Date(reminder.dueDate) < new Date();
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${reminder.done ? "bg-muted/30 border-border/30" : "bg-card border-border/50"}`}
    >
      <button
        onClick={onToggle}
        className="shrink-0"
        title={reminder.done ? "Mark as not done" : "Mark as done"}
      >
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
          title="Synced to the Travel Calendar"
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
        <span
          className={`text-xs shrink-0 ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}
        >
          {overdue ? "Overdue · " : ""}
          {new Date(reminder.dueDate).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      )}
      {reminder.dueDate && (
        <a
          href={buildReminderCalendarUrl(
            reminder.title,
            reminder.dueDate,
            "Trip reminder",
          )}
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
  const { data: reminders = [] } = useListReminders(id);
  const updateTrip = useUpdateTrip();
  const { data: cardLayout } = useGetCardLayout();
  const updateCardLayout = useUpdateCardLayout();
  const { data: tripCardCollapse } = useGetTripCardCollapse(id);
  const updateTripCardCollapse = useUpdateTripCardCollapse();
  const [cardOrder, setCardOrder] = useState<string[]>([...DEFAULT_CARD_ORDER]);
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set());
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    setCardOrder(mergeCardOrder(cardLayout?.cardOrder));
  }, [cardLayout]);

  useEffect(() => {
    setCollapsedCards(new Set(tripCardCollapse?.collapsedCards ?? []));
  }, [tripCardCollapse]);

  const handleCardDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCardOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      updateCardLayout.mutate({ cardOrder: next });
      return next;
    });
  };

  const toggleCardCollapse = (cardId: string) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      updateTripCardCollapse.mutate({ tripId: id, collapsedCards: [...next] });
      return next;
    });
  };
  const setTripIcon = useSetTripIcon();
  const deleteTrip = useDeleteTrip();
  const generateItinerary = useGenerateItinerary();
  const deleteTripDocument = useDeleteTripDocument();
  const { data: allHighlights = [] } = useGetHighlights();

  const { data: travelCalendarStatus } = useGetTravelCalendarStatus();
  const { data: connectedCalendars = [] } = useListConnectedCalendars();
  const createTravelCalendarEvent = useCreateTravelCalendarEvent();
  const createConnectedCalendarEvent = useCreateConnectedCalendarEvent();

  function tripCalendarEventBody() {
    return {
      title: trip!.title,
      description: trip!.notes ?? undefined,
      location: trip!.destination,
      allDay: true,
      start: trip!.startDate!,
      end: trip!.endDate ?? trip!.startDate!,
    };
  }

  function addTripToTravelCalendar() {
    createTravelCalendarEvent.mutate(tripCalendarEventBody(), {
      onSuccess: () => toast.success("Added to Travel calendar"),
      onError: () => toast.error("Couldn't add to Travel calendar"),
    });
  }

  function addTripToConnectedCalendar(calendarId: number, summary: string) {
    createConnectedCalendarEvent.mutate(
      { id: calendarId, body: tripCalendarEventBody() },
      {
        onSuccess: () => toast.success(`Added to ${summary}`),
        onError: () => toast.error(`Couldn't add to ${summary}`),
      },
    );
  }

  const [compactDocs, setCompactDocs] = useState<boolean>(() => {
    try {
      return localStorage.getItem("travels-compact-docs") === "1";
    } catch {
      return false;
    }
  });
  const toggleCompactDocs = () => {
    setCompactDocs((v) => {
      const next = !v;
      try {
        localStorage.setItem("travels-compact-docs", next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingTitle, setPendingTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itinStyle, setItinStyle] = useState<"relaxed" | "balanced" | "packed">(
    "balanced",
  );
  const [itinInterests, setItinInterests] = useState<string[]>([
    "food",
    "history",
    "culture",
  ]);
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

  const saveField = (
    body: Partial<UpdateTripBody>,
    successMsg = "Trip updated",
  ) => {
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

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const defaultTitle = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
    setPendingFile(file);
    setPendingTitle(defaultTitle);
  };

  const handleUploadConfirm = async () => {
    if (!pendingFile) return;
    setUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      if (pendingTitle.trim()) {
        formData.append("title", pendingTitle.trim());
      }
      const res = await fetch(`/api/travels/trips/${id}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      invalidate();
      toast.success("Document uploaded");
      setPendingFile(null);
    } catch {
      toast.error("Failed to upload document");
    } finally {
      setUploadingDoc(false);
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
      {
        id,
        body: {
          style: itinStyle,
          interests: itinInterests,
          regenerateDay: dayIndex,
        },
      },
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
        onSuccess: () => {
          invalidate();
          toast.success("Itinerary saved");
          setItineraryDirty(false);
        },
        onError: () => toast.error("Failed to save itinerary"),
      },
    );
  };

  const handleAddDay = () => {
    if (!dayForm.title.trim()) return;
    const newDay: ItineraryDay = {
      date: dayForm.date,
      title: dayForm.title.trim(),
      activities: [],
    };
    setLocalItinerary((prev) => ({ days: [...(prev?.days ?? []), newDay] }));
    setDayForm({ date: "", title: "" });
    setAddingDay(false);
    setItineraryDirty(true);
  };

  const handleDeleteDay = (dayIndex: number) => {
    setLocalItinerary((prev) =>
      prev ? { days: prev.days.filter((_, i) => i !== dayIndex) } : prev,
    );
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
        i === dayIndex
          ? {
              ...d,
              activities: d.activities.filter((_, ai) => ai !== activityIndex),
            }
          : d,
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
        onSuccess: () => {
          invalidate();
          toast.success("Marked as firm");
        },
        onError: () => toast.error("Failed to update activity"),
      },
    );
  };

  const toggleInterest = (interest: string) => {
    setItinInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest],
    );
  };

  const todoList = (trip?.todoList ?? []) as TodoItem[];
  const documents = trip?.documents ?? [];

  const DOCUMENT_FIELD_LABELS: Array<[string, string]> = [
    ["providerName", "provider"],
    ["referenceNumber", "reference/confirmation number"],
    ["passengerNames", "passengers"],
    ["departureDateTime", "departure"],
    ["arrivalDateTime", "arrival"],
    ["flightNumber", "flight number"],
    ["checkInDate", "check-in"],
    ["checkOutDate", "check-out"],
    ["hotelName", "hotel"],
    ["pickupDateTime", "pickup"],
    ["dropoffDateTime", "dropoff"],
    ["returnFlightNumber", "return flight number"],
    ["returnDepartureDateTime", "return departure"],
    ["returnArrivalDateTime", "return arrival"],
    ["notes", "notes"],
  ];

  const documentsSummary = documents
    .slice(0, 30)
    .map((doc) => {
      const ed = (doc.extractedData ?? null) as Record<string, unknown> | null;
      const fields = DOCUMENT_FIELD_LABELS.map(([key, label]) => {
        const value = ed?.[key];
        if (value === null || value === undefined || value === "") return null;
        const rendered = Array.isArray(value)
          ? value.join(", ")
          : String(value);
        return `${label}: ${rendered}`;
      }).filter((entry): entry is string => entry !== null);
      const type = doc.documentType
        ? doc.documentType.replace(/_/g, " ")
        : "document";
      const name = doc.originalFilename ? ` ("${doc.originalFilename}")` : "";
      return `- ${type}${name} [docId: ${doc.id}]${fields.length > 0 ? `: ${fields.join("; ")}` : " (no extracted data yet)"}`;
    })
    .join("\n");

  usePageAssistantContext(
    "trip-detail",
    !trip
      ? undefined
      : `Viewing trip "${trip.title}" to ${trip.destination} (tripId: ${trip.id}, status: ${trip.status}${
          trip.startDate ? `, starts ${trip.startDate}` : ""
        }${trip.endDate ? `, ends ${trip.endDate}` : ""}). ` +
          `To-do list has ${todoList.length} item(s). ` +
          (documents.length > 0
            ? `Documents attached to this trip (use these already-parsed fields to answer questions like confirmation numbers, hotel names, or flight/check-in times — never ask the user to re-upload or open the file):\n${documentsSummary}`
            : "No documents attached to this trip yet.") +
          "\n" +
          (reminders.length > 0
            ? `Reminders: ${reminders
                .slice(0, 20)
                .map(
                  (r) =>
                    `"${r.title}" (reminderId: ${r.id}${r.dueDate ? `, due ${r.dueDate}` : ", no due date"}, ${
                      r.done ? "done" : "not done"
                    }, ${r.syncToCalendar ? "synced to calendar" : "NOT synced to calendar"}, recipients: ${
                      r.recipientEmails && r.recipientEmails.length > 0
                        ? r.recipientEmails.join(", ")
                        : "none"
                    })`,
                )
                .join("; ")}.`
            : "No reminders yet for this trip.") +
          "\n" +
          (localItinerary?.days && localItinerary.days.length > 0
            ? `Itinerary has ${localItinerary.days.length} day(s) (use these 1-based day/activity numbers exactly for confirm_itinerary_activity / remove_itinerary_activity — never guess them):\n${localItinerary.days
                .slice(0, 20)
                .map((d, i) => {
                  const activitiesSummary =
                    d.activities.length > 0
                      ? d.activities
                          .slice(0, 20)
                          .map((a, ai) => {
                            const status =
                              a.status === "confirmed"
                                ? "confirmed"
                                : "tentative";
                            const sourced = a.sourceDocumentId
                              ? ", from document"
                              : "";
                            return `activity ${ai + 1}: "${a.name}"${a.time ? ` at ${a.time}` : ""} (${status}${sourced})`;
                          })
                          .join("; ")
                      : "no activities yet";
                  return `Day ${i + 1}${d.date ? ` (${d.date})` : ""}: "${d.title}" — ${activitiesSummary}`;
                })
                .join("\n")}`
            : "No itinerary generated yet for this trip.") +
          (addingDay
            ? ` User is currently adding a new itinerary day with title "${dayForm.title}" on ${dayForm.date}.`
            : ""),
  );

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
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => setLocation("/trips")}
        >
          Back to trips
        </Button>
      </div>
    );
  }

  const canCalendar =
    (trip.status === "booked" || trip.status === "active") && trip.startDate;

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
              renderDisplay={(v) => (
                <h1 className="font-serif text-2xl text-foreground">{v}</h1>
              )}
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
                <Select
                  value={draft}
                  onValueChange={(v) => setDraft(v as TripStatus)}
                >
                  <SelectTrigger className="h-8 w-36">
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
        <div className="flex items-center gap-2 shrink-0">
          {canCalendar && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Calendar className="w-4 h-4" />
                  Add to Calendar
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {travelCalendarStatus?.configured && (
                  <DropdownMenuItem onClick={addTripToTravelCalendar}>
                    <CalendarCheck className="w-4 h-4 mr-2" />
                    Add to Travel calendar
                  </DropdownMenuItem>
                )}
                {connectedCalendars.length > 0 && (
                  <>
                    {travelCalendarStatus?.configured && (
                      <DropdownMenuSeparator />
                    )}
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      My calendars
                    </DropdownMenuLabel>
                    {connectedCalendars.map((cal) => (
                      <DropdownMenuItem
                        key={cal.id}
                        onClick={() =>
                          addTripToConnectedCalendar(cal.id, cal.summary)
                        }
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full mr-2 shrink-0"
                          style={{ backgroundColor: cal.primaryColor }}
                        />
                        {cal.summary}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
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
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open in Google Calendar
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
                {(["John", "Ashley", "Karis", "Angela"] as const).map(
                  (name) => {
                    const checked = draft.includes(name);
                    return (
                      <label
                        key={name}
                        className="flex items-center gap-2 cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          className="w-4 h-4 rounded border-border accent-primary"
                          onChange={(e) =>
                            setDraft(
                              e.target.checked
                                ? [...draft, name]
                                : draft.filter((n) => n !== name),
                            )
                          }
                        />
                        <span className="text-sm">{name}</span>
                      </label>
                    );
                  },
                )}
              </div>
            )}
          />

          <InlineField
            label="Getting there"
            value={trip.transportTo ?? "none"}
            iconType="custom"
            onSave={(v: TransportTo | "none") =>
              saveField({
                transportTo: v === "none" ? undefined : (v as TransportTo),
              })
            }
            isEmpty={(v: TransportTo | "none") => v === "none"}
            renderDisplay={(v) => (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground shrink-0">
                  <TransportIcon transport={v as TransportTo} />
                </span>
                <p className="text-sm text-foreground capitalize">
                  {v === "flew"
                    ? "Flying"
                    : v === "train"
                      ? "Train"
                      : "Driving"}
                  {trip.hasRentalCar ? " + rental car" : ""}
                </p>
              </div>
            )}
            renderEditor={(draft, setDraft) => (
              <Select
                value={draft}
                onValueChange={(v) => setDraft(v as TransportTo | "none")}
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
            )}
          />

          {trip.transportTo && trip.transportTo !== "drove" && (
            <InlineTextField
              label={
                trip.transportTo === "flew"
                  ? "Airline & flight number"
                  : "Train line & train number"
              }
              value={trip.transportDetails ?? ""}
              placeholder={
                trip.transportTo === "flew"
                  ? "e.g. Delta DL 405"
                  : "e.g. Eurostar 9025"
              }
              onSave={(v) => saveField({ transportDetails: v || undefined })}
            />
          )}

          <InlineField
            label="Rental car?"
            value={trip.hasRentalCar}
            iconType="custom"
            onSave={(v) => saveField({ hasRentalCar: v })}
            isEmpty={() => false}
            renderDisplay={(v) => (
              <p className="text-sm text-foreground">{v ? "Yes" : "No"}</p>
            )}
            renderEditor={(draft, setDraft) => (
              <Select
                value={draft ? "yes" : "no"}
                onValueChange={(v) => setDraft(v === "yes")}
              >
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

      {/* Reorderable / collapsible cards — order and collapse state are per-user */}
      <DndContext
        sensors={dragSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleCardDragEnd}
      >
        <SortableContext
          items={cardOrder}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-6">
            {cardOrder.map((cardId) => (
              <SortableSection key={cardId} id={cardId}>
                {({ dragHandleListeners, dragHandleAttributes }) => {
                  switch (cardId) {
                    case "weather-nearby":
                      return trip.lat != null && trip.lng != null ? (
                        <CardShell
                          title="Weather & nearby"
                          icon={<Cloud className="w-5 h-5" />}
                          collapsed={collapsedCards.has("weather-nearby")}
                          onToggleCollapse={() =>
                            toggleCardCollapse("weather-nearby")
                          }
                          dragHandleListeners={dragHandleListeners}
                          dragHandleAttributes={dragHandleAttributes}
                        >
                          <TripWeatherAndPlaces
                            tripId={trip.id}
                            lat={trip.lat}
                            lng={trip.lng}
                          />
                        </CardShell>
                      ) : null;

                    case "photos":
                      return (
                        <CardShell
                          title="Photos"
                          icon={<Camera className="w-5 h-5" />}
                          collapsed={collapsedCards.has("photos")}
                          onToggleCollapse={() => toggleCardCollapse("photos")}
                          dragHandleListeners={dragHandleListeners}
                          dragHandleAttributes={dragHandleAttributes}
                        >
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
                                    qc.invalidateQueries({
                                      queryKey: getGetTripQueryKey(trip.id),
                                    });
                                    toast.success("Trip cover photo updated");
                                  },
                                  onError: () =>
                                    toast.error(
                                      "Failed to set trip cover photo",
                                    ),
                                },
                              )
                            }
                          />
                        </CardShell>
                      );

                    case "magnets":
                      return (
                        <CardShell
                          title="Magnets"
                          icon={<Magnet className="w-5 h-5" />}
                          collapsed={collapsedCards.has("magnets")}
                          onToggleCollapse={() => toggleCardCollapse("magnets")}
                          dragHandleListeners={dragHandleListeners}
                          dragHandleAttributes={dragHandleAttributes}
                        >
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
                                    qc.invalidateQueries({
                                      queryKey: getGetTripQueryKey(trip.id),
                                    });
                                    toast.success("Trip cover photo updated");
                                  },
                                  onError: () =>
                                    toast.error(
                                      "Failed to set trip cover photo",
                                    ),
                                },
                              )
                            }
                          />
                        </CardShell>
                      );

                    case "reminders":
                      return (
                        <CardShell
                          title="Reminders"
                          icon={<Bell className="w-5 h-5" />}
                          collapsed={collapsedCards.has("reminders")}
                          onToggleCollapse={() =>
                            toggleCardCollapse("reminders")
                          }
                          dragHandleListeners={dragHandleListeners}
                          dragHandleAttributes={dragHandleAttributes}
                        >
                          <RemindersSection tripId={trip.id} />
                        </CardShell>
                      );

                    case "itinerary":
                      return (
                        <CardShell
                          title="Itinerary"
                          collapsed={collapsedCards.has("itinerary")}
                          onToggleCollapse={() =>
                            toggleCardCollapse("itinerary")
                          }
                          dragHandleListeners={dragHandleListeners}
                          dragHandleAttributes={dragHandleAttributes}
                        >
                          <div className="space-y-4">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
                                <CalendarCheck className="w-5 h-5" />
                                Itinerary
                              </h2>
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
                                    <RefreshCw
                                      className={`w-4 h-4 mr-1.5 ${generateItinerary.isPending ? "animate-spin" : ""}`}
                                    />
                                    AI regenerate
                                  </Button>
                                )}
                                {localItinerary && (
                                  <ItineraryShareExportButtons
                                    tripId={id}
                                    shareToken={trip.shareToken ?? null}
                                  />
                                )}
                              </div>
                            </div>

                            {/* Days list */}
                            {localItinerary?.days &&
                              localItinerary.days.length > 0 && (
                                <div className="space-y-2">
                                  {(() => {
                                    const validDates = localItinerary.days
                                      .map((d) => d.date)
                                      .filter((d): d is string => !!d)
                                      .sort();
                                    const earliestDate = validDates[0];
                                    return localItinerary.days.map((day, i) => {
                                      const dayNumber =
                                        day.date && earliestDate
                                          ? Math.round(
                                              (new Date(
                                                `${day.date}T12:00:00`,
                                              ).getTime() -
                                                new Date(
                                                  `${earliestDate}T12:00:00`,
                                                ).getTime()) /
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
                                          onAddActivity={(act) =>
                                            handleAddActivity(i, act)
                                          }
                                          onDeleteActivity={(ai) =>
                                            handleDeleteActivity(i, ai)
                                          }
                                          onDeleteDay={() => handleDeleteDay(i)}
                                          onConfirmActivity={(ai) =>
                                            handleConfirmActivity(i, ai)
                                          }
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
                                  <p className="text-sm font-medium text-foreground">
                                    New day
                                  </p>
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                      <Label>Title *</Label>
                                      <Input
                                        placeholder="e.g. Arrival & Old Town"
                                        value={dayForm.title}
                                        onChange={(e) =>
                                          setDayForm((f) => ({
                                            ...f,
                                            title: e.target.value,
                                          }))
                                        }
                                        onKeyDown={(e) =>
                                          e.key === "Enter" && handleAddDay()
                                        }
                                        autoFocus
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Date (optional)</Label>
                                      <Input
                                        type="date"
                                        value={dayForm.date}
                                        onChange={(e) =>
                                          setDayForm((f) => ({
                                            ...f,
                                            date: e.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      onClick={handleAddDay}
                                      disabled={!dayForm.title.trim()}
                                    >
                                      <Plus className="w-3.5 h-3.5 mr-1" />
                                      Add day
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setAddingDay(false);
                                        setDayForm({ date: "", title: "" });
                                      }}
                                    >
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
                                    Generate a day-by-day itinerary with AI, or
                                    add days manually with the button above.
                                  </p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                      <Label>Trip style</Label>
                                      <Select
                                        value={itinStyle}
                                        onValueChange={(v) =>
                                          setItinStyle(v as typeof itinStyle)
                                        }
                                      >
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="relaxed">
                                            Relaxed — slow, few activities
                                          </SelectItem>
                                          <SelectItem value="balanced">
                                            Balanced — good mix
                                          </SelectItem>
                                          <SelectItem value="packed">
                                            Packed — see everything
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Interests</Label>
                                      <div className="flex flex-wrap gap-1.5">
                                        {INTERESTS_OPTIONS.map((interest) => (
                                          <button
                                            key={interest}
                                            onClick={() =>
                                              toggleInterest(interest)
                                            }
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
                                    <Sparkles
                                      className={`w-4 h-4 mr-2 ${generateItinerary.isPending ? "animate-pulse" : ""}`}
                                    />
                                    {generateItinerary.isPending
                                      ? "Building your itinerary..."
                                      : "Generate itinerary"}
                                  </Button>
                                </CardContent>
                              </Card>
                            )}

                            {/* Style/interests controls when AI-generated itinerary exists but user wants to regenerate */}
                            {localItinerary &&
                              !addingDay &&
                              generateItinerary.isPending && (
                                <div className="text-sm text-muted-foreground flex items-center gap-2">
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  Building your itinerary…
                                </div>
                              )}
                          </div>
                        </CardShell>
                      );

                    case "documents":
                      return (
                        <CardShell
                          title="Documents"
                          collapsed={collapsedCards.has("documents")}
                          onToggleCollapse={() =>
                            toggleCardCollapse("documents")
                          }
                          dragHandleListeners={dragHandleListeners}
                          dragHandleAttributes={dragHandleAttributes}
                        >
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
                                <FileText className="w-5 h-5" />
                                Documents
                                {documents.length > 0 && (
                                  <span className="font-sans text-xs font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {documents.length}
                                  </span>
                                )}
                              </h2>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={toggleCompactDocs}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                                    compactDocs
                                      ? "border-primary/40 bg-primary/5 text-primary"
                                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                                  }`}
                                  title={
                                    compactDocs
                                      ? "Compact mode on — click to show all details"
                                      : "Click to compact (hide field details)"
                                  }
                                >
                                  <Rows2 className="w-4 h-4" />
                                </button>
                                <label className="cursor-pointer">
                                  <input
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                                    onChange={handleFilePicked}
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

                              {pendingFile && (
                                <Dialog
                                  open
                                  onOpenChange={(open) => {
                                    if (!open && !uploadingDoc)
                                      setPendingFile(null);
                                  }}
                                >
                                  <DialogContent className="max-w-sm">
                                    <DialogHeader>
                                      <DialogTitle>
                                        Name this document
                                      </DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-3 py-1">
                                      <div className="space-y-1.5">
                                        <Label htmlFor="doc-title-input">
                                          Title
                                        </Label>
                                        <Input
                                          id="doc-title-input"
                                          value={pendingTitle}
                                          onChange={(e) =>
                                            setPendingTitle(e.target.value)
                                          }
                                          placeholder="e.g. BA417 London → Rome · 15 Jul"
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              handleUploadConfirm();
                                          }}
                                          autoFocus
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                          {pendingFile.name} · Leave blank and
                                          AI will suggest one.
                                        </p>
                                      </div>
                                    </div>
                                    <DialogFooter>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPendingFile(null)}
                                        disabled={uploadingDoc}
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={handleUploadConfirm}
                                        disabled={uploadingDoc}
                                      >
                                        {uploadingDoc ? "Uploading…" : "Upload"}
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                              )}
                            </div>

                            <Card className="border-border/50">
                              <CardContent className="py-2">
                                {documents.length === 0 ? (
                                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                                    <FileText className="w-8 h-8 text-muted-foreground/40" />
                                    <p className="text-sm text-muted-foreground">
                                      No documents yet. Upload bookings,
                                      boarding passes, or confirmations.
                                    </p>
                                  </div>
                                ) : (
                                  documents.map((doc) => (
                                    <DocumentRow
                                      key={doc.id}
                                      doc={doc}
                                      tripId={id}
                                      onDelete={handleDeleteDocument}
                                      compact={compactDocs}
                                    />
                                  ))
                                )}
                              </CardContent>
                            </Card>
                          </div>
                        </CardShell>
                      );

                    case "packing-todo":
                      return (
                        <div className="relative">
                          <DragHandle
                            listeners={dragHandleListeners}
                            attributes={dragHandleAttributes}
                            className="absolute -top-2 -left-2 z-10 bg-card border border-border/50 rounded-full shadow-sm"
                          />
                          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 pt-2">
                            <CardShell
                              title="Packing List"
                              collapsed={collapsedCards.has("packing")}
                              onToggleCollapse={() =>
                                toggleCardCollapse("packing")
                              }
                            >
                              <div className="space-y-4">
                                <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
                                  <Briefcase className="w-5 h-5" />
                                  Packing List
                                </h2>
                                <Card className="border-border/50">
                                  <CardContent className="py-4">
                                    <PackingSection tripId={id} />
                                  </CardContent>
                                </Card>
                              </div>
                            </CardShell>

                            <CardShell
                              title="To-Do List"
                              collapsed={collapsedCards.has("todo")}
                              onToggleCollapse={() =>
                                toggleCardCollapse("todo")
                              }
                            >
                              <div className="space-y-4">
                                <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
                                  <CheckSquare className="w-5 h-5" />
                                  To-Do List
                                </h2>
                                <Card className="border-border/50">
                                  <CardContent className="py-4">
                                    <TodoList
                                      items={todoList}
                                      onSave={handleSaveTodoList}
                                    />
                                  </CardContent>
                                </Card>
                              </div>
                            </CardShell>
                          </div>
                        </div>
                      );

                    default:
                      return null;
                  }
                }}
              </SortableSection>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Delete confirm dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete trip?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            This will permanently delete "{trip.title}" and all its documents,
            photos, and reminders. This cannot be undone.
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
