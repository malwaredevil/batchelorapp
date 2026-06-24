import { useState } from "react";
import {
  Sun, Moon, Search, Plus, Settings, ArrowRight, LayoutGrid,
  ChevronDown, ShoppingBag, Activity, Package, Shirt, Wind,
  X, Check, GripVertical, Maximize2, Scissors, BookOpen,
  FlaskConical, Layers, Ruler, Star, RefreshCw, LogOut
} from "lucide-react";

type WidgetId = "pottery" | "quilting" | "activity" | "weather" | "shopping" | "random";

const POTTERY_LINKS = [
  { label: "Collection", icon: Package, desc: "Browse all pieces", href: "#", color: "hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-200 dark:hover:border-amber-800" },
  { label: "Compare", icon: Layers, desc: "Side-by-side view", href: "#", color: "hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-200 dark:hover:border-amber-800" },
  { label: "Maintenance", icon: FlaskConical, desc: "Care & repairs log", href: "#", color: "hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-200 dark:hover:border-amber-800" },
];

const QUILTING_LINKS = [
  { label: "Fabrics", icon: Shirt, desc: "Your fabric stash", href: "#", color: "hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-200 dark:hover:border-violet-800" },
  { label: "Blocks", icon: Scissors, desc: "Block designs", href: "#", color: "hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-200 dark:hover:border-violet-800" },
  { label: "Layouts", icon: Layers, desc: "Quilt plans", href: "#", color: "hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-200 dark:hover:border-violet-800" },
];

function AppCard({
  id, title, icon: Icon, accentBg, accentText, accentBorder, stats, links, expanded, onToggle, edit
}: {
  id: string; title: string; icon: any; accentBg: string; accentText: string; accentBorder: string;
  stats: { v: string; l: string }[];
  links: { label: string; icon: any; desc: string; href: string; color: string }[];
  expanded: boolean; onToggle: () => void; edit: boolean;
}) {
  return (
    <div className={`bg-card border border-border rounded-xl overflow-hidden transition-all ${edit ? "ring-2 ring-primary/20" : ""}`}>
      {/* Header — always visible, click to expand/collapse */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
      >
        {edit && <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0 cursor-grab" />}
        <div className={`w-9 h-9 rounded-lg ${accentBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${accentText}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{title}</div>
          <div className="flex items-center gap-3 mt-0.5">
            {stats.map(s => (
              <span key={s.l} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{s.v}</span> {s.l}
              </span>
            ))}
          </div>
        </div>
        {edit && <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground mr-1" onClick={e => e.stopPropagation()}><X className="w-3.5 h-3.5" /></button>}
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className={`border-t ${accentBorder} px-5 py-4 space-y-4`}>
          {/* Quick-nav links */}
          <div className="grid grid-cols-3 gap-2">
            {links.map(link => (
              <a
                key={link.label}
                href={link.href}
                className={`flex flex-col gap-1.5 p-3 rounded-lg border border-border transition-all ${link.color} group`}
              >
                <link.icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                <div className="text-sm font-semibold leading-none">{link.label}</div>
                <div className="text-xs text-muted-foreground leading-snug">{link.desc}</div>
              </a>
            ))}
          </div>
          {/* Recents */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Recent</div>
            <div className="space-y-1">
              {(id === "pottery"
                ? ["Blue celadon bowl · 2 days ago", "Raku-fired vase · Last week", "Speckled mug · Last week"]
                : ["Kona Cotton — Navy · 1 day ago", "Bear Claw block · 3 days ago", "Spring Sampler layout · Last week"]
              ).map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group">
                  <div className={`w-7 h-7 rounded ${accentBg} flex-shrink-0`} />
                  <span className="text-sm text-muted-foreground flex-1 truncate">{item}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WeatherWidget({ expanded, onToggle, edit }: { expanded: boolean; onToggle: () => void; edit: boolean }) {
  return (
    <div className={`bg-card border border-border rounded-xl overflow-hidden ${edit ? "ring-2 ring-primary/20" : ""}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left">
        {edit && <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0 cursor-grab" />}
        <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center flex-shrink-0">
          <Wind className="w-4 h-4 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Studio Weather</div>
          <div className="text-xs text-muted-foreground mt-0.5">17°C · Partly cloudy · Reichenbach</div>
        </div>
        <span className="text-2xl mr-1">⛅</span>
        {edit && <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground mr-1" onClick={e => e.stopPropagation()}><X className="w-3.5 h-3.5" /></button>}
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-sky-100 dark:border-sky-900/40 px-5 py-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[{ l: "Humidity", v: "62%" }, { l: "Wind", v: "8 km/h" }, { l: "UV Index", v: "Low" }, { l: "Pressure", v: "1014 hPa" }, { l: "Visibility", v: "10 km" }, { l: "Feels like", v: "15°C" }].map(s => (
              <div key={s.l} className="bg-muted/40 rounded-lg p-2.5 text-center">
                <div className="text-sm font-semibold">{s.v}</div>
                <div className="text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Updated 4 min ago</span>
            <button className="flex items-center gap-1 hover:text-foreground transition-colors"><RefreshCw className="w-3 h-3" /> Refresh</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityWidget({ expanded, onToggle, edit }: { expanded: boolean; onToggle: () => void; edit: boolean }) {
  const items = [
    { l: "Added 'Speckled Mug'", app: "Pottery", t: "2h ago", c: "bg-amber-400" },
    { l: "Updated fabric stash", app: "Quilting", t: "Yesterday", c: "bg-violet-400" },
    { l: "Created 'Bear Claw' block", app: "Quilting", t: "2 days ago", c: "bg-violet-400" },
    { l: "Added 'Serving bowl'", app: "Pottery", t: "3 days ago", c: "bg-amber-400" },
    { l: "New layout 'Spring Sampler'", app: "Quilting", t: "Last week", c: "bg-violet-400" },
  ];
  return (
    <div className={`bg-card border border-border rounded-xl overflow-hidden ${edit ? "ring-2 ring-primary/20" : ""}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left">
        {edit && <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0 cursor-grab" />}
        <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
          <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Recent Activity</div>
          <div className="text-xs text-muted-foreground mt-0.5">5 updates across both apps</div>
        </div>
        {edit && <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground mr-1" onClick={e => e.stopPropagation()}><X className="w-3.5 h-3.5" /></button>}
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-emerald-100 dark:border-emerald-900/40 px-5 py-4 space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.c}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{item.l}</div>
                <div className="text-xs text-muted-foreground">{item.app}</div>
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0">{item.t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShoppingWidget({ expanded, onToggle, edit }: { expanded: boolean; onToggle: () => void; edit: boolean }) {
  const items = [
    { name: "Kona Cotton — Navy", qty: "2 yds", status: "want" },
    { name: "Batting (queen size)", qty: "1", status: "ordered" },
    { name: "Teal geometric print", qty: "1.5 yds", status: "want" },
    { name: "Backing fabric", qty: "3 yds", status: "want" },
  ];
  return (
    <div className={`bg-card border border-border rounded-xl overflow-hidden ${edit ? "ring-2 ring-primary/20" : ""}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left">
        {edit && <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0 cursor-grab" />}
        <div className="w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center flex-shrink-0">
          <ShoppingBag className="w-4 h-4 text-rose-600 dark:text-rose-400" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Shopping List</div>
          <div className="text-xs text-muted-foreground mt-0.5"><span className="text-rose-500 font-semibold">3 wanted</span> · 1 ordered</div>
        </div>
        {edit && <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground mr-1" onClick={e => e.stopPropagation()}><X className="w-3.5 h-3.5" /></button>}
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-rose-100 dark:border-rose-900/40 px-5 py-4 space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/60 cursor-pointer transition-colors">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.status === "ordered" ? "bg-emerald-400" : "bg-rose-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.name}</div>
                <div className="text-xs text-muted-foreground">{item.qty}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.status === "ordered" ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                {item.status}
              </span>
            </div>
          ))}
          <a href="#" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-1">
            View full shopping list <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

const AVAILABLE_WIDGETS = [
  { id: "weather", label: "Studio Weather", icon: Wind },
  { id: "random", label: "Random Piece", icon: Star },
  { id: "rss", label: "RSS / News feed", icon: BookOpen },
  { id: "inspiration", label: "Inspiration board", icon: Layers },
];

export default function HubRefined() {
  const [dark, setDark] = useState(false);
  const [edit, setEdit] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<WidgetId>>(new Set(["pottery", "quilting"]));

  function toggle(id: WidgetId) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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
              <kbd className="ml-2 text-[10px] border border-border rounded px-1 bg-muted font-mono">⌘K</kbd>
            </button>
            <button onClick={() => setDark(d => !d)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <div className="flex items-center gap-2 pl-2 border-l border-border">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium leading-none">Sarah</div>
                <div className="text-xs text-muted-foreground">sarah@studio.co</div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold">SC</div>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
          {/* Welcome */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Welcome back, Sarah.</h1>
              <p className="text-muted-foreground text-sm mt-0.5">One account, every collection.</p>
            </div>
            <div className="flex gap-2">
              <button className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="w-4 h-4" /> Add item
              </button>
              <button className="flex items-center gap-1.5 border border-border px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-muted-foreground">
                <ShoppingBag className="w-4 h-4" /> Shopping list
              </button>
            </div>
          </div>

          {/* Dashboard toolbar */}
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dashboard</h2>
            <div className="flex items-center gap-2">
              {edit && (
                <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 text-sm text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add widget
                </button>
              )}
              <button
                onClick={() => setEdit(e => !e)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${edit ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                {edit ? <><Check className="w-3.5 h-3.5" /> Done</> : <><Settings className="w-3.5 h-3.5" /> Customize</>}
              </button>
            </div>
          </div>

          {edit && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
              <GripVertical className="w-3.5 h-3.5" />
              Drag to reorder · click <X className="w-3 h-3 inline mx-0.5" /> to remove · click ↓ to collapse/expand
            </div>
          )}

          {/* Widget stack */}
          <div className="space-y-3">
            <AppCard
              id="pottery" title="Pottery" icon={Package}
              accentBg="bg-amber-100 dark:bg-amber-900/40" accentText="text-amber-600 dark:text-amber-400"
              accentBorder="border-amber-100 dark:border-amber-900/40"
              stats={[{ v: "163", l: "pieces" }, { v: "12", l: "categories" }]}
              links={POTTERY_LINKS}
              expanded={expanded.has("pottery")} onToggle={() => toggle("pottery")} edit={edit}
            />
            <AppCard
              id="quilting" title="Quilting" icon={Shirt}
              accentBg="bg-violet-100 dark:bg-violet-900/40" accentText="text-violet-600 dark:text-violet-400"
              accentBorder="border-violet-100 dark:border-violet-900/40"
              stats={[{ v: "46", l: "fabrics" }, { v: "13", l: "blocks" }, { v: "1", l: "layout" }]}
              links={QUILTING_LINKS}
              expanded={expanded.has("quilting")} onToggle={() => toggle("quilting")} edit={edit}
            />
            <WeatherWidget expanded={expanded.has("weather")} onToggle={() => toggle("weather")} edit={edit} />
            <ActivityWidget expanded={expanded.has("activity")} onToggle={() => toggle("activity")} edit={edit} />
            <ShoppingWidget expanded={expanded.has("shopping")} onToggle={() => toggle("shopping")} edit={edit} />
          </div>

          {/* Add widget CTA */}
          {!edit && (
            <button
              onClick={() => { setEdit(true); setAddOpen(true); }}
              className="w-full border-2 border-dashed border-border rounded-xl py-4 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/20 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add a widget
            </button>
          )}
        </main>

        {/* Add widget panel */}
        {addOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setAddOpen(false)}>
            <div className="bg-popover border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-border">
                <div>
                  <h2 className="text-sm font-semibold">Add widget</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Choose what to add to your dashboard</p>
                </div>
                <button onClick={() => setAddOpen(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-3 space-y-1">
                {AVAILABLE_WIDGETS.map(w => (
                  <button key={w.id} onClick={() => setAddOpen(false)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted transition-colors text-left">
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
        )}
      </div>
    </div>
  );
}
