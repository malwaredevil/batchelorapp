import { useState } from "react";
import {
  Search,
  Plus,
  Check,
  X,
  Wind,
  Rss,
  Globe,
  ShoppingBag,
  Star,
  Activity,
  Package,
  Shirt,
  BarChart2,
  Clock,
  Calendar,
  BookOpen,
  Image,
  Music,
  Map,
  Camera,
  Hash,
  FileText,
  Youtube,
  Twitter,
  TrendingUp,
  Layers,
  Scissors,
  FlaskConical,
  Sparkles,
  Bell,
  Link,
  Thermometer,
  Cloud,
  Sun,
  DollarSign,
  Target,
  Zap,
  PenTool,
  Archive,
  Users,
} from "lucide-react";

type Category =
  | "all"
  | "collections"
  | "media"
  | "web"
  | "tools"
  | "inspiration";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All widgets" },
  { id: "collections", label: "Collections" },
  { id: "media", label: "Media & feeds" },
  { id: "web", label: "Web & links" },
  { id: "tools", label: "Tools" },
  { id: "inspiration", label: "Inspiration" },
];

type Widget = {
  id: string;
  label: string;
  desc: string;
  icon: any;
  iconBg: string;
  iconColor: string;
  category: Exclude<Category, "all">;
  added?: boolean;
  hasSettings?: boolean;
  isNew?: boolean;
};

const ALL_WIDGETS: Widget[] = [
  // Collections
  {
    id: "pottery-stats",
    label: "Pottery Stats",
    desc: "Item counts, categories, value estimates at a glance.",
    icon: Package,
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    category: "collections",
    added: true,
  },
  {
    id: "quilting-stats",
    label: "Quilting Stats",
    desc: "Fabrics, blocks, layouts, and shopping list summary.",
    icon: Shirt,
    iconBg: "bg-violet-100 dark:bg-violet-900/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    category: "collections",
    added: true,
  },
  {
    id: "random-piece",
    label: "Random Piece",
    desc: "A surprise item from your collection each visit.",
    icon: Star,
    iconBg: "bg-yellow-100 dark:bg-yellow-900/40",
    iconColor: "text-yellow-600 dark:text-yellow-400",
    category: "collections",
    hasSettings: true,
  },
  {
    id: "shopping-list",
    label: "Shopping List",
    desc: "Top wanted and ordered items from your quilting list.",
    icon: ShoppingBag,
    iconBg: "bg-rose-100 dark:bg-rose-900/40",
    iconColor: "text-rose-600 dark:text-rose-400",
    category: "collections",
    added: true,
  },
  {
    id: "activity",
    label: "Recent Activity",
    desc: "Latest additions and edits across both apps.",
    icon: Activity,
    iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    category: "collections",
    added: true,
  },
  {
    id: "collection-value",
    label: "Collection Value",
    desc: "Estimated total value of your pottery pieces.",
    icon: DollarSign,
    iconBg: "bg-green-100 dark:bg-green-900/40",
    iconColor: "text-green-600 dark:text-green-400",
    category: "collections",
    isNew: true,
  },
  {
    id: "compare-tool",
    label: "Quick Compare",
    desc: "Side-by-side two pottery pieces without leaving the hub.",
    icon: Layers,
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    category: "collections",
    isNew: true,
  },
  {
    id: "maintenance-log",
    label: "Maintenance Log",
    desc: "Upcoming and recent care tasks for your ceramics.",
    icon: FlaskConical,
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    category: "collections",
  },
  {
    id: "block-preview",
    label: "Block Preview",
    desc: "Your latest quilting block rendered as a live diagram.",
    icon: Scissors,
    iconBg: "bg-violet-100 dark:bg-violet-900/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    category: "collections",
    isNew: true,
  },

  // Media & feeds
  {
    id: "rss",
    label: "RSS / News Feed",
    desc: "Any RSS or Atom feed — set your own URL.",
    icon: Rss,
    iconBg: "bg-orange-100 dark:bg-orange-900/40",
    iconColor: "text-orange-600 dark:text-orange-400",
    category: "media",
    hasSettings: true,
  },
  {
    id: "youtube",
    label: "YouTube Channel",
    desc: "Latest videos from a channel or playlist you follow.",
    icon: Youtube,
    iconBg: "bg-red-100 dark:bg-red-900/40",
    iconColor: "text-red-600 dark:text-red-400",
    category: "media",
    hasSettings: true,
  },
  {
    id: "podcast",
    label: "Podcast",
    desc: "Latest episode from any podcast RSS feed.",
    icon: Music,
    iconBg: "bg-purple-100 dark:bg-purple-900/40",
    iconColor: "text-purple-600 dark:text-purple-400",
    category: "media",
    hasSettings: true,
  },
  {
    id: "craft-news",
    label: "Craft News",
    desc: "Curated articles on pottery, ceramics, and quilting.",
    icon: BookOpen,
    iconBg: "bg-stone-100 dark:bg-stone-800/60",
    iconColor: "text-stone-600 dark:text-stone-400",
    category: "media",
  },

  // Web & links
  {
    id: "weather",
    label: "Studio Weather",
    desc: "Current conditions at your studio — set any location.",
    icon: Wind,
    iconBg: "bg-sky-100 dark:bg-sky-900/40",
    iconColor: "text-sky-600 dark:text-sky-400",
    category: "web",
    added: true,
    hasSettings: true,
  },
  {
    id: "etsy",
    label: "Etsy Shop / Search",
    desc: "Live preview or link card to any Etsy URL.",
    icon: ShoppingBag,
    iconBg: "bg-teal-100 dark:bg-teal-900/40",
    iconColor: "text-teal-600 dark:text-teal-400",
    category: "web",
    hasSettings: true,
  },
  {
    id: "website",
    label: "Website Bookmark",
    desc: "Embed or link to any site — your supplier, a blog, a pattern store.",
    icon: Globe,
    iconBg: "bg-indigo-100 dark:bg-indigo-900/40",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    category: "web",
    hasSettings: true,
  },
  {
    id: "maps",
    label: "Local Map",
    desc: "Your favourite studio, shop, or pottery school on a map.",
    icon: Map,
    iconBg: "bg-green-100 dark:bg-green-900/40",
    iconColor: "text-green-600 dark:text-green-400",
    category: "web",
    hasSettings: true,
  },
  {
    id: "link-list",
    label: "Link List",
    desc: "A custom pinned list of URLs with labels.",
    icon: Link,
    iconBg: "bg-blue-100 dark:bg-blue-900/40",
    iconColor: "text-blue-600 dark:text-blue-400",
    category: "web",
    hasSettings: true,
    isNew: true,
  },

  // Tools
  {
    id: "notes",
    label: "Sticky Notes",
    desc: "A small scratchpad — jot ideas or reminders on the hub.",
    icon: FileText,
    iconBg: "bg-yellow-100 dark:bg-yellow-900/40",
    iconColor: "text-yellow-600 dark:text-yellow-400",
    category: "tools",
    hasSettings: true,
  },
  {
    id: "countdown",
    label: "Countdown",
    desc: "Count down to a show, craft fair, or project deadline.",
    icon: Clock,
    iconBg: "bg-blue-100 dark:bg-blue-900/40",
    iconColor: "text-blue-600 dark:text-blue-400",
    category: "tools",
    hasSettings: true,
  },
  {
    id: "calendar",
    label: "Calendar",
    desc: "Mini calendar with your upcoming craft events.",
    icon: Calendar,
    iconBg: "bg-rose-100 dark:bg-rose-900/40",
    iconColor: "text-rose-600 dark:text-rose-400",
    category: "tools",
  },
  {
    id: "goals",
    label: "Goals / Targets",
    desc: "Track a personal goal — items to add, yardage to use, etc.",
    icon: Target,
    iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    category: "tools",
    hasSettings: true,
    isNew: true,
  },
  {
    id: "quick-add",
    label: "Quick Add",
    desc: "One-tap buttons to add a pottery piece, fabric, or block.",
    icon: Zap,
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    category: "tools",
  },
  {
    id: "ai-search",
    label: "AI Search",
    desc: '"Do I own this?" — camera or text search across both collections.',
    icon: Sparkles,
    iconBg: "bg-violet-100 dark:bg-violet-900/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    category: "tools",
  },

  // Inspiration
  {
    id: "photo-of-day",
    label: "Photo of the Day",
    desc: "A rotating photo from your own collection as daily inspiration.",
    icon: Camera,
    iconBg: "bg-pink-100 dark:bg-pink-900/40",
    iconColor: "text-pink-600 dark:text-pink-400",
    category: "inspiration",
    hasSettings: true,
  },
  {
    id: "color-palette",
    label: "Colour Palette",
    desc: "Dominant colours across your current quilting fabrics.",
    icon: PenTool,
    iconBg: "bg-violet-100 dark:bg-violet-900/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    category: "inspiration",
    isNew: true,
  },
  {
    id: "pattern-idea",
    label: "Pattern Idea",
    desc: "A curated quilt or pottery pattern suggestion each week.",
    icon: Image,
    iconBg: "bg-rose-100 dark:bg-rose-900/40",
    iconColor: "text-rose-600 dark:text-rose-400",
    category: "inspiration",
  },
  {
    id: "glaze-tip",
    label: "Glaze Tip",
    desc: "A rotating ceramic technique tip from a curated library.",
    icon: FlaskConical,
    iconBg: "bg-amber-100 dark:bg-amber-900/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    category: "inspiration",
  },
];

export default function WidgetLibrary() {
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [added, setAdded] = useState<Set<string>>(
    new Set(ALL_WIDGETS.filter((w) => w.added).map((w) => w.id)),
  );

  const visible = ALL_WIDGETS.filter((w) => {
    const matchCat = category === "all" || w.category === category;
    const matchSearch =
      !search ||
      w.label.toLowerCase().includes(search.toLowerCase()) ||
      w.desc.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  function toggle(id: string) {
    setAdded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h1 className="text-lg font-bold">Widget library</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {added.size} active · {ALL_WIDGETS.length - added.size}{" "}
                available to add
              </p>
            </div>
            <button className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2">
              <Check className="w-4 h-4" /> Done
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-5 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search widgets…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        {/* Category tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${category === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Widget grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {visible.map((w) => {
            const isAdded = added.has(w.id);
            return (
              <div
                key={w.id}
                className={`relative bg-card border rounded-xl p-4 flex flex-col gap-3 transition-all ${isAdded ? "border-primary/40 ring-1 ring-primary/20" : "border-border hover:border-border/80 hover:shadow-sm"}`}
              >
                {w.isNew && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    New
                  </span>
                )}
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl ${w.iconBg} flex items-center justify-center flex-shrink-0`}
                  >
                    <w.icon className={`w-4 h-4 ${w.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold leading-tight">
                      {w.label}
                    </div>
                    {w.hasSettings && (
                      <span className="text-[10px] text-muted-foreground font-medium">
                        ⚙ Customisable
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                  {w.desc}
                </p>
                <button
                  onClick={() => toggle(w.id)}
                  className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isAdded ? "bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive" : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}
                >
                  {isAdded ? (
                    <>
                      <Check className="w-3 h-3" /> Added
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" /> Add to dashboard
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {visible.length === 0 && (
          <div className="text-center py-16">
            <div className="text-muted-foreground text-sm">
              No widgets match "{search}"
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
