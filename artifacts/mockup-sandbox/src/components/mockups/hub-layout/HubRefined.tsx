import { useState } from "react";
import {
  Sun,
  Moon,
  Search,
  Plus,
  Settings,
  ArrowRight,
  LayoutGrid,
  ChevronDown,
  ShoppingBag,
  Activity,
  Package,
  Shirt,
  Wind,
  X,
  Check,
  GripVertical,
  Maximize2,
  Scissors,
  BookOpen,
  FlaskConical,
  Layers,
  Star,
  Camera,
} from "lucide-react";

const DOMAIN =
  "e530e43e-c322-42ad-b85d-db16d192d043-00-1mxd7zwrznofn.riker.replit.dev";

const POTTERY_LINKS = [
  { label: "Collection", icon: Package, desc: "Browse all pieces" },
  { label: "Compare", icon: Layers, desc: "Side-by-side view" },
  { label: "Maintenance", icon: FlaskConical, desc: "Care & repairs log" },
];

const QUILTING_LINKS = [
  { label: "Fabrics", icon: Shirt, desc: "Your fabric stash" },
  { label: "Blocks", icon: Scissors, desc: "Block designs" },
  { label: "Layouts", icon: Layers, desc: "Quilt plans" },
];

// ── App hero card (Pottery / Quilting) ───────────────────────────────────────
function AppHeroCard({
  title,
  image,
  badge,
  stats,
  links,
  accentBg,
  accentText,
  accentBorderColor,
  accentSectionBg,
  expanded,
  onToggle,
  edit,
}: {
  title: string;
  image: string;
  badge: string;
  stats: { v: string; l: string }[];
  links: { label: string; icon: any; desc: string }[];
  accentBg: string;
  accentText: string;
  accentBorderColor: string;
  accentSectionBg: string;
  expanded: boolean;
  onToggle: () => void;
  edit: boolean;
}) {
  return (
    <div
      className={`relative bg-card border border-border rounded-xl overflow-hidden flex flex-col h-full group transition-all ${edit ? "ring-2 ring-primary/20" : ""}`}
    >
      {edit && (
        <div className="absolute top-3 right-3 flex gap-1.5 z-10">
          <button className="p-1 rounded hover:bg-black/30 cursor-grab text-white/80">
            <GripVertical className="w-4 h-4" />
          </button>
          <button className="p-1 rounded hover:bg-black/30 text-white/80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hero image — same as live app: h-48, gradient overlay, title + badge */}
      <div className="h-48 w-full relative overflow-hidden bg-muted flex-shrink-0">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute bottom-4 left-5 right-5 flex justify-between items-end">
          <h2 className="text-2xl font-bold text-white tracking-tight">
            {title}
          </h2>
          <span className="text-xs bg-white/20 text-white backdrop-blur-md border-0 px-2 py-1 rounded-full font-medium">
            {badge}
          </span>
        </div>
        {!edit && (
          <button className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/20 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/40">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="p-4 pb-3">
        <div className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div key={s.l} className="bg-muted/50 rounded-lg p-2.5 text-center">
              <div className="text-xl font-bold text-primary">{s.v}</div>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Accordion toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-between px-4 py-2.5 border-t border-border hover:bg-muted/30 transition-colors text-xs font-medium text-muted-foreground mt-auto"
      >
        <span>{expanded ? "Hide quick links" : "Quick links →"}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expanded quick-nav */}
      {expanded && (
        <div
          className={`px-4 pb-4 pt-3 border-t ${accentBorderColor} ${accentSectionBg}`}
        >
          <div className="grid grid-cols-3 gap-2">
            {links.map((link) => (
              <a
                key={link.label}
                href="#"
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border bg-white/60 dark:bg-black/20 hover:bg-white dark:hover:bg-black/30 transition-all text-center ${accentBorderColor}`}
              >
                <link.icon className={`w-4 h-4 ${accentText}`} />
                <div className="text-xs font-semibold leading-none">
                  {link.label}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Footer link — only when collapsed */}
      {!expanded && (
        <a
          href="#"
          className="px-4 pb-4 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open {title.toLowerCase()} <ArrowRight className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// ── Recent Activity ──────────────────────────────────────────────────────────
function RecentActivityWidget({ edit }: { edit: boolean }) {
  const items = [
    {
      icon: Package,
      label: "Added 'Speckled Mug'",
      app: "Pottery",
      time: "2h ago",
      color: "text-amber-500",
    },
    {
      icon: Shirt,
      label: "Updated fabric stash",
      app: "Quilting",
      time: "Yesterday",
      color: "text-violet-500",
    },
    {
      icon: Scissors,
      label: "Created 'Bear Claw' block",
      app: "Quilting",
      time: "2 days ago",
      color: "text-violet-500",
    },
    {
      icon: Package,
      label: "Added 'Serving bowl'",
      app: "Pottery",
      time: "3 days ago",
      color: "text-amber-500",
    },
    {
      icon: BookOpen,
      label: "New layout 'Spring Sampler'",
      app: "Quilting",
      time: "Last week",
      color: "text-violet-500",
    },
  ];
  return (
    <div
      className={`relative bg-card border border-border rounded-xl p-5 flex flex-col gap-3 h-full group ${edit ? "ring-2 ring-primary/20" : ""}`}
    >
      {edit && (
        <div className="absolute top-3 right-3 flex gap-1.5 z-10">
          <button className="p-1 rounded hover:bg-muted cursor-grab text-muted-foreground">
            <GripVertical className="w-4 h-4" />
          </button>
          <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
            <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <span className="font-semibold text-sm">Recent Activity</span>
        </div>
        {!edit && (
          <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-0.5 flex-1">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
          >
            <item.icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{item.label}</div>
              <div className="text-xs text-muted-foreground">{item.app}</div>
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
              {item.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Weather widget ───────────────────────────────────────────────────────────
function WeatherWidget({ edit }: { edit: boolean }) {
  return (
    <div
      className={`relative bg-card border border-border rounded-xl p-5 flex flex-col gap-3 h-full group overflow-hidden ${edit ? "ring-2 ring-primary/20" : ""}`}
    >
      {edit && (
        <div className="absolute top-3 right-3 flex gap-1.5 z-10">
          <button className="p-1 rounded hover:bg-muted cursor-grab text-muted-foreground">
            <GripVertical className="w-4 h-4" />
          </button>
          <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-sky-400/10 to-blue-600/5 pointer-events-none" />
      <div className="flex items-start justify-between relative">
        <div>
          <div className="text-xs text-muted-foreground font-medium">
            Studio · Reichenbach
          </div>
          <div className="text-4xl font-light mt-1">17°C</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            Partly cloudy
          </div>
        </div>
        <div className="text-5xl leading-none">⛅</div>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1 relative">
        {[
          { l: "Humidity", v: "62%" },
          { l: "Wind", v: "8 km/h" },
          { l: "UV", v: "Low" },
        ].map((s) => (
          <div key={s.l} className="text-center">
            <div className="text-sm font-medium">{s.v}</div>
            <div className="text-xs text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shopping widget ──────────────────────────────────────────────────────────
function ShoppingWidget({ edit }: { edit: boolean }) {
  const items = [
    { name: "Kona Cotton — Navy", qty: "2 yds", status: "want" },
    { name: "Batting (queen)", qty: "1", status: "ordered" },
    { name: "Teal geometric print", qty: "1.5 yds", status: "want" },
  ];
  return (
    <div
      className={`relative bg-card border border-border rounded-xl p-5 flex flex-col gap-3 h-full group ${edit ? "ring-2 ring-primary/20" : ""}`}
    >
      {edit && (
        <div className="absolute top-3 right-3 flex gap-1.5 z-10">
          <button className="p-1 rounded hover:bg-muted cursor-grab text-muted-foreground">
            <GripVertical className="w-4 h-4" />
          </button>
          <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center">
          <ShoppingBag className="w-4 h-4 text-rose-600 dark:text-rose-400" />
        </div>
        <span className="font-semibold text-sm">Shopping List</span>
        <span className="ml-auto text-xs bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 px-2 py-0.5 rounded-full font-medium">
          3 items
        </span>
      </div>
      <div className="space-y-2 flex-1">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 cursor-pointer transition-colors"
          >
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${item.status === "ordered" ? "bg-emerald-400" : "bg-rose-400"}`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{item.name}</div>
              <div className="text-xs text-muted-foreground">{item.qty}</div>
            </div>
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.status === "ordered" ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
            >
              {item.status}
            </span>
          </div>
        ))}
      </div>
      <a
        href="#"
        className="mt-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        View full list <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

// ── Add widget panel ─────────────────────────────────────────────────────────
const AVAILABLE_WIDGETS = [
  { id: "weather", label: "Studio Weather", icon: Wind },
  { id: "random", label: "Random Piece", icon: Star },
  { id: "camera", label: "Do I own this?", icon: Camera },
  { id: "rss", label: "RSS / News feed", icon: BookOpen },
  { id: "inspiration", label: "Inspiration board", icon: Layers },
];

function AddWidgetPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-popover border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Add widget</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose what to add to your dashboard
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 space-y-1">
          {AVAILABLE_WIDGETS.map((w) => (
            <button
              key={w.id}
              onClick={onClose}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <w.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">{w.label}</span>
              <Plus className="w-4 h-4 text-muted-foreground ml-auto" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function HubRefined() {
  const [dark, setDark] = useState(false);
  const [edit, setEdit] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [potteryExpanded, setPotteryExpanded] = useState(false);
  const [quiltingExpanded, setQuiltingExpanded] = useState(false);

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background text-foreground font-sans">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-foreground flex items-center justify-center">
              <LayoutGrid className="w-4 h-4 text-background" />
            </div>
            <span className="font-semibold text-sm">Batchelor</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden md:flex items-center gap-2 text-sm text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors">
              <Search className="w-3.5 h-3.5" /> Global search...
              <kbd className="ml-2 text-[10px] border border-border rounded px-1 bg-muted font-mono">
                ⌘K
              </kbd>
            </button>
            <button
              onClick={() => setDark((d) => !d)}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
            >
              {dark ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            <div className="flex items-center gap-2 pl-2 border-l border-border">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium leading-none">Sarah</div>
                <div className="text-xs text-muted-foreground">
                  sarah@studio.co
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold">
                SC
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
          {/* Welcome */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Welcome back, Sarah.</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                One account, every collection.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="w-4 h-4" /> Add item
              </button>
              <button className="flex items-center gap-2 border border-border px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-muted-foreground">
                <Camera className="w-4 h-4" /> Do I own this?
              </button>
              <button className="flex items-center gap-2 border border-border px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-muted-foreground">
                <ShoppingBag className="w-4 h-4" /> Shopping list
              </button>
            </div>
          </div>

          {/* Your apps section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold">Your apps</h3>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <AppHeroCard
                title="Pottery"
                image={`https://${DOMAIN}/images/pottery-collection.png`}
                badge="Updated 2h ago"
                stats={[
                  { v: "163", l: "Total" },
                  { v: "158", l: "Unique" },
                  { v: "12", l: "Categories" },
                ]}
                links={POTTERY_LINKS}
                accentBg="bg-amber-100 dark:bg-amber-900/40"
                accentText="text-amber-600 dark:text-amber-400"
                accentBorderColor="border-amber-200/60 dark:border-amber-800/40"
                accentSectionBg="bg-amber-50/60 dark:bg-amber-900/10"
                expanded={potteryExpanded}
                onToggle={() => setPotteryExpanded((e) => !e)}
                edit={edit}
              />
              <AppHeroCard
                title="Quilting"
                image={`https://${DOMAIN}/images/quilting-collection.png`}
                badge="Updated 1d ago"
                stats={[
                  { v: "46", l: "Fabrics" },
                  { v: "13", l: "Blocks" },
                  { v: "1", l: "Layout" },
                ]}
                links={QUILTING_LINKS}
                accentBg="bg-violet-100 dark:bg-violet-900/40"
                accentText="text-violet-600 dark:text-violet-400"
                accentBorderColor="border-violet-200/60 dark:border-violet-800/40"
                accentSectionBg="bg-violet-50/60 dark:bg-violet-900/10"
                expanded={quiltingExpanded}
                onToggle={() => setQuiltingExpanded((e) => !e)}
                edit={edit}
              />
            </div>
          </section>

          {/* Widgets section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold">Widgets</h3>
              </div>
              <div className="flex items-center gap-2">
                {edit && (
                  <button
                    onClick={() => setAddOpen(true)}
                    className="flex items-center gap-1.5 text-sm text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add widget
                  </button>
                )}
                <button
                  onClick={() => setEdit((e) => !e)}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors
                    ${edit ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  {edit ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Done
                    </>
                  ) : (
                    <>
                      <Settings className="w-3.5 h-3.5" /> Customize
                    </>
                  )}
                </button>
              </div>
            </div>

            {edit && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
                <GripVertical className="w-3.5 h-3.5" />
                Drag to reorder · click <X className="w-3 h-3 inline mx-0.5" />{" "}
                to remove
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div
                className={`md:col-span-1 ${edit ? "ring-2 ring-primary/20 rounded-xl" : ""}`}
              >
                <WeatherWidget edit={edit} />
              </div>
              <div
                className={`md:col-span-1 ${edit ? "ring-2 ring-primary/20 rounded-xl" : ""}`}
              >
                <ShoppingWidget edit={edit} />
              </div>
              <div
                className={`md:col-span-1 ${edit ? "ring-2 ring-primary/20 rounded-xl" : ""}`}
              >
                <RecentActivityWidget edit={edit} />
              </div>
            </div>

            {!edit && (
              <div
                className="border-2 border-dashed border-border rounded-xl py-5 flex flex-col items-center justify-center gap-2 hover:border-primary/40 hover:bg-muted/20 cursor-pointer transition-colors group"
                onClick={() => {
                  setEdit(true);
                  setAddOpen(true);
                }}
              >
                <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                  Add a widget
                </span>
              </div>
            )}
          </section>
        </main>

        {addOpen && <AddWidgetPanel onClose={() => setAddOpen(false)} />}
      </div>
    </div>
  );
}
