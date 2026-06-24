import { useState } from "react";
import {
  Sun, Moon, Search, Plus, Settings, LogOut, GripVertical, X,
  Layers, Wind, ShoppingBag, Star, Zap, Image, ArrowRight,
  ChevronDown, LayoutGrid, Scissors, Maximize2, Activity,
  Package, Palette, Shirt, BookOpen, BarChart2
} from "lucide-react";

const WIDGETS_AVAILABLE = [
  { id: "pottery-stats", label: "Pottery Stats", icon: Package, desc: "Item counts, categories, recent additions" },
  { id: "quilting-stats", label: "Quilting Stats", icon: Shirt, desc: "Fabrics, blocks, layouts at a glance" },
  { id: "recent-activity", label: "Recent Activity", icon: Activity, desc: "What you added or edited across both apps" },
  { id: "random-piece", label: "Random Piece", icon: Star, desc: "Surprise yourself — a random item from your collection" },
  { id: "shopping-list", label: "Shopping List", icon: ShoppingBag, desc: "Top items on your quilting wishlist" },
  { id: "weather", label: "Studio Weather", icon: Wind, desc: "Current conditions at your studio location" },
  { id: "quick-add", label: "Quick Add", icon: Zap, desc: "One-tap shortcut to add any item type" },
  { id: "inspiration", label: "Inspiration", icon: Image, desc: "A curated image or pattern idea of the day" },
];

const WIDGET_DEFAULTS = ["pottery-stats", "quilting-stats", "recent-activity", "weather", "shopping-list"];

function PotteryStatsWidget({ edit }: { edit: boolean }) {
  return (
    <div className="relative bg-card border border-border rounded-xl p-5 flex flex-col gap-4 h-full group">
      {edit && <div className="absolute top-3 right-3 flex gap-1.5 z-10">
        <button className="p-1 rounded hover:bg-muted cursor-grab active:cursor-grabbing text-muted-foreground"><GripVertical className="w-4 h-4" /></button>
        <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <Package className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <span className="font-semibold text-sm">Pottery</span>
        </div>
        <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[{ v: "163", l: "Total" }, { v: "158", l: "Unique" }, { v: "12", l: "Categories" }].map(s => (
          <div key={s.l} className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{s.v}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {["Blue celadon bowl", "Raku-fired vase", "Speckled mug"].map((item, i) => (
          <div key={i} className="flex items-center gap-2.5 text-sm">
            <div className="w-7 h-7 rounded bg-amber-100 dark:bg-amber-900/30 flex-shrink-0" />
            <span className="text-muted-foreground truncate">{item}</span>
            <ArrowRight className="w-3 h-3 text-muted-foreground/50 ml-auto flex-shrink-0" />
          </div>
        ))}
      </div>
      <a href="#" className="mt-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        Open collection <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

function QuiltingStatsWidget({ edit }: { edit: boolean }) {
  return (
    <div className="relative bg-card border border-border rounded-xl p-5 flex flex-col gap-4 h-full group">
      {edit && <div className="absolute top-3 right-3 flex gap-1.5 z-10">
        <button className="p-1 rounded hover:bg-muted cursor-grab text-muted-foreground"><GripVertical className="w-4 h-4" /></button>
        <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
            <Shirt className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <span className="font-semibold text-sm">Quilting</span>
        </div>
        <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[{ v: "46", l: "Fabrics" }, { v: "13", l: "Blocks" }, { v: "1", l: "Layouts" }].map(s => (
          <div key={s.l} className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{s.v}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="bg-muted/40 rounded-lg p-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">Shopping list</div>
        {["Kona Cotton — Navy", "Batting (2 yds)", "Teal stripe print"].map((item, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <div className="w-2 h-2 rounded-full bg-violet-400 flex-shrink-0" />
            <span className="text-sm text-muted-foreground truncate">{item}</span>
          </div>
        ))}
      </div>
      <a href="#" className="mt-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        Open quilting <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

function RecentActivityWidget({ edit }: { edit: boolean }) {
  const items = [
    { icon: Package, label: "Added 'Speckled Mug'", app: "Pottery", time: "2h ago", color: "text-amber-500" },
    { icon: Shirt, label: "Updated fabric stash", app: "Quilting", time: "Yesterday", color: "text-violet-500" },
    { icon: Scissors, label: "Created 'Bear Claw' block", app: "Quilting", time: "2 days ago", color: "text-violet-500" },
    { icon: Package, label: "Added 'Serving bowl'", app: "Pottery", time: "3 days ago", color: "text-amber-500" },
    { icon: BookOpen, label: "New layout 'Spring Sampler'", app: "Quilting", time: "Last week", color: "text-violet-500" },
  ];
  return (
    <div className="relative bg-card border border-border rounded-xl p-5 flex flex-col gap-3 h-full group">
      {edit && <div className="absolute top-3 right-3 flex gap-1.5 z-10">
        <button className="p-1 rounded hover:bg-muted cursor-grab text-muted-foreground"><GripVertical className="w-4 h-4" /></button>
        <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
            <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <span className="font-semibold text-sm">Recent Activity</span>
        </div>
        <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
            <item.icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-foreground truncate">{item.label}</div>
              <div className="text-xs text-muted-foreground">{item.app}</div>
            </div>
            <span className="text-xs text-muted-foreground flex-shrink-0">{item.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeatherWidget({ edit }: { edit: boolean }) {
  return (
    <div className="relative bg-card border border-border rounded-xl p-5 flex flex-col gap-3 h-full group overflow-hidden">
      {edit && <div className="absolute top-3 right-3 flex gap-1.5 z-10">
        <button className="p-1 rounded hover:bg-muted cursor-grab text-muted-foreground"><GripVertical className="w-4 h-4" /></button>
        <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>}
      <div className="absolute inset-0 bg-gradient-to-br from-sky-400/10 to-blue-600/5 pointer-events-none" />
      <div className="flex items-start justify-between relative">
        <div>
          <div className="text-xs text-muted-foreground font-medium">Studio · Reichenbach</div>
          <div className="text-4xl font-light mt-1">17°C</div>
          <div className="text-sm text-muted-foreground mt-0.5">Partly cloudy</div>
        </div>
        <div className="text-5xl">⛅</div>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1 relative">
        {[{ l: "Humidity", v: "62%" }, { l: "Wind", v: "8 km/h" }, { l: "UV", v: "Low" }].map(s => (
          <div key={s.l} className="text-center">
            <div className="text-sm font-medium">{s.v}</div>
            <div className="text-xs text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShoppingWidget({ edit }: { edit: boolean }) {
  const items = [
    { name: "Kona Cotton — Navy", qty: "2 yds", status: "want" },
    { name: "Batting (queen)", qty: "1", status: "ordered" },
    { name: "Teal geometric print", qty: "1.5 yds", status: "want" },
  ];
  return (
    <div className="relative bg-card border border-border rounded-xl p-5 flex flex-col gap-3 h-full group">
      {edit && <div className="absolute top-3 right-3 flex gap-1.5 z-10">
        <button className="p-1 rounded hover:bg-muted cursor-grab text-muted-foreground"><GripVertical className="w-4 h-4" /></button>
        <button className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center">
          <ShoppingBag className="w-4 h-4 text-rose-600 dark:text-rose-400" />
        </div>
        <span className="font-semibold text-sm">Shopping List</span>
        <span className="ml-auto text-xs bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 px-2 py-0.5 rounded-full font-medium">3 items</span>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 cursor-pointer transition-colors">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${item.status === "ordered" ? "bg-emerald-400" : "bg-rose-400"}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{item.name}</div>
              <div className="text-xs text-muted-foreground">{item.qty}</div>
            </div>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.status === "ordered" ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {item.status}
            </span>
          </div>
        ))}
      </div>
      <a href="#" className="mt-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        View full list <ArrowRight className="w-3 h-3" />
      </a>
    </div>
  );
}

function AddWidgetPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-popover border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Add widget</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Choose what to show on your dashboard</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-4 grid grid-cols-2 gap-3">
          {WIDGETS_AVAILABLE.map(w => (
            <button key={w.id} className="flex flex-col gap-1.5 p-3.5 rounded-xl border border-border hover:border-primary/50 hover:bg-muted/50 text-left transition-colors group">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                <w.icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="text-sm font-medium">{w.label}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{w.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardGrid() {
  const [dark, setDark] = useState(false);
  const [edit, setEdit] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-background text-foreground font-sans">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-6 py-3 flex items-center justify-between">
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
              <kbd className="ml-2 text-[10px] border border-border rounded px-1 py-0.5 bg-muted font-mono">⌘K</kbd>
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

        <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
          {/* Welcome + quick actions */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Welcome back, Sarah.</h1>
              <p className="text-muted-foreground text-sm mt-0.5">One account, every collection.</p>
            </div>
            <div className="flex gap-2">
              <button className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <Plus className="w-4 h-4" /> Add item
              </button>
              <button className="flex items-center gap-2 border border-border px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                <ShoppingBag className="w-4 h-4" /> Shopping list
              </button>
            </div>
          </div>

          {/* Dashboard header */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Dashboard</h2>
            <div className="flex items-center gap-2">
              {edit && (
                <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 text-sm text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add widget
                </button>
              )}
              <button
                onClick={() => setEdit(e => !e)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${edit ? "bg-primary text-primary-foreground border-transparent" : "border-border hover:bg-muted text-muted-foreground"}`}
              >
                {edit ? <><X className="w-3.5 h-3.5" /> Done</> : <><Settings className="w-3.5 h-3.5" /> Customize</>}
              </button>
            </div>
          </div>

          {/* Widget grid */}
          {edit && <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg px-3 py-2">
            <GripVertical className="w-3.5 h-3.5" />
            Drag widgets to rearrange · click <X className="w-3 h-3 inline mx-0.5" /> to remove
          </div>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={edit ? "ring-2 ring-primary/20 rounded-xl" : ""}><PotteryStatsWidget edit={edit} /></div>
            <div className={edit ? "ring-2 ring-primary/20 rounded-xl" : ""}><QuiltingStatsWidget edit={edit} /></div>
            <div className={`row-span-2 ${edit ? "ring-2 ring-primary/20 rounded-xl" : ""}`}><RecentActivityWidget edit={edit} /></div>
            <div className={edit ? "ring-2 ring-primary/20 rounded-xl" : ""}><WeatherWidget edit={edit} /></div>
            <div className={edit ? "ring-2 ring-primary/20 rounded-xl" : ""}><ShoppingWidget edit={edit} /></div>
          </div>

          {!edit && (
            <div className="border-2 border-dashed border-border rounded-xl py-6 flex flex-col items-center justify-center gap-2 hover:border-primary/40 hover:bg-muted/20 cursor-pointer transition-colors group" onClick={() => { setEdit(true); setAddOpen(true); }}>
              <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Add a widget</span>
            </div>
          )}
        </main>

        {addOpen && <AddWidgetPanel onClose={() => setAddOpen(false)} />}
      </div>
    </div>
  );
}
