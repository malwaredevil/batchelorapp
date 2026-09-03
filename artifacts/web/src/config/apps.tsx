import { crossAppBase } from "@/lib/cross-app";
import {
  Wind,
  Package,
  Shirt,
  ShoppingBag,
  FlaskConical,
  Scissors,
  Layers,
  Zap,
  Camera,
  FileText,
  Star,
  BookOpen,
  Rss,
  Globe,
  Plane,
  Bell,
  MapPin,
  Magnet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  StudioWeather,
  PotteryStatsWidget,
  QuiltingStatsWidget,
  ShoppingListWidget,
  RandomPieceWidget,
  FabricStashWidget,
  BlockDesignerWidget,
  LayoutsWidget,
  QuickAddWidget,
  AiSearchWidget,
  NotesWidget,
  GlazeTipWidget,
  PatternIdeaWidget,
  InspirationWidget,
  TravelStatsWidget,
  NextTripWidget,
  TripRemindersWidget,
  TravelWishlistWidget,
  MagnetsStatsWidget,
} from "@/components/widgets";

const base = crossAppBase();

export type AppStat = { value: string; label: string };

export type AppEntry = {
  id: string;
  name: string;
  href: string;
  image: string;
  updated: string;
  stats: AppStat[];
  description: string;
  /** Footer CTA label. Defaults to "Open collection" if omitted. */
  cta?: string;
};

export type WidgetCategory = "collections" | "tools" | "media" | "inspiration";

export type WidgetEntry = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: WidgetCategory;
  /** Static body to render. Omit for multi-instance widgets (e.g. RSS). */
  body?: ReactNode;
  /**
   * When true, the widget can be added multiple times with independent configs.
   * Adding one from the library always creates a new instance — it is never
   * "already added".
   */
  multi?: boolean;
};

/* Modular config: apps render from this array. */
export const APPS: AppEntry[] = [
  {
    id: "pottery",
    name: "Pottery",
    href: `${base}modules/pottery/`,
    image: `${base}images/pottery-collection.png`,
    updated: "Your ceramics collection",
    stats: [
      { value: "163", label: "Pieces" },
      { value: "12", label: "Categories" },
    ],
    description:
      "Your complete catalogue of handmade ceramics. AI semantic search and photo comparison.",
  },
  {
    id: "quilting",
    name: "Quilting",
    href: `${base}modules/quilting/`,
    image: `${base}images/quilting-collection.png`,
    updated: "Your fabric & quilt stash",
    stats: [
      { value: "48", label: "Fabrics" },
      { value: "9", label: "Patterns" },
      { value: "5", label: "Quilts" },
    ],
    description:
      "Manage your fabric stash, organize patterns, plan layouts, and track finished projects.",
  },
  {
    id: "travels",
    name: "Travels",
    href: `${base}modules/travels/`,
    image: `${base}images/travels-collection.png`,
    updated: "Plan your next trip",
    stats: [],
    description:
      "Plan trips, build AI itineraries, explore destinations, and keep a travel journal.",
    cta: "Open Travels",
  },
  {
    id: "ornaments",
    name: "Ornaments",
    href: `${base}modules/ornaments/`,
    image: `${base}images/ornaments-collection.png`,
    updated: "Your Hallmark ornament collection",
    stats: [
      { value: "0", label: "Total" },
      { value: "0", label: "Quantity" },
      { value: "$0", label: "Book Value" },
    ],
    description:
      "Your Hallmark ornament collection — track series, quantities, and book value.",
  },
  {
    id: "office",
    name: "Office",
    href: `${base}modules/office/`,
    image: `${base}images/office-collection.png`,
    updated: "General household hub",
    stats: [
      { value: "—", label: "Notes" },
      { value: "—", label: "Unread" },
      { value: "—", label: "Upcoming" },
    ],
    description:
      "Gmail inbox, all connected calendars, and notes — general-purpose, separate from Travels' trip-specific Gmail and calendar features.",
    cta: "Open Office",
  },
  {
    id: "elaine",
    name: "Elaine",
    href: `${base}elaine/`,
    image: `${base}images/elaine-collection.png`,
    updated: "Your AI assistant",
    stats: [],
    description:
      "Chat with your household's AI assistant — full context on pottery, quilting, and travels, with viewable, editable settings.",
    cta: "Chat with Elaine",
  },
  // scaffold:anchor:hub-cards — scaffold-collection-module inserts hub card stubs below; do not remove
  // scaffold:begin:magnets
  {
    id: "magnets",
    name: "Magnets",
    href: `${base}modules/magnets/`,
    image: `${base}images/magnets-collection.svg`,
    updated: "Your magnet collection",
    stats: [
      { value: "—", label: "Magnets" },
      { value: "—", label: "Categories" },
    ],
    description:
      "Track your fridge magnet collection — add photos, organize by category, and browse your full collection with AI analysis.",
    cta: "Open collection",
  },
  // scaffold:end:magnets
];

/* ── Widget catalogue ──────────────────────────────────────────────────────── *
 * Add new widgets here. The dashboard picks them up automatically.
 * Default-enabled IDs are controlled separately in use-widgets.ts.
 * ─────────────────────────────────────────────────────────────────────────── */
export const WIDGETS: WidgetEntry[] = [
  // ── Collections ────────────────────────────────────────────────────────────
  {
    id: "pottery-stats",
    title: "Pottery Stats",
    description:
      "Live piece counts, unique items, and category breakdown from your pottery collection.",
    icon: Package,
    category: "collections",
    body: <PotteryStatsWidget />,
  },
  {
    id: "quilting-stats",
    title: "Quilting Stats",
    description:
      "Fabrics, blocks, and layouts at a glance — live from your quilting collection.",
    icon: Shirt,
    category: "collections",
    body: <QuiltingStatsWidget />,
  },
  {
    id: "shopping-list",
    title: "Shopping List",
    description:
      "Top wanted and ordered items from your quilting shopping list.",
    icon: ShoppingBag,
    category: "collections",
    body: <ShoppingListWidget />,
  },

  {
    id: "magnets-stats",
    title: "Magnets Stats",
    description:
      "Live magnet count and category breakdown from your magnets collection.",
    icon: Magnet,
    category: "collections",
    body: <MagnetsStatsWidget />,
  },

  // ── Travels ────────────────────────────────────────────────────────────────
  {
    id: "travel-stats",
    title: "Travel Stats",
    description:
      "Live counts of trips, destinations, completed and upcoming — straight from your travels.",
    icon: Globe,
    category: "collections",
    body: <TravelStatsWidget />,
  },
  {
    id: "next-trip",
    title: "Next Trip",
    description:
      "Your next upcoming trip with destination and a live day countdown.",
    icon: Plane,
    category: "collections",
    body: <NextTripWidget />,
  },
  {
    id: "trip-reminders",
    title: "Trip Reminders",
    description:
      "Upcoming pre-departure reminders across all your planned trips.",
    icon: Bell,
    category: "collections",
    body: <TripRemindersWidget />,
  },
  {
    id: "travel-wishlist",
    title: "Travel Wishlist",
    description: "Your top bucket-list destinations from the travel wishlist.",
    icon: MapPin,
    category: "collections",
    body: <TravelWishlistWidget />,
  },
  {
    id: "random-piece",
    title: "Random Piece",
    description: "A surprise item from your pottery collection each visit.",
    icon: Star,
    category: "collections",
    body: <RandomPieceWidget />,
  },
  {
    id: "fabric-stash",
    title: "Fabric Stash",
    description:
      "A quick count of your fabric stash with a direct link to browse or add.",
    icon: Shirt,
    category: "collections",
    body: <FabricStashWidget />,
  },
  {
    id: "blocks",
    title: "Block Designer",
    description:
      "How many blocks you've designed, with quick access to create a new one.",
    icon: Scissors,
    category: "collections",
    body: <BlockDesignerWidget />,
  },
  {
    id: "layouts",
    title: "Quilt Layouts",
    description:
      "Number of layouts planned, with a direct link to the layout composer.",
    icon: Layers,
    category: "collections",
    body: <LayoutsWidget />,
  },

  // ── Tools ──────────────────────────────────────────────────────────────────
  {
    id: "quick-add",
    title: "Quick Add",
    description:
      "One-tap buttons to add a pottery piece, fabric, block, or use the AI camera.",
    icon: Zap,
    category: "tools",
    body: <QuickAddWidget />,
  },
  {
    id: "ai-search",
    title: "AI Search",
    description:
      '"Do I own this?" — photo or text search across both your pottery and fabric collections.',
    icon: Camera,
    category: "tools",
    body: <AiSearchWidget />,
  },
  {
    id: "notes",
    title: "Sticky Notes",
    description:
      "A small scratchpad — jot ideas, reminders, or glaze recipes on the hub. Saved locally.",
    icon: FileText,
    category: "tools",
    body: <NotesWidget />,
  },

  // ── Media ──────────────────────────────────────────────────────────────────
  {
    id: "weather",
    title: "Local Weather",
    description:
      "Current conditions at your studio location — useful for kiln and drying decisions.",
    icon: Wind,
    category: "media",
    body: <StudioWeather />,
  },
  {
    id: "rss-feed",
    title: "RSS Feed",
    description:
      "Pull in any RSS or Atom feed — pottery news, quilting blogs, technique tutorials. Add as many as you like, each with its own title.",
    icon: Rss,
    category: "media",
    multi: true,
    // body is omitted — each instance is rendered from RssSlot config in AppLauncher
  },

  // ── Inspiration ────────────────────────────────────────────────────────────
  {
    id: "glaze-tip",
    title: "Glaze Tip",
    description:
      "A rotating ceramic technique tip from a curated offline library — something new each visit.",
    icon: FlaskConical,
    category: "inspiration",
    body: <GlazeTipWidget />,
  },
  {
    id: "pattern-idea",
    title: "Pattern Idea",
    description:
      "A curated offline quilt pattern suggestion — with difficulty level and a link to try it.",
    icon: Scissors,
    category: "inspiration",
    body: <PatternIdeaWidget />,
  },
  {
    id: "inspiration",
    title: "Daily Inspiration",
    description:
      "A short rotating line from a curated offline library about pottery and quilting craft.",
    icon: BookOpen,
    category: "inspiration",
    body: <InspirationWidget />,
  },
];
